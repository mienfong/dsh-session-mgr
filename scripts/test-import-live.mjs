// scripts/test-import-live.mjs — LIVE end-to-end test of the import path,
// including attachment restore, against a running `dsh web` instance.
//
// It builds a synthetic export package (manifest + session log + one attachment
// blob that does NOT exist in this machine's store yet), imports it over HTTP
// into a throw-away temp workspace, then verifies:
//   1. the session folder landed under <DSH_HOME>/sessions/<projectKey(target)>/<id>/
//   2. the log header `cwd` was remapped to the destination
//   3. the packaged attachment was materialised into <DSH_HOME>/attachments/v1
//      with a byte-exact digest
//   4. everything can be cleaned up again (session deleted, store object removed)
//
// Nothing real is touched: the session id is random and the a fake `cwd` is used
// so a remap failure cannot be confused with a no-op.
//
// Usage: node scripts/test-import-live.mjs [baseUrl] [dshHome]
//   baseUrl default http://127.0.0.1:3080/dsh-session-mgr
//   dshHome default: derived from the plugin's own attachmentStoreRoot()
// Env: DSM_TEST_LOG_NAME names the package's log file (default `session.v3.jsonl`,
//   the realistic DSH 0.1.5 layout). Set it to `session.jsonl` to exercise the
//   generation-mismatch case (v0 filename, v3 header), which import must rename
//   instead of installing an artifact that breaks the whole sessions root.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { attachmentStoreRoot, collectAttachmentIds, encodeSegment, logEncodingOf, makeZip, projectKey, readLogHeader } from "../lib/host.js";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3080/dsh-session-mgr").replace(/\/+$/, "");
const storeRoot = attachmentStoreRoot();
const dshHome = process.argv[3] ? resolve(process.argv[3]) : dirname(dirname(storeRoot));
const sessionsRoot = join(dshHome, "sessions");

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
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

const work = await mkdtemp(join(tmpdir(), "dsm-import-live-"));
const targetDir = join(work, "workspace");
const pkgDir = join(work, "pkg");
const sessionId = `session-${randomUUID()}`;
const fakeCwd = "D:\\OtherMachine\\SomeProject";
const attachmentBytes = Buffer.concat([Buffer.from("DSM-IMPORT-LIVE-TEST\n"), randomBytes(4096)]);
const hex = createHash("sha256").update(attachmentBytes).digest("hex");
const attachmentId = `sha256:${hex}`;
const rel = `objects/${hex.slice(0, 2)}/${hex}`;
const storeFile = join(storeRoot, ...rel.split("/"));
const createdAt = Date.now();

let imported = false;
let destDir = null;
try {
  console.log(`baseUrl      = ${baseUrl}`);
  console.log(`dshHome      = ${dshHome}`);
  console.log(`sessionId    = ${sessionId}`);
  console.log(`attachmentId = ${attachmentId}`);

  // --- 0. the attachment must NOT be in the store yet, or the test proves nothing
  const preexisting = await stat(storeFile).then(() => true, () => false);
  check("attachment absent from store before import", !preexisting, storeFile);

  // --- 1. build a synthetic export package (plaintext log keeps it dependency-free).
  //        The log filename must declare the generation the header announces: DSH
  //        rejects `session.jsonl` (v0) when its header says version 3.
  const logName = process.env.DSM_TEST_LOG_NAME ?? "session.v3.jsonl";
  await mkdir(join(pkgDir, "attachments", "v1", ...rel.split("/").slice(0, -1)), { recursive: true });
  await mkdir(targetDir, { recursive: true });
  const header = JSON.stringify({
    type: "session", version: 3, id: sessionId, createdAt, cwd: fakeCwd,
    isSeeded: false, delegationDepth: 0, agentPreset: "standard"
  });
  const event = JSON.stringify({
    type: "message/user", seq: 0, time: createdAt,
    data: { text: "live import test", images: [{ attachmentId, mimeType: "image/png" }] }
  });
  await writeFile(join(pkgDir, logName), `${header}\n${event}\n`);
  await writeFile(join(pkgDir, "attachments", "v1", ...rel.split("/")), attachmentBytes);
  await writeFile(join(pkgDir, "manifest.json"), JSON.stringify({
    schema: 1, kind: "dsh-session-export", sessionId, version: 3, createdAt,
    cwd: fakeCwd, delegationDepth: 0, agentPreset: "standard",
    logName, attachments: [rel], exportedAt: new Date().toISOString()
  }, null, 2));
  const archive = join(work, `${encodeSegment(sessionId)}.zip`);
  await writeFile(archive, makeZip([
    { name: "manifest.json", data: await readFile(join(pkgDir, "manifest.json")) },
    { name: logName, data: await readFile(join(pkgDir, logName)) },
    { name: `attachments/v1/${rel}`, data: attachmentBytes }
  ]));

  // --- 2. import it over HTTP into the temp workspace
  const res = await post("/import", { sourcePath: archive, targetPath: targetDir });
  if (res.status !== 200 || !res.json.ok) {
    check("import request returned ok", false, `status=${res.status} body=${JSON.stringify(res.json)}`);
    throw new Error("import failed");
  }
  imported = true;
  check("import request returned ok", true, `attachments=${res.json.attachments}`);

  // --- 3. session folder + header remap
  destDir = join(sessionsRoot, projectKey(res.json.cwd), encodeSegment(sessionId));
  check("session folder installed", await stat(destDir).then(() => true, () => false), destDir);
  check("reported cwd is the destination", res.json.cwd === resolve(targetDir), res.json.cwd);
  check("header cwd rewritten (not the source machine path)", res.json.cwd !== fakeCwd);
  const installedName = (res.json.logs ?? [])[0];
  const installedHeader0 = await readLogHeader(join(destDir, installedName));
  check("log header cwd remapped on disk", installedHeader0.cwd === resolve(targetDir), String(installedHeader0.cwd));
  check("log header id preserved", installedHeader0.id === sessionId);
  const installedRaw = await readFile(join(destDir, installedName));
  check("event line untouched (attachment ref still present)", collectAttachmentIds(installedRaw).includes(attachmentId));

  // --- 4. attachment materialised into the real store, byte-exact
  const restored = await stat(storeFile).then(() => true, () => false);
  check("attachment restored into the store", restored, storeFile);
  if (restored) {
    const got = createHash("sha256").update(await readFile(storeFile)).digest("hex");
    check("restored attachment digest matches", got === hex, got.slice(0, 16) + "…");
  }
  check("import reported 1 restored attachment", res.json.attachments === 1, String(res.json.attachments));

  // --- 5. the log container AND its generation must match this machine, or DSH's
  //        own reader rejects the whole sessions root (what this test guards).
  const expectedLog = res.json.logEncoding === "zstd" ? "session.v3.jsonl.zstd" : "session.v3.jsonl";
  check("import reported the local log container", res.json.logEncoding === "zstd" || res.json.logEncoding === "none", String(res.json.logEncoding));
  check("installed log is canonical for its header version", installedName === expectedLog, `${installedName} vs ${expectedLog}`);
  const logFiles = (await readdir(destDir)).filter((name) => logEncodingOf(name) !== undefined);
  check("exactly one log file, correctly named", logFiles.length === 1 && logFiles[0] === expectedLog, logFiles.join(","));

  // --- 6. the harness session list must survive the import (regression guard)
  const afterImport = await post("/list", {});
  const listed = Array.isArray(afterImport.json.sessions) ? afterImport.json.sessions.some((s) => s.id === sessionId) : false;
  check("list route healthy after import", afterImport.status === 200 && listed, `status=${afterImport.status} listed=${listed}`);
} finally {
  // --- 5. clean up: delete the imported session, drop the store object, remove temps
  if (imported) {
    const del = await post("/delete", { sessionId }).catch((error) => ({ status: 0, json: { error: String(error) } }));
    const gone = !(await stat(destDir ?? join(sessionsRoot, projectKey(resolve(targetDir)), encodeSegment(sessionId))).then(() => true, () => false));
    check("imported session deleted again", del.json && del.json.ok === true && gone, `status=${del.status}`);
  }
  await rm(storeFile, { force: true });
  await rm(work, { recursive: true, force: true });
  const storeClean = !(await stat(storeFile).then(() => true, () => false));
  check("temp store object removed", storeClean);
  const afterDelete = await post("/list", {}).catch(() => ({ status: 0, json: {} }));
  check("list route healthy after cleanup", afterDelete.status === 200, `status=${afterDelete.status}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "\nLIVE IMPORT TEST PASSED" : `\nLIVE IMPORT TEST FAILED (${failed} check(s))`);
process.exit(failed === 0 ? 0 : 1);
