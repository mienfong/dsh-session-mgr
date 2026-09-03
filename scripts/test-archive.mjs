// scripts/test-archive.mjs — validate makeZip/readZip, makeTarGz/readTarGz,
// and headerOf() against BOTH the old and new DSH persistence.list() shapes.
import assert from "node:assert/strict";
import { makeZip, readZip, makeTarGz, readTarGz, headerOf } from "../lib/host.js";

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
console.log("ARCHIVE ROUND-TRIP TESTS PASSED");
