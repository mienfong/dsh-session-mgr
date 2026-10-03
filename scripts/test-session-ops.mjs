// scripts/test-session-ops.mjs — unit tests for the session-operation seam that
// does not need a running harness:
//   * generationLogVersion / resolveExistingLogPath — a session whose CURRENT
//     format generation was never materialised (lazy migration) must still be
//     found: `persistence.locate()` is diagnostics, so fall back to the newest
//     canonical generation actually on disk.
//   * retargetProjectionCache — a move rewrites the log header `cwd`, and the
//     stored projection-cache record is bound to that field, so it has to be
//     re-keyed or the listing degrades to "Untitled".
//   * pruneProjectionCacheRecord — delete is the only place an orphaned cache
//     document can be reclaimed (the cache service has no eviction API).
import assert from "node:assert/strict";
import { constants, zstdCompressSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generationLogVersion, resolveExistingLogPath, retargetProjectionCache, pruneProjectionCacheRecord, encodeSegment, decodeSegment, findUnreadableSessions } from "../lib/host.js";

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const exists = (path) => stat(path).then(() => true, () => false);
const frame = (line) => zstdCompressSync(Buffer.from(line + "\n"), CHECKSUM);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  PASS  " + name);
  } catch (error) {
    failures++;
    console.error("  FAIL  " + name + " :: " + error.message);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    console.log("  PASS  " + name);
  } catch (error) {
    failures++;
    console.error("  FAIL  " + name + " :: " + error.message);
  }
}

console.log("generationLogVersion");
check("reads the generation out of canonical names", () => {
  assert.equal(generationLogVersion("session.jsonl"), 0);
  assert.equal(generationLogVersion("session.jsonl.zstd"), 0);
  assert.equal(generationLogVersion("session.v3.jsonl.zstd"), 3);
  assert.equal(generationLogVersion("session.v12.jsonl"), 12);
  assert.equal(generationLogVersion("manifest.json"), undefined);
  assert.equal(generationLogVersion("session.v0.jsonl"), undefined, "a v0-tagged name is not canonical");
  assert.equal(generationLogVersion("session.v01.jsonl"), undefined, "leading zero is not canonical");
  assert.equal(generationLogVersion("session.v3.jsonl.bak"), undefined);
});

const work = await mkdtemp(join(tmpdir(), "dsh-ops-"));
try {
  const logLine = JSON.stringify({ type: "session", version: 3, id: "session-ops-0001", createdAt: 1, cwd: "C:\\ws" });
  const v3 = "session.v3.jsonl.zstd";
  const v0 = "session.jsonl.zstd";
  const locatedButAbsent = join(work, "session.v4.jsonl.zstd");
  const fakePersistence = (locatedPath) => ({ locate: () => ({ kind: "jsonl", path: locatedPath }) });

  console.log("\nresolveExistingLogPath");

  await checkAsync("keeps the located path when it exists", async () => {
    const dir = join(work, "present");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, v3), frame(logLine));
    const located = join(dir, v3);
    const resolved = await resolveExistingLogPath(fakePersistence(located), { id: "s" });
    assert.equal(resolved.path, located);
  });

  await checkAsync("falls back to the newest generation on disk (lazy migration)", async () => {
    const dir = join(work, "lazy");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, v0), frame(logLine));
    await writeFile(join(dir, v3), frame(logLine));
    const resolved = await resolveExistingLogPath(fakePersistence(join(dir, "session.v4.jsonl.zstd")), { id: "s" });
    assert.equal(resolved.path, join(dir, v3), "newest existing generation wins");
    assert.equal(resolved.kind, "jsonl", "the rest of the locate result is preserved");
  });

  await checkAsync("prefers the located physical encoding", async () => {
    const dir = join(work, "encoding");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.v2.jsonl"), frame(logLine));
    await writeFile(join(dir, "session.v3.jsonl.zstd"), frame(logLine));
    const zstdLocated = await resolveExistingLogPath(fakePersistence(join(dir, "session.v4.jsonl.zstd")), { id: "s" });
    assert.equal(zstdLocated.path, join(dir, "session.v3.jsonl.zstd"), "zstd was asked for and a zstd log exists");
  });

  await checkAsync("falls back to the other encoding rather than refusing", async () => {
    const dir = join(work, "encoding-only-other");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.v2.jsonl"), frame(logLine));
    const resolved = await resolveExistingLogPath(fakePersistence(join(dir, "session.v4.jsonl.zstd")), { id: "s" });
    assert.equal(resolved.path, join(dir, "session.v2.jsonl"), "a readable log beats artifact-missing");
  });

  await checkAsync("keeps the located path for an empty or garbage-only directory", async () => {
    const empty = join(work, "empty");
    await mkdir(empty, { recursive: true });
    const resolvedEmpty = await resolveExistingLogPath(fakePersistence(join(empty, "session.v4.jsonl.zstd")), { id: "s" });
    assert.equal(resolvedEmpty.path, join(empty, "session.v4.jsonl.zstd"), "no canonical log -> still missing");

    const garbage = join(work, "garbage");
    await mkdir(garbage, { recursive: true });
    await writeFile(join(garbage, "notes.txt"), "not a log");
    await mkdir(join(garbage, "session.v4.jsonl.zstd"), { recursive: true });
    const resolvedGarbage = await resolveExistingLogPath(fakePersistence(join(garbage, "session.v4.jsonl.zstd")), { id: "s" });
    assert.equal(resolvedGarbage.path, join(garbage, "session.v4.jsonl.zstd"), "a directory named like a log is not a log");
  });

  await checkAsync("keeps the located path when the directory cannot be read", async () => {
    const missing = join(work, "does-not-exist", "session.v4.jsonl.zstd");
    const resolved = await resolveExistingLogPath(fakePersistence(missing), { id: "s" });
    assert.equal(resolved.path, missing);
  });

  await checkAsync("passes a locator refusal through unchanged", async () => {
    const persistence = { locate: () => ({ path: "" }) };
    const resolved = await resolveExistingLogPath(persistence, { id: "s" });
    assert.equal(resolved.path, "");
  });

  console.log("\nretargetProjectionCache");
  const unseeded = { version: 4, createdAt: 7, cwd: "D:\\old", isSeeded: false };
  const recordIdentity = { formatVersion: 4, createdAt: 7, cwd: "D:\\old", isSeeded: false, inheritedEventCount: 0 };

  const stubCtx = (cache, warnings) => ({
    get: (name) => (name === "sessionProjectionCache" ? cache : undefined),
    logger: { warn: (message) => warnings.push(message) }
  });

  await checkAsync("re-keys an unseeded session's record to the new cwd", async () => {
    const calls = { recordFor: [], put: [] };
    const cache = {
      recordFor: (id, expected) => {
        calls.recordFor.push({ id, expected });
        return { identity: recordIdentity, rows: { title: { value: "hello" } } };
      },
      put: async (id, identity, rows) => {
        calls.put.push({ id, identity, rows });
      }
    };
    const ok = await retargetProjectionCache(stubCtx(cache, []), "session-x", unseeded, "E:\\new");
    assert.equal(ok, true);
    assert.deepEqual(calls.recordFor, [{ id: "session-x", expected: recordIdentity }], "the old identity is what gets looked up");
    assert.equal(calls.put.length, 1);
    assert.deepEqual(calls.put[0], {
      id: "session-x",
      identity: { ...recordIdentity, cwd: "E:\\new" },
      rows: { title: { value: "hello" } }
    }, "only cwd changes and the rows are carried over");
  });

  await checkAsync("leaves a seeded fork alone", async () => {
    const calls = { recordFor: 0, put: 0 };
    const cache = { recordFor: () => { calls.recordFor++; return { identity: recordIdentity, rows: {} }; }, put: async () => { calls.put++; } };
    const ok = await retargetProjectionCache(stubCtx(cache, []), "session-x", { ...unseeded, isSeeded: true }, "E:\\new");
    assert.equal(ok, false);
    assert.deepEqual(calls, { recordFor: 0, put: 0 }, "the inherited cut is not in a stored header, so it is not touched");
  });

  await checkAsync("is a no-op without the service, without a record, or on a failure", async () => {
    const warnings = [];
    assert.equal(await retargetProjectionCache(stubCtx(undefined, warnings), "s", unseeded, "E:\\new"), false);
    assert.equal(await retargetProjectionCache(stubCtx({ recordFor: () => undefined, put: async () => {} }, warnings), "s", unseeded, "E:\\new"), false);
    const throwing = { recordFor: () => ({ identity: recordIdentity, rows: {} }), put: async () => { throw new Error("domain closed"); } };
    assert.equal(await retargetProjectionCache(stubCtx(throwing, warnings), "s", unseeded, "E:\\new"), false);
    assert.equal(warnings.length, 1, "a failure is reported, not thrown");
    assert.ok(warnings[0].includes("projection-cache re-key failed"));
  });

  console.log("\npruneProjectionCacheRecord");
  const home = join(work, "home");
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const recordPath = (id) => join(home, "storages", "session_projcache", "sessions", `${id}.json`);

    await checkAsync("removes the deleted session's document", async () => {
      await mkdir(join(home, "storages", "session_projcache", "sessions"), { recursive: true });
      await writeFile(recordPath("session-gone"), JSON.stringify({ identity: recordIdentity, rows: {} }));
      assert.equal(await exists(recordPath("session-gone")), true);
      assert.equal(await pruneProjectionCacheRecord(stubCtx(undefined, []), "session-gone"), true);
      assert.equal(await exists(recordPath("session-gone")), false);
    });

    await checkAsync("is a no-op for a session that never had a record", async () => {
      assert.equal(await pruneProjectionCacheRecord(stubCtx(undefined, []), "session-never-opened"), true);
    });

    await checkAsync("leaves the legacy single-document layout alone", async () => {
      const legacy = join(home, "storages", "session_projcache.json");
      await writeFile(legacy, "{}");
      await pruneProjectionCacheRecord(stubCtx(undefined, []), "session-gone");
      assert.equal(await exists(legacy), true, "the legacy document is not ours to edit");
    });

    await checkAsync("warns instead of failing when the layout is not removable", async () => {
      const blocked = recordPath("session-blocked");
      await mkdir(blocked, { recursive: true });
      await writeFile(join(blocked, "child.json"), "{}");
      const warnings = [];
      assert.equal(await pruneProjectionCacheRecord(stubCtx(undefined, warnings), "session-blocked"), false);
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes("projection-cache prune failed"));
    });
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }

console.log("\ndecodeSegment / findUnreadableSessions");
check("decodes every segment encodeSegment produces", () => {
  for (const raw of ["session-abc-123", ".", "..", "a~b", "有中文", "a b", "x~002E", "C:\\path"]) {
    assert.equal(decodeSegment(encodeSegment(raw)), raw, `round trip: ${raw}`);
  }
});
check("rejects names that are not a valid encoding", () => {
  assert.equal(decodeSegment("a~b"), undefined, "a bare ~ is not an escape");
  assert.equal(decodeSegment("a~ZZZZ"), undefined, "non-hex escape");
  assert.equal(decodeSegment(""), undefined);
  assert.equal(decodeSegment(undefined), undefined);
});

{
  const home = join(work, "scan-home");
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const projectDir = join(home, "sessions", "--C-project--");
    const knownId = "session-known-0001";
    const brokenId = "session-broken-0002";
    await mkdir(join(projectDir, encodeSegment(knownId)), { recursive: true });
    await mkdir(join(projectDir, encodeSegment(brokenId)), { recursive: true });
    await mkdir(join(projectDir, "not-an-encoded-name~ZZ"), { recursive: true });
    await writeFile(join(projectDir, "stray-file"), "x");

    await checkAsync("reports only the directories the backend did not account for", async () => {
      const found = await findUnreadableSessions(new Set([knownId]));
      const ids = found.map((entry) => entry.id);
      assert.deepEqual(ids.includes(brokenId), true, "the unreadable session is reported");
      assert.deepEqual(ids.includes(knownId), false, "a readable session is not reported");
      assert.equal(found.length, 2, `expected the broken session and the undecodable folder, got ${JSON.stringify(found)}`);
      const undecodable = found.find((entry) => entry.id === null);
      assert.equal(undecodable.dir, "not-an-encoded-name~ZZ", "an undecodable folder is still surfaced");
      assert.ok(found.every((entry) => typeof entry.path === "string" && entry.path.length > 0), "every entry carries a path");
    });

    await checkAsync("is empty when everything on disk is accounted for", async () => {
      const found = await findUnreadableSessions(new Set([knownId, brokenId, "not-an-encoded-name~ZZ"]));
      const undecodable = found.filter((entry) => entry.id === null);
      assert.equal(found.length, undecodable.length, "only the undecodable folder can remain");
    });

    await checkAsync("returns nothing when the sessions root does not exist", async () => {
      process.env.DSH_HOME = join(work, "no-such-home");
      assert.deepEqual(await findUnreadableSessions(new Set()), []);
    });
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
}
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall session-ops checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
