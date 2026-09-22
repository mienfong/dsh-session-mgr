// scripts/test-import-compat.mjs — standalone test for the cross-version import
// compatibility path.
//
// A package exported by a NEWER harness can carry event types this build does
// not know. The JSONL backend refuses such a session fail-closed unless the
// event envelope is marked `ignorable: true`, so an import that copies the log
// verbatim installs a session the harness then refuses to open. This test
// verifies markUnknownEventsIgnorable():
//   1. marks exactly the unknown, unmarked events — nothing else,
//   2. keeps the header frame and every untouched frame byte-identical,
//   3. re-compresses only the frames that actually changed,
//   4. preserves a torn final frame verbatim,
//   5. is a no-op (returning the input buffer itself) when nothing needs marking,
//   6. is idempotent,
//   7. leaves the log readable: same header, same event count, same sequence
//      numbering, and every event admissible (known type, or ignorable),
//   8. handles the plaintext container too.
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import assert from "node:assert/strict";
import { markUnknownEventsIgnorable, scanZstdFrames } from "../lib/host.js";

const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const KNOWN = new Set(["user/message", "assistant/message", "step/start"]);
const HEADER = { type: "session", version: 3, id: "session-compat-0001", createdAt: 1700000000000, cwd: "C:\\ws" };

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

/** One independently decodable, checksummed frame from whole JSONL lines. */
function frame(...lines) {
  return zstdCompressSync(Buffer.from(lines.join("\n") + "\n"), CHECKSUM_OPTIONS);
}

function linesOf(frameBytes) {
  return zstdDecompressSync(frameBytes).toString("utf8").split("\n").filter((l) => l.length > 0);
}

function framesOf(bytes) {
  const { frames } = scanZstdFrames(bytes);
  return frames.map((f) => bytes.subarray(f.start, f.end));
}

function event(type, seq, extra = {}) {
  return JSON.stringify({ type, seq, time: 1700000000000 + seq, data: { n: seq }, ...extra });
}

const headerFrame = frame(JSON.stringify(HEADER));
const knownFrame = frame(event("user/message", 0), event("assistant/message", 1));
const mixedFrame = frame(event("workspace/changes", 2, { data: { turn: 69 } }), event("step/start", 3));
const unknownFrame = frame(event("future/thing", 4));
const log = Buffer.concat([headerFrame, knownFrame, mixedFrame, unknownFrame]);

console.log("markUnknownEventsIgnorable");

check("marks only the unknown, unmarked events, in log order", () => {
  const out = markUnknownEventsIgnorable(log, true, KNOWN);
  assert.deepEqual(out.events, [
    { type: "workspace/changes", seq: 2 },
    { type: "future/thing", seq: 4 }
  ]);
});

check("keeps the header frame and untouched frames byte-identical", () => {
  const out = markUnknownEventsIgnorable(log, true, KNOWN);
  const before = framesOf(log);
  const after = framesOf(out.bytes);
  assert.equal(after.length, before.length, "frame count changed");
  assert.ok(after[0].equals(before[0]), "header frame was rewritten");
  assert.ok(after[1].equals(before[1]), "frame without unknown events was re-compressed");
  assert.ok(!after[2].equals(before[2]), "frame with an unknown event was not re-compressed");
  assert.ok(!after[3].equals(before[3]), "frame with an unknown event was not re-compressed");
});

check("rewrites the offending line only, preserving envelope order", () => {
  const out = markUnknownEventsIgnorable(log, true, KNOWN);
  const mixed = linesOf(framesOf(out.bytes)[2]);
  assert.equal(mixed.length, 2, "event count in the frame changed");
  assert.equal(mixed[1], linesOf(mixedFrame)[1], "the known event in the same frame changed");
  assert.deepEqual(JSON.parse(mixed[0]), {
    type: "workspace/changes",
    seq: 2,
    time: 1700000000002,
    data: { turn: 69 },
    ignorable: true
  });
  assert.deepEqual(JSON.parse(linesOf(framesOf(out.bytes)[3])[0]), {
    type: "future/thing",
    seq: 4,
    time: 1700000000004,
    data: { n: 4 },
    ignorable: true
  });
});

check("every event is admissible afterwards (known type, or ignorable)", () => {
  const out = markUnknownEventsIgnorable(log, true, KNOWN);
  const events = framesOf(out.bytes).slice(1).flatMap(linesOf).map((l) => JSON.parse(l));
  assert.equal(events.length, 5, "event count changed");
  assert.deepEqual(events.map((e) => e.seq), [0, 1, 2, 3, 4], "sequence numbering changed");
  for (const e of events) assert.ok(KNOWN.has(e.type) || e.ignorable === true, `${e.type} is still refused`);
});

check("preserves a torn final frame verbatim", () => {
  const full = frame(event("future/thing", 9));
  const torn = full.subarray(0, full.length - 7);
  const input = Buffer.concat([headerFrame, unknownFrame, torn]);
  const out = markUnknownEventsIgnorable(input, true, KNOWN);
  assert.ok(out.bytes.subarray(out.bytes.length - torn.length).equals(torn), "torn tail changed");
  assert.ok(out.bytes.subarray(0, unknownFrame.length + headerFrame.length).length > 0);
  assert.deepEqual(out.events, [{ type: "future/thing", seq: 4 }]);
});

check("returns the input buffer itself when nothing needs marking", () => {
  const clean = Buffer.concat([headerFrame, knownFrame]);
  const out = markUnknownEventsIgnorable(clean, true, KNOWN);
  assert.equal(out.bytes, clean, "the buffer was copied or rewritten");
  assert.deepEqual(out.events, []);
});

check("leaves an already marked event untouched", () => {
  const marked = Buffer.concat([headerFrame, frame(event("future/thing", 0, { ignorable: true }))]);
  const out = markUnknownEventsIgnorable(marked, true, KNOWN);
  assert.equal(out.bytes, marked);
  assert.deepEqual(out.events, []);
});

check("is idempotent", () => {
  const once = markUnknownEventsIgnorable(log, true, KNOWN).bytes;
  const twice = markUnknownEventsIgnorable(once, true, KNOWN);
  assert.equal(twice.bytes, once, "a second pass rewrote the log");
  assert.deepEqual(twice.events, []);
});

check("is a no-op without a vocabulary", () => {
  for (const missing of [undefined, null, new Set()]) {
    const out = markUnknownEventsIgnorable(log, true, missing);
    assert.equal(out.bytes, log);
    assert.deepEqual(out.events, []);
  }
});

check("handles the plaintext container", () => {
  const text = Buffer.from([
    JSON.stringify(HEADER),
    event("user/message", 0),
    event("workspace/changes", 1, { data: { turn: 69 } })
  ].join("\n") + "\n");
  const out = markUnknownEventsIgnorable(text, false, KNOWN);
  assert.deepEqual(out.events, [{ type: "workspace/changes", seq: 1 }]);
  const lines = out.bytes.toString("utf8").split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 3, "line count changed");
  assert.equal(lines[0], JSON.stringify(HEADER), "the header line changed");
  assert.equal(lines[1], event("user/message", 0), "the known event changed");
  assert.equal(JSON.parse(lines[2]).ignorable, true, "the unknown event was not marked");
  assert.ok(out.bytes.toString("utf8").endsWith("\n"), "trailing newline lost");
});

check("leaves unparsable lines alone", () => {
  const odd = Buffer.concat([headerFrame, frame(event("future/thing", 0), "not json")]);
  const out = markUnknownEventsIgnorable(odd, true, KNOWN);
  const lines = linesOf(framesOf(out.bytes)[1]);
  assert.equal(lines[1], "not json");
  assert.deepEqual(out.events, [{ type: "future/thing", seq: 0 }]);
});

console.log(failures === 0 ? "\nall import-compat checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
