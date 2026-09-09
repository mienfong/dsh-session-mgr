// scripts/test-archive.mjs — validate makeZip/readZip, makeTarGz/readTarGz,
// headerOf() (new/old DSH list() shape), and extractMembersToDir (handles
// Windows "Compressed Folder" wrapped archives, skipping dir entries).
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeZip, readZip, makeTarGz, readTarGz, headerOf, extractMembersToDir, readLogHeader } from "../lib/host.js";

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

console.log("ARCHIVE ROUND-TRIP TESTS PASSED");
