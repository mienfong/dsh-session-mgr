// scripts/test-import-compat-live.mjs — LIVE end-to-end test of the cross-version
// import path against a running `dsh web` instance.
//
// A package written by a NEWER harness can carry an event type this build has no
// vocabulary for. The JSONL backend is fail-closed about that, so the import
// marks such events `ignorable: true`; this test proves the INSTALLED artifact is
// then admissible — by decoding it back, and by handing the decoded events to the
// harness' own `validateStoredEvents` (the function that used to refuse them).
//
// Usage: node scripts/test-import-compat-live.mjs [baseUrl] [dshHome]
//   baseUrl default http://127.0.0.1:3080/dsh-session-mgr
//   dshHome default: derived from the plugin's own attachmentStoreRoot()
// When the harness packages cannot be resolved from here (the script normally
// runs from the repo, outside DSH's profile), the validator checks report SKIP
// instead of failing; the plugin-side checks still run.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { globSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { attachmentStoreRoot, encodeSegment, makeZip, projectKey, scanZstdFrames } from "../lib/host.js";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3080/dsh-session-mgr").replace(/\/+$/, "");
const dshHome = process.argv[3] ? resolve(process.argv[3]) : dirname(dirname(attachmentStoreRoot()));
const sessionsRoot = join(dshHome, "sessions");
const UNKNOWN_TYPE = "workspace/changes";

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
function skip(name, why) {
  console.log(`  SKIP  ${name}  (${why})`);
}

async function post(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

/** The harness' own admission validator, or undefined when it is not reachable from here. */
async function loadHarnessValidator() {
  const names = ["@deepseek-ai/dsh-session-persistence", "@deepseek-ai/dsh-session"];
  try {
    return { persistence: await import(names[0]), session: await import(names[1]) };
  } catch { /* not running inside the harness; resolve the way the installed plugin does */ }
  try {
    // The plugin's own directory is the resolution base its `import()` uses, so a
    // manifest found there answers the same question the running plugin asks.
    const manifests = globSync(join(dshHome, "profiles", "*", "node_modules", "dsh-session-mgr", "package.json").replace(/\\/g, "/"));
    for (const manifest of manifests) {
      try {
        const require = createRequire(manifest);
        const entry = (name) => pathToFileURL(require.resolve(name)).href;
        return { persistence: await import(entry(names[0])), session: await import(entry(names[1])) };
      } catch { /* try the next installed profile */ }
    }
    return undefined;
  } catch (error) {
    console.log(`  (harness validator unavailable: ${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

/** Every event in the log, in file order, container-aware. */
function eventsOf(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 4247762216) {
    const { frames } = scanZstdFrames(bytes);
    const events = [];
    for (let index = 1; index < frames.length; index++) {
      const text = zstdDecompressSync(bytes.subarray(frames[index].start, frames[index].end)).toString("utf8");
      for (const line of text.split("\n")) if (line.length > 0) events.push(JSON.parse(line));
    }
    return events;
  }
  return bytes.toString("utf8").split("\n").filter((line) => line.length > 0).slice(1).map((line) => JSON.parse(line));
}

const work = await mkdtemp(join(tmpdir(), "dsm-compat-live-"));
const targetDir = join(work, "workspace");
const pkgDir = join(work, "pkg");
const sessionId = `session-${randomUUID()}`;
const logName = "session.v3.jsonl";
const destDir = join(sessionsRoot, projectKey(targetDir), encodeSegment(sessionId));
let imported = false;

try {
  const harness = await loadHarnessValidator();
  console.log(`baseUrl   = ${baseUrl}`);
  console.log(`sessionId = ${sessionId}`);
  console.log(`scenario  = a package carrying "${UNKNOWN_TYPE}", an event type unknown to this build\n`);

  if (harness) {
    const known = harness.session.KNOWN_SESSION_EVENT_TYPES;
    check("sanity: this build really does not know the event type", known instanceof Set && !known.has(UNKNOWN_TYPE), `vocabulary=${known?.size}`);
  } else {
    skip("sanity: this build does not know the event type", "harness packages not resolvable from here");
  }

  await mkdir(pkgDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  const createdAt = Date.now();
  const header = JSON.stringify({
    type: "session", version: 3, id: sessionId, createdAt, cwd: "D:\\OtherMachine\\Compat",
    isSeeded: false, delegationDepth: 0
  });
  const knownEvent = JSON.stringify({ type: "turn/start", seq: 0, time: createdAt, data: { turn: 1 } });
  const unknownEvent = JSON.stringify({ type: UNKNOWN_TYPE, seq: 1, time: createdAt + 1, data: { changes: [] } });
  await writeFile(join(pkgDir, logName), `${header}\n${knownEvent}\n${unknownEvent}\n`);
  await writeFile(join(pkgDir, "manifest.json"), JSON.stringify({
    schema: 1, kind: "dsh-session-export", sessionId, version: 3, createdAt,
    cwd: "D:\\OtherMachine\\Compat", logName, attachments: []
  }, null, 2));
  const archive = join(work, `${encodeSegment(sessionId)}.zip`);
  await writeFile(archive, makeZip([
    { name: "manifest.json", data: await readFile(join(pkgDir, "manifest.json")) },
    { name: logName, data: await readFile(join(pkgDir, logName)) }
  ]));

  const res = await post("/import", { sourcePath: archive, targetPath: targetDir });
  if (res.status !== 200 || res.json.ok !== true) {
    check("import returned ok", false, `status=${res.status} body=${JSON.stringify(res.json).slice(0, 200)}`);
    throw new Error("import failed");
  }
  imported = true;
  check("import returned ok", true);

  const unknown = Array.isArray(res.json.unknownEvents) ? res.json.unknownEvents : [];
  check(
    "the unknown event is reported to the caller",
    unknown.length === 1 && unknown[0].type === UNKNOWN_TYPE && unknown[0].count === 1,
    JSON.stringify(unknown)
  );

  const installedName = (res.json.logs ?? [])[0];
  check("installed log is canonical + locally encoded", installedName === "session.v3.jsonl.zstd", String(installedName));
  const installedRaw = await readFile(join(destDir, installedName));
  const events = eventsOf(installedRaw);
  check("event count and order unchanged", events.length === 2 && events[0].seq === 0 && events[1].seq === 1, events.map((e) => e.seq).join(","));
  check("the unknown event carries the marker on disk", events[1].ignorable === true && events[1].type === UNKNOWN_TYPE, JSON.stringify(events[1]));
  check("the known event was not touched", events[0].ignorable === undefined && events[0].type === "turn/start", JSON.stringify(events[0]));

  if (harness) {
    const meta = { version: 3, id: sessionId, createdAt, cwd: resolve(targetDir), isSeeded: false, delegationDepth: 0 };
    try {
      const validated = harness.persistence.validateStoredEvents(meta, eventsOf(installedRaw));
      check("the harness' own validator accepts the installed log", validated.length === 2, `${validated.length} events admitted`);
    } catch (error) {
      check("the harness' own validator accepts the installed log", false, String(error.message).slice(0, 160));
    }
  } else {
    skip("the harness' own validator accepts the installed log", "harness packages not resolvable from here");
  }

  const list = await post("/list", {});
  const listed = Array.isArray(list.json.sessions) ? list.json.sessions.some((s) => s.id === sessionId) : false;
  check("list route healthy and the import is listed", list.status === 200 && listed, `status=${list.status} listed=${listed}`);
} finally {
  if (imported) {
    const del = await post("/delete", { sessionId }).catch(() => ({ status: 0 }));
    const gone = !(await stat(destDir).then(() => true, () => false));
    check("imported session deleted again", del.status === 200 && gone, `status=${del.status}`);
  }
  await rm(destDir, { recursive: true, force: true });
  await rm(join(sessionsRoot, projectKey(targetDir)), { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  const after = await post("/list", {}).catch(() => ({ status: 0 }));
  check("list route healthy after cleanup", after.status === 200, `status=${after.status}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "\nLIVE COMPAT TEST PASSED" : `\nLIVE COMPAT TEST FAILED (${failed} check(s))`);
process.exit(failed === 0 ? 0 : 1);
