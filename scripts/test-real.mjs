// scripts/test-real.mjs — run moveSessionFiles against a COPY of a real
// deployment session artifact to confirm the rewrite preserves all header
// fields and the log stays readable.
//
// The sample session is read from the environment/argv so no machine path is
// committed. Usage:
//   node scripts/test-real.mjs <path-to-a-real-session-dir>   -- or --
//   $env:DSH_REAL_SAMPLE = "<path-to-a-real-session-dir>"; node scripts/test-real.mjs
import { mkdtemp, mkdir, cp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import assert from "node:assert/strict";
import { moveSessionFiles, scanZstdFrames, projectKey, encodeSegment } from "../lib/host.js";

const SRC = process.env.DSH_REAL_SAMPLE || process.argv[2];
if (!SRC) {
  console.log("usage: node scripts/test-real.mjs <path-to-a-real-session-dir>");
  console.log("       or  set DSH_REAL_SAMPLE=/path/to/session-dir");
  process.exit(1);
}

const sessionId = basename(SRC);
const root = await mkdtemp(join(tmpdir(), "dsh-move-real-"));
const stage = join(root, "sample-proj");
await cp(SRC, join(stage, sessionId), { recursive: true });

const oldLogPath = join(stage, sessionId, "session.jsonl.zstd");
const target = join(root, "ws-dest");
await mkdir(target, { recursive: true });

const rawBefore = await readFile(oldLogPath);
const { frames } = scanZstdFrames(rawBefore);
const headBefore = JSON.parse(zstdDecompressSync(rawBefore.subarray(frames[0].start, frames[0].end)).toString("utf8"));
console.log("original header keys:", Object.keys(headBefore).join(", "));
console.log("original cwd:", headBefore.cwd);

const result = await moveSessionFiles({ oldLogPath, newCwd: target, sessionId, compressed: true });
assert.equal(result.moved, true);

const rawAfter = await readFile(result.newLogPath);
const { frames: f2 } = scanZstdFrames(rawAfter);
const headAfter = JSON.parse(zstdDecompressSync(rawAfter.subarray(f2[0].start, f2[0].end)).toString("utf8"));
console.log("new cwd:", headAfter.cwd);
console.log("new header keys:", Object.keys(headAfter).join(", "));
assert.equal(headAfter.cwd, target);
assert.equal(headAfter.id, headBefore.id);
assert.equal(headAfter.createdAt, headBefore.createdAt);
assert.equal(headAfter.delegationDepth, headBefore.delegationDepth);
if (headBefore.agentPreset !== undefined) assert.equal(headAfter.agentPreset, headBefore.agentPreset);
if (headBefore.parentSession !== undefined) assert.equal(headAfter.parentSession, headBefore.parentSession);
assert.ok(f2.length >= 2, "event frames preserved");

assert.ok(rawAfter.length > rawBefore.length - 200 && rawAfter.length < rawBefore.length + 400, "size sanity");

await rm(root, { recursive: true, force: true });
console.log("REAL-FILE TEST PASSED");
