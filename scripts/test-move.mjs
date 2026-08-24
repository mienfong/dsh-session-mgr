// scripts/test-move.mjs — standalone test for dsh-session-mgr host helpers.
// Builds synthetic session artifacts (plaintext + zstd) in a temp root and
// verifies moveSessionFiles + rewriteLogHeader against them.
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import assert from "node:assert/strict";
import { encodeSegment, projectKey, scanZstdFrames, rewriteLogHeader, moveSessionFiles } from "../lib/host.js";

const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

function headerLine(cwd, id, createdAt = 1700000000000) {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    createdAt,
    cwd,
    delegationDepth: 0
  }) + "\n";
}

async function makeZstdLog(dir, cwd, id, eventLines) {
  await mkdir(dir, { recursive: true });
  const header = Buffer.from(headerLine(cwd, id));
  const body = Buffer.from(eventLines.join("\n") + "\n");
  const frames = [
    await zstdCompressSync(header, CHECKSUM_OPTIONS),
    await zstdCompressSync(body, CHECKSUM_OPTIONS)
  ];
  await writeFile(join(dir, "session.jsonl.zstd"), Buffer.concat(frames));
  await writeFile(join(dir, "artifact.txt"), "hello artifact\n");
}

function decodeFirstHeader(logPathBuf) {
  const { frames } = scanZstdFrames(logPathBuf);
  const plain = zstdDecompressSync(logPathBuf.subarray(frames[0].start, frames[0].end)).toString("utf8");
  return JSON.parse(plain.slice(0, plain.indexOf(10)));
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  PASS  " + name);
  } catch (e) {
    failures++;
    console.error("  FAIL  " + name + " :: " + e.message);
  }
}

const root = await mkdtemp(join(tmpdir(), "dsh-move-test-"));
const A = join(root, "ws-a");
const B = join(root, "ws-b");
await mkdir(A, { recursive: true });
await mkdir(B, { recursive: true });
const id = "session-test-0001";
const oldCwd = A;
const newCwd = B;

// --- zstd session ---
const zdir = join(root, projectKey(oldCwd), encodeSegment(id));
await makeZstdLog(zdir, oldCwd, id, [
  '{"type":"turn/start","seq":0,"time":1,"data":{"turn":1}}',
  '{"type":"user/message","seq":1,"time":2,"data":{"content":[{"type":"text","text":"hi"}]}}'
]);
const zlogOld = join(zdir, "session.jsonl.zstd");
const zrawBefore = await readFile(zlogOld);

// same-dir no-op guard
{
  const r = await moveSessionFiles({ oldLogPath: zlogOld, newCwd: oldCwd, sessionId: id, compressed: true });
  check("same-cwd is a no-op", () => assert.equal(r.moved, false));
}

// real move
const moved = await moveSessionFiles({ oldLogPath: zlogOld, newCwd, sessionId: id, compressed: true });
check("moved flag", () => assert.equal(moved.moved, true));
check("new dir exists", async () => {
  const d = join(root, projectKey(newCwd), encodeSegment(id));
  assert.equal((await stat(d)).isDirectory(), true);
});
{
  const zlogNew = join(moved.newDir, "session.jsonl.zstd");
  const raw = await readFile(zlogNew);
  const head = decodeFirstHeader(raw);
  check("zstd header cwd rewritten", () => assert.equal(head.cwd, newCwd));
  check("zstd id preserved", () => assert.equal(head.id, id));
  const { frames } = scanZstdFrames(raw);
  const second = zstdDecompressSync(raw.subarray(frames[1].start, frames[1].end)).toString("utf8");
  check("zstd event frame intact", () => assert.ok(second.includes("user/message")));
  const artifact = await readFile(join(moved.newDir, "artifact.txt"), "utf8");
  check("artifact moved along", () => assert.equal(artifact.trim(), "hello artifact"));
}
check("old dir removed", async () => {
  try {
    await stat(zdir);
    assert.fail("old dir still exists");
  } catch (e) {
    assert.equal(e.code, "ENOENT");
  }
});

// --- plaintext session ---
const pdir = join(root, projectKey(join(A, "plain")), encodeSegment(id + "-p"));
await makeZstdLog(pdir, join(A, "plain"), id + "-p", ['{"type":"turn/start","seq":0,"time":1,"data":{"turn":1}}']);
const plog = join(pdir, "session.jsonl.zstd");
// rewrite without moving (plaintext branch needs a plaintext file; craft one)
const plainDir = join(root, projectKey(join(A, "plain2")), encodeSegment(id + "-q"));
await mkdir(plainDir, { recursive: true });
await writeFile(join(plainDir, "session.jsonl"), headerLine(join(A, "plain2"), id + "-q") + '{"type":"turn/start","seq":0,"time":1,"data":{"turn":1}}\n');
const rewritten = rewriteLogHeader(await readFile(join(plainDir, "session.jsonl")), newCwd, false);
const plainText = rewritten.toString("utf8");
check("plaintext header rewritten", () => assert.ok(plainText.startsWith('{"type":"session","version":3,"id":"' + id + '-q"') && plainText.includes('"cwd":"' + newCwd.replace(/\\/g, "\\\\") + '"')));
check("plaintext events intact", () => assert.ok(plainText.includes("turn/start")));

// --- collision refusal ---
{
  const cdir = join(root, projectKey(newCwd), encodeSegment("session-test-0002"));
  await makeZstdLog(cdir, newCwd, "session-test-0002", ['{"type":"turn/start","seq":0,"time":1,"data":{"turn":1}}']);
  const other = join(root, projectKey(oldCwd), encodeSegment("session-test-0002"));
  await makeZstdLog(other, oldCwd, "session-test-0002", ['{"type":"turn/start","seq":0,"time":1,"data":{"turn":1}}']);
  let threw = false;
  try {
    await moveSessionFiles({ oldLogPath: join(other, "session.jsonl.zstd"), newCwd, sessionId: "session-test-0002", compressed: true });
  } catch {
    threw = true;
  }
  check("collision refusal", () => assert.equal(threw, true));
}

await rm(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
