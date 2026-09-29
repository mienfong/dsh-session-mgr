// scripts/test-session-ops-live.mjs — LIVE round trip of every session
// operation against a running `dsh web`, on a synthetic session in a throw-away
// workspace. It is also the DSH-upgrade compatibility check for the workspace
// registry seam the plugin drives: headers / sessionPaths / invalidSessionPaths
// / resolveByPath / archivedSessionIds / setState and the entity's
// attachSession / detachSession.
//
// Covered: list -> move -> list -> archive -> list -> unarchive -> move back
//          -> backup -> delete -> list
//
// Usage: node scripts/test-session-ops-live.mjs [baseUrl] [dshHome]
//   baseUrl default http://127.0.0.1:3080/dsh-session-mgr
//   dshHome default: derived from the plugin's own attachmentStoreRoot()
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants, zstdCompressSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { attachmentStoreRoot, encodeSegment, projectKey, readLogHeader, readZip } from "../lib/host.js";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3080/dsh-session-mgr").replace(/\/+$/, "");
const dshHome = process.argv[3] ? resolve(process.argv[3]) : dirname(dirname(attachmentStoreRoot()));
const sessionsRoot = join(dshHome, "sessions");
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
const results = [];

function check(name, ok, detail) {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
async function exists(path) {
  return stat(path).then(() => true, () => false);
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
async function listedSession(sessionId) {
  const res = await post("/list", {});
  if (res.status !== 200 || !Array.isArray(res.json.sessions)) return { list: res, session: undefined };
  return { list: res, session: res.json.sessions.find((s) => s.id === sessionId) };
}

const work = await mkdtemp(join(tmpdir(), "dsm-ops-live-"));
const wsA = join(work, "ws-a");
const wsB = join(work, "ws-b");
const backupDir = join(work, "backups");
const sessionId = `session-${randomUUID()}`;
const logName = "session.v4.jsonl.zstd";
const cwdOf = (ws) => resolve(ws).replace(/\\/g, "\\");
const sessionDir = (ws) => join(sessionsRoot, projectKey(resolve(ws)), encodeSegment(sessionId));

try {
  console.log(`baseUrl   = ${baseUrl}`);
  console.log(`sessionId = ${sessionId}`);
  console.log(`scenario  = a synthetic ${logName} session, moved/archived/backed up/deleted\n`);

  // --- synthetic v4 session in workspace A
  const createdAt = Date.now();
  const dirA = sessionDir(wsA);
  await mkdir(wsA, { recursive: true });
  await mkdir(dirA, { recursive: true });
  const header = JSON.stringify({
    type: "session", version: 4, id: sessionId, createdAt, cwd: resolve(wsA),
    isSeeded: false, delegationDepth: 0, agentPreset: "standard"
  }) + "\n";
  const event = JSON.stringify({ type: "turn/start", seq: 0, time: createdAt, data: { turn: 1 } }) + "\n";
  await writeFile(join(dirA, logName), Buffer.concat([
    zstdCompressSync(Buffer.from(header), CHECKSUM),
    zstdCompressSync(Buffer.from(event), CHECKSUM)
  ]));

  const first = await listedSession(sessionId);
  check("list route works and sees the synthetic session", first.session !== undefined, `status=${first.list.status}`);
  check("session is grouped under its cwd workspace", first.session?.cwd === resolve(wsA), String(first.session?.cwd));

  // --- move A -> B
  await mkdir(wsB, { recursive: true });
  const moved = await post("/move", { sessionId, targetPath: wsB });
  check("move returns ok", moved.status === 200 && moved.json.ok === true, `status=${moved.status} body=${JSON.stringify(moved.json).slice(0, 140)}`);
  check("artifact directory moved", !(await exists(dirA)) && (await exists(sessionDir(wsB))), sessionDir(wsB));
  const movedHeader = await readLogHeader(join(sessionDir(wsB), logName));
  check("header cwd rewritten to the new workspace", movedHeader.cwd === resolve(wsB), String(movedHeader.cwd));
  check("all generation logs travelled", (await readdir(sessionDir(wsB))).includes(logName));

  // --- a destination that does not exist must be refused, not guessed at
  const nowhere = await post("/move", { sessionId, targetPath: join(work, "does-not-exist") });
  check(
    "move to a missing destination is refused with a coded error",
    nowhere.status === 500 && nowhere.json.error?.code === "target-invalid",
    `status=${nowhere.status} code=${nowhere.json.error?.code}`
  );
  check("the refused move left the session where it was", (await exists(sessionDir(wsB))) && (await readLogHeader(join(sessionDir(wsB), logName))).cwd === resolve(wsB));

  // --- archive / unarchive
  const archived = await post("/archive", { sessionId });
  const afterArchive = await listedSession(sessionId);
  check("archive returns ok and pins the id", archived.status === 200 && archived.json.archived === true, `status=${archived.status}`);
  check("list reports the session archived", Array.isArray(afterArchive.list.json.archivedSessionIds) && afterArchive.list.json.archivedSessionIds.includes(sessionId));

  const unarchived = await post("/unarchive", { sessionId });
  const afterUnarchive = await listedSession(sessionId);
  check("unarchive returns ok", unarchived.status === 200 && unarchived.json.archived === false, `status=${unarchived.status}`);
  check("list no longer reports it archived", !(afterUnarchive.list.json.archivedSessionIds ?? []).includes(sessionId));

  // --- move back B -> A
  const movedBack = await post("/move", { sessionId, targetPath: wsA });
  const afterMoveBack = await listedSession(sessionId);
  check("move back returns ok and is reflected in the list", movedBack.json.ok === true && afterMoveBack.session?.cwd === resolve(wsA), String(afterMoveBack.session?.cwd));

  // --- backup (portable archive of a v4 session)
  const backedUp = await post("/backup", { sessionId, targetDir: backupDir, format: "zip" });
  check("backup returns ok", backedUp.status === 200 && backedUp.json.ok === true, `status=${backedUp.status} body=${JSON.stringify(backedUp.json).slice(0, 140)}`);
  const members = readZip(await readFile(backedUp.json.backupPath)).map((m) => m.name);
  check("archive carries the current generation log", members.includes(logName), members.join(", "));
  check("manifest names the current generation log", backedUp.json.manifest?.logName === logName, String(backedUp.json.manifest?.logName));

  // --- delete
  const deleted = await post("/delete", { sessionId });
  const afterDelete = await listedSession(sessionId);
  check("delete returns ok", deleted.status === 200 && deleted.json.deleted === true, `status=${deleted.status} body=${JSON.stringify(deleted.json).slice(0, 140)}`);
  check("artifact directory gone", !(await exists(sessionDir(wsA))));
  check("session no longer listed", afterDelete.session === undefined);
} finally {
  await rm(sessionDir(wsA), { recursive: true, force: true });
  await rm(sessionDir(wsB), { recursive: true, force: true });
  await rm(join(sessionsRoot, projectKey(resolve(wsA))), { recursive: true, force: true });
  await rm(join(sessionsRoot, projectKey(resolve(wsB))), { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  const after = await post("/list", {}).catch(() => ({ status: 0 }));
  check("list route healthy after cleanup", after.status === 200, `status=${after.status}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "\nLIVE SESSION-OPS TEST PASSED" : `\nLIVE SESSION-OPS TEST FAILED (${failed} check(s))`);
process.exit(failed === 0 ? 0 : 1);
