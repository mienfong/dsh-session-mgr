// scripts/test-archive.mjs — validate makeZip/readZip, makeTarGz/readTarGz,
// headerOf() (new/old DSH list() shape), and extractMembersToDir (handles
// Windows "Compressed Folder" wrapped archives, skipping dir entries).
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants, zstdCompressSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { makeZip, readZip, makeTarGz, readTarGz, headerOf, extractMembersToDir, readLogHeader, collectAttachmentIds, attachmentStoreRoot, attachmentRelativePaths, restoreAttachments, scanZstdFrames, logEncodingOf, reencodeLogName, sessionLogName, convertLogEncoding } from "../lib/host.js";

// collectAttachmentIds: finds sha256:<hex> refs in a plaintext log and across zstd frames.
{
  const hexA = "a".repeat(64);
  const hexB = "b".repeat(64);
  const plain = Buffer.from([
    '{"type":"session","id":"s","cwd":"C:\\\\x"}',
    `{"type":"user/message","data":{"content":[{"type":"image","attachmentId":"sha256:${hexA}"}]}}`,
    `{"type":"tool/result","data":{"attachmentId":"sha256:${hexB}"}}`
  ].join("\n") + "\n");
  const ids = collectAttachmentIds(plain);
  assert.equal(ids.length, 2, "plaintext: two distinct ids");
  assert.ok(ids.includes(`sha256:${hexA}`) && ids.includes(`sha256:${hexB}`), "plaintext ids found");

  const opts = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
  const zstdLog = Buffer.concat([
    zstdCompressSync(Buffer.from('{"type":"session","id":"s","cwd":"C:\\\\x"}\n'), opts),
    zstdCompressSync(Buffer.from(`{"type":"user/message","data":{"content":[{"type":"image","attachmentId":"sha256:${hexA}"}]}}\n`), opts)
  ]);
  assert.deepEqual(collectAttachmentIds(zstdLog), [`sha256:${hexA}`], "zstd frames scanned");
  assert.ok(attachmentStoreRoot().endsWith(join("attachments", "v1")), "attachment store root shape");
  console.log("collectAttachmentIds: OK");
}

// headerOf: old DSH returns bare headers; new DSH (>=0.1.2) returns { header, revision, sizeBytes }.
assert.equal(headerOf({ id: "s-a", cwd: "C:\\x", createdAt: 1 }).id, "s-a", "old shape");
assert.equal(headerOf({ header: { id: "s-b", cwd: "D:\\y", createdAt: 2 }, revision: "r", sizeBytes: 3 }).id, "s-b", "new shape");
assert.equal(headerOf({ header: null }).id, undefined, "null header degrades to entry (no id)");
assert.equal(headerOf(undefined), undefined, "undefined entry");

const files = [
  { name: "manifest.json", data: Buffer.from('{"sessionId":"s1","cwd":"C:\\\\x\\\\y"}') },
  { name: "session.jsonl.zstd", data: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02, 0x03]) },
  { name: "artifacts/note.txt", data: Buffer.from("hello artifact\n") }
];

for (const [name, make, read] of [["zip", makeZip, readZip], ["tar.gz", makeTarGz, readTarGz]]) {
  const buf = make(files);
  const back = read(buf);
  console.log(`--- ${name} ---`);
  console.log(`  archive bytes: ${buf.length}, magic ok: ${name === "zip" ? buf[0] === 0x50 : buf[0] === 0x1f}`);
  assert.equal(back.length, files.length, name + " member count");
  for (const expected of files) {
    const got = back.find((m) => m.name === expected.name);
    assert.ok(got, `${name}: missing member ${expected.name}`);
    assert.deepEqual(Buffer.from(got.data), expected.data, `${name}: member ${expected.name} content`);
    console.log(`  ${expected.name}: ${got.data.length}B ok`);
  }
}

// cross-format round trip: produce zip, read zip; produce targz, read targz
const zbuf = makeZip(files);
const zback = readZip(zbuf);
assert.ok(zback.some((m) => m.name === "session.jsonl.zstd"));
const tbuf = makeTarGz(files);
const tback = readTarGz(tbuf);
assert.ok(tback.some((m) => m.name === "artifacts/note.txt"));

// extractMembersToDir: a Windows "Compressed Folder" zip wraps everything under
// one top-level folder and includes a directory entry — must flatten + skip it.
{
  const wrap = await mkdtemp(join(tmpdir(), "dsh-extract-"));
  try {
    await extractMembersToDir([
      { name: "session-x/", data: Buffer.alloc(0) },
      { name: "session-x/manifest.json", data: Buffer.from('{"sessionId":"session-x","cwd":"C:\\\\a"}') },
      { name: "session-x/session.jsonl.zstd", data: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01]) }
    ], wrap);
    await stat(join(wrap, "manifest.json"));
    await stat(join(wrap, "session.jsonl.zstd"));
    const hadDirFile = await stat(join(wrap, "session-x")).then(() => true, () => false);
    assert.equal(hadDirFile, false, "directory entry must not become a file");
    // readLogHeader fallback path (missing manifest is handled in importSession)
    const hdr = await readLogHeader(join(wrap, "session.jsonl.zstd")).catch((e) => e.message);
    assert.ok(typeof hdr === "string" || hdr === undefined, "readLogHeader handles a tiny log gracefully");
  } finally {
    await rm(wrap, { recursive: true, force: true });
  }
  console.log("wrapped-zip extraction: OK");
}

// attachments: package a content-addressed object, ship it as attachments/v1/<rel>,
// extract, then restoreAttachments() into a fresh store — digest must survive.
{
  const { createHash } = await import("node:crypto");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const work = await mkdtemp(join(tmpdir(), "dsh-att-"));
  try {
    const bytes = Buffer.from("fake-png-bytes-for-test\n");
    const hex = createHash("sha256").update(bytes).digest("hex");
    const rel = attachmentRelativePaths(hex)[0];
    const srcStore = join(work, "srcStore");
    await mkdir(join(srcStore, ...rel.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(srcStore, ...rel.split("/")), bytes);

    // package (what backupSession does)
    const members = [{ name: `attachments/v1/${rel}`, data: await readFile(join(srcStore, ...rel.split("/"))) }];
    const zipBuf = makeZip(members);

    // import side: extract + restore into a fresh store
    const pkg = join(work, "pkg");
    await mkdir(pkg, { recursive: true });
    await extractMembersToDir(readZip(zipBuf), pkg);
    const pkgAtt = join(pkg, "attachments", "v1");
    const dstStore = join(work, "dstStore");
    const restored = await restoreAttachments(pkgAtt, dstStore);
    assert.equal(restored, 1, "one attachment restored");
    const back = await readFile(join(dstStore, ...rel.split("/")));
    assert.equal(createHash("sha256").update(back).digest("hex"), hex, "restored digest matches");
    // second restore is a no-op (content-addressed)
    assert.equal(await restoreAttachments(pkgAtt, dstStore), 0, "existing object not rewritten");
    console.log("attachment package/restore: OK");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// log encoding: a package's log container must match the LOCAL backend. DSH's JSONL
// backend rejects a session dir whose generation log uses the other container, and
// checkRootEncoding() then fails for the whole root, so import re-encodes instead.
{
  const opts = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
  assert.equal(logEncodingOf("session.jsonl"), "none");
  assert.equal(logEncodingOf("session.jsonl.zstd"), "zstd");
  assert.equal(logEncodingOf("session.v3.jsonl.zstd"), "zstd");
  assert.equal(logEncodingOf("session.v3.jsonl"), "none");
  assert.equal(logEncodingOf("manifest.json"), undefined, "manifest is not a session log");
  assert.equal(logEncodingOf("session.v3.jsonl.bak"), undefined, "non-log suffix");
  assert.equal(reencodeLogName("session.jsonl", "zstd"), "session.jsonl.zstd");
  assert.equal(reencodeLogName("session.v3.jsonl.zstd", "none"), "session.v3.jsonl");
  assert.equal(reencodeLogName("manifest.json", "zstd"), "manifest.json", "non-log names untouched");

  // the filename generation and the header version must agree, or the backend
  // rejects the session — and with it the whole sessions root — on read
  assert.equal(sessionLogName(3, "zstd"), "session.v3.jsonl.zstd");
  assert.equal(sessionLogName(3, "none"), "session.v3.jsonl");
  assert.equal(sessionLogName(0, "zstd"), "session.jsonl.zstd");
  assert.equal(sessionLogName(undefined, "none"), "session.jsonl", "unknown version keeps the v0 name");
  assert.equal(logEncodingOf(sessionLogName(3, "zstd")), "zstd", "canonical name round-trips");

  const cwdValue = "C:\\x";
  const headerLine = JSON.stringify({ type: "session", version: 3, id: "s-enc", createdAt: 7, cwd: cwdValue, isSeeded: false, delegationDepth: 0 }) + "\n";
  const events = JSON.stringify({ type: "turn/start", seq: 0, time: 1, data: { turn: 1 } }) + "\n"
    + JSON.stringify({ type: "turn/end", seq: 1, time: 2, data: {} }) + "\n";
  const plain = Buffer.from(headerLine + events, "utf8");

  const asZstd = convertLogEncoding(plain, "none", "zstd");
  // byte-for-byte the backend's own layout: header line alone in frame 1, body in frame 2
  const expected = Buffer.concat([
    zstdCompressSync(Buffer.from(headerLine), opts),
    zstdCompressSync(Buffer.from(events), opts)
  ]);
  assert.ok(asZstd.equals(expected), "plaintext -> zstd matches the backend frame layout");
  assert.equal(scanZstdFrames(asZstd).frames.length, 2, "header frame + body frame");
  assert.ok(convertLogEncoding(asZstd, "zstd", "none").equals(plain), "zstd -> plaintext is byte-exact");
  assert.ok(convertLogEncoding(plain, "none", "none").equals(plain), "same encoding is a no-op");

  const headerOnly = convertLogEncoding(Buffer.from(headerLine, "utf8"), "none", "zstd");
  assert.equal(scanZstdFrames(headerOnly).frames.length, 1, "no empty trailing body frame");
  assert.ok(convertLogEncoding(headerOnly, "zstd", "none").equals(Buffer.from(headerLine, "utf8")), "header-only round trip");

  // the re-encoded artifact must still parse through the normal header reader
  const enc = await mkdtemp(join(tmpdir(), "dsh-enc-"));
  try {
    await writeFile(join(enc, "session.v3.jsonl.zstd"), asZstd);
    const read = await readLogHeader(join(enc, "session.v3.jsonl.zstd"));
    assert.equal(read.id, "s-enc", "re-encoded zstd log header parses");
    assert.equal(read.cwd, cwdValue, "header cwd survives the round trip");
  } finally {
    await rm(enc, { recursive: true, force: true });
  }
  console.log("log encoding conversion: OK");
}

console.log("ARCHIVE ROUND-TRIP TESTS PASSED");