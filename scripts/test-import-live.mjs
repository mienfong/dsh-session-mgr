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
  // the import created the project folder that anchors the throw-away workspace
  await rm(join(sessionsRoot, projectKey(resolve(targetDir))), { recursive: true, force: true });
  const storeClean = !(await stat(storeFile).then(() => true, () => false));
  check("temp store object removed", storeClean);
  const afterDelete = await post("/list", {}).catch(() => ({ status: 0, json: {} }));
  check("list route healthy after cleanup", afterDelete.status === 200, `status=${afterDelete.status}`);
}

// --- 8. a package whose manifest and log disagree about the session id must be
//        refused. Installing it would create <encodeSegment(manifestId)> while
//        DSH locates the session by the header id: a directory no side can reach.
const tamperWork = await mkdtemp(join(tmpdir(), "dsm-import-mismatch-"));
try {
  const tamperTarget = join(tamperWork, "workspace");
  const manifestId = `session-${randomUUID()}`;
  const headerId = `session-${randomUUID()}`;
  const tamperPkg = join(tamperWork, "pkg");
  await mkdir(tamperPkg, { recursive: true });
  await mkdir(tamperTarget, { recursive: true });
  const tamperHeader = JSON.stringify({
    type: "session", version: 3, id: headerId, createdAt, cwd: fakeCwd,
    isSeeded: false, delegationDepth: 0, agentPreset: "standard"
  });
  await writeFile(join(tamperPkg, "session.v3.jsonl"), `${tamperHeader}\n`);
  await writeFile(join(tamperPkg, "manifest.json"), JSON.stringify({
    schema: 1, kind: "dsh-session-export", sessionId: manifestId, version: 3, createdAt,
    cwd: fakeCwd, delegationDepth: 0, agentPreset: "standard",
    logName: "session.v3.jsonl", attachments: [], exportedAt: new Date().toISOString()
  }, null, 2));
  const tamperArchive = join(tamperWork, "tampered.zip");
  await writeFile(tamperArchive, makeZip([
    { name: "manifest.json", data: await readFile(join(tamperPkg, "manifest.json")) },
    { name: "session.v3.jsonl", data: await readFile(join(tamperPkg, "session.v3.jsonl")) }
  ]));
  const tamperRes = await post("/import", { sourcePath: tamperArchive, targetPath: tamperTarget });
  check(
    "id-mismatched package is refused",
    tamperRes.status === 400 && tamperRes.json?.error?.code === "import-session-mismatch",
    `status=${tamperRes.status} code=${tamperRes.json?.error?.code}`
  );
  const tamperProject = join(sessionsRoot, projectKey(resolve(tamperTarget)));
  const leftovers = await readdir(tamperProject).catch(() => []);
  check("refused package left no session directory", leftovers.length === 0, leftovers.join(","));
  const tamperList = await post("/list", {});
  check("list route healthy after refused import", tamperList.status === 200, `status=${tamperList.status}`);
  await rm(tamperProject, { recursive: true, force: true });
} finally {
  await rm(tamperWork, { recursive: true, force: true });
}

// --- 9. a hand-made package (a zipped session folder with no manifest) must be
//        importable when its log uses the generation filename DSH currently
//        writes (`session.v4.jsonl`), not only the legacy `session.jsonl`.
const bareWork = await mkdtemp(join(tmpdir(), "dsm-import-bare-"));
try {
  const bareTarget = join(bareWork, "workspace");
  const bareId = `session-${randomUUID()}`;
  await mkdir(bareTarget, { recursive: true });
  const barePkg = join(bareWork, "folder");
  await mkdir(barePkg, { recursive: true });
  const bareHeader = JSON.stringify({ type: "session", version: 4, id: bareId, createdAt, cwd: fakeCwd, delegationDepth: 0 });
  await writeFile(join(barePkg, "session.v4.jsonl"), `${bareHeader}\n`);
  const bareRes = await post("/import", { sourcePath: barePkg, targetPath: bareTarget });
  check(
    "hand-zipped session.v4 folder imports",
    bareRes.status === 200 && bareRes.json?.sessionId === bareId,
    `status=${bareRes.status} code=${bareRes.json?.error?.code}`
  );
  if (bareRes.status === 200) {
    const del = await post("/delete", { sessionId: bareId });
    check("bare-log import cleaned up", del.status === 200, `status=${del.status}`);
  }
  await rm(join(sessionsRoot, projectKey(resolve(bareTarget))), { recursive: true, force: true });
} finally {
  await rm(bareWork, { recursive: true, force: true });
}

// --- 10. a package whose manifest lists an attachment it does not actually
//         carry must say so: the session installs, but its first send would fail
//         with ATTACHMENT_NOT_FOUND, which is invisible from the import result.
const missingWork = await mkdtemp(join(tmpdir(), "dsm-import-missing-"));
try {
  const missingTarget = join(missingWork, "workspace");
  const missingId = `session-${randomUUID()}`;
  await mkdir(missingTarget, { recursive: true });
  const missingPkg = join(missingWork, "pkg");
  await mkdir(missingPkg, { recursive: true });
  const missingHeader = JSON.stringify({ type: "session", version: 3, id: missingId, createdAt, cwd: fakeCwd, delegationDepth: 0 });
  await writeFile(join(missingPkg, "session.v3.jsonl"), `${missingHeader}\n`);
  await writeFile(join(missingPkg, "manifest.json"), JSON.stringify({
    schema: 1, kind: "dsh-session-export", sessionId: missingId, version: 3, createdAt,
    cwd: fakeCwd, delegationDepth: 0, logName: "session.v3.jsonl",
    attachments: ["objects/aa/bb"], exportedAt: new Date().toISOString()
  }, null, 2));
  const missingArchive = join(missingWork, "pkg.zip");
  await writeFile(missingArchive, makeZip([
    { name: "manifest.json", data: await readFile(join(missingPkg, "manifest.json")) },
    { name: "session.v3.jsonl", data: await readFile(join(missingPkg, "session.v3.jsonl")) }
  ]));
  const missingRes = await post("/import", { sourcePath: missingArchive, targetPath: missingTarget });
  check(
    "missing packaged attachment is reported",
    missingRes.status === 200
      && Array.isArray(missingRes.json?.missingAttachments)
      && missingRes.json.missingAttachments.length === 1,
    `status=${missingRes.status} missing=${JSON.stringify(missingRes.json?.missingAttachments)}`
  );
  if (missingRes.status === 200) {
    const del = await post("/delete", { sessionId: missingId });
    check("missing-attachment import cleaned up", del.status === 200, `status=${del.status}`);
  }
  await rm(join(sessionsRoot, projectKey(resolve(missingTarget))), { recursive: true, force: true });
} finally {
  await rm(missingWork, { recursive: true, force: true });
}

// --- 11. a manifest may name a log that exists but is a DIRECTORY; the read
//         used to fail with a raw EISDIR (500) instead of a coded refusal.
const dirLogWork = await mkdtemp(join(tmpdir(), "dsm-import-dirlog-"));
try {
  const dirLogTarget = join(dirLogWork, "workspace");
  const dirLogId = `session-${randomUUID()}`;
  await mkdir(dirLogTarget, { recursive: true });
  const dirLogPkg = join(dirLogWork, "pkg");
  await mkdir(join(dirLogPkg, "session.v3.jsonl"), { recursive: true });
  await writeFile(join(dirLogPkg, "manifest.json"), JSON.stringify({
    schema: 1, kind: "dsh-session-export", sessionId: dirLogId, version: 3, createdAt,
    cwd: fakeCwd, delegationDepth: 0, logName: "session.v3.jsonl", attachments: []
  }, null, 2));
  const dirLogRes = await post("/import", { sourcePath: dirLogPkg, targetPath: dirLogTarget });
  check(
    "a log name that is a directory is refused",
    dirLogRes.status === 400 && dirLogRes.json?.error?.code === "import-invalid-package",
    `status=${dirLogRes.status} code=${dirLogRes.json?.error?.code}`
  );
  const dirLogProject = join(sessionsRoot, projectKey(resolve(dirLogTarget)));
  check("directory-log package left no session directory", (await readdir(dirLogProject).catch(() => [])).length === 0);
  const dirLogList = await post("/list", {});
  check("list route healthy after the directory-log refusal", dirLogList.status === 200, `status=${dirLogList.status}`);
  await rm(dirLogProject, { recursive: true, force: true });
} finally {
  await rm(dirLogWork, { recursive: true, force: true });
}

// --- 12. Backup -> Delete -> Import round trip: the restored session must land
//         in its project folder (not one project deeper), and importing the same
//         id again must be refused instead of installing a duplicate.
const roundTripWork = await mkdtemp(join(tmpdir(), "dsm-import-roundtrip-"));
try {
  const roundTripTarget = join(roundTripWork, "workspace");
  const roundTripId = `session-${randomUUID()}`;
  await mkdir(roundTripTarget, { recursive: true });
  const roundTripArchive = join(roundTripWork, "pkg.zip");
  const roundTripHeader = JSON.stringify({ type: "session", version: 4, id: roundTripId, createdAt, cwd: fakeCwd, delegationDepth: 0 });
  await writeFile(roundTripArchive, makeZip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify({
      schema: 1, kind: "dsh-session-export", sessionId: roundTripId, version: 4, createdAt,
      cwd: fakeCwd, delegationDepth: 0, logName: "session.v4.jsonl", attachments: []
    }, null, 2)) },
    { name: "session.v4.jsonl", data: Buffer.from(`${roundTripHeader}\n`) }
  ]));
  const firstImport = await post("/import", { sourcePath: roundTripArchive, targetPath: roundTripTarget });
  check("first import of a fresh session succeeds", firstImport.status === 200, `status=${firstImport.status}`);
  const backup = await post("/backup", { sessionId: roundTripId, targetDir: join(roundTripWork, "backups"), format: "targz" });
  check("targz backup of the imported session succeeds", backup.status === 200, `status=${backup.status}`);
  const deleted = await post("/delete", { sessionId: roundTripId });
  check("deleting the session before the round trip succeeds", deleted.status === 200 && deleted.json.deleted === true, `status=${deleted.status}`);
  const projectDir = join(sessionsRoot, projectKey(resolve(roundTripTarget)));
  const reimport = await post("/import", { sourcePath: backup.json.backupPath, targetPath: roundTripTarget });
  check(
    "a targz backup re-imports into its project folder",
    reimport.status === 200 && typeof reimport.json?.importPath === "string" && dirname(reimport.json.importPath) === projectDir,
    `status=${reimport.status} path=${reimport.json?.importPath}`
  );
  const restoredHeader = await readLogHeader(join(projectDir, encodeSegment(roundTripId), reimport.json.logs[0]));
  check(
    "the restored header gains isSeeded (the harness lists headers without it as unreadable)",
    restoredHeader?.isSeeded === false,
    `isSeeded=${restoredHeader?.isSeeded}`
  );
  const duplicate = await post("/import", { sourcePath: backup.json.backupPath, targetPath: roundTripTarget });
  check(
    "importing an existing session id is refused",
    duplicate.status === 409 && duplicate.json?.error?.code === "import-session-exists",
    `status=${duplicate.status} code=${duplicate.json?.error?.code}`
  );
  const projectEntries = await readdir(projectDir).catch(() => []);
  check(
    "the project folder holds exactly one session directory (no nested project)",
    projectEntries.length === 1 && projectEntries[0].startsWith("session-"),
    projectEntries.join(",")
  );
  const roundTripList = await post("/list", {});
  check(
    "the restored session is listed",
    Array.isArray(roundTripList.json.sessions) && roundTripList.json.sessions.some((s) => s.id === roundTripId),
    `status=${roundTripList.status}`
  );
  const roundTripCleanup = await post("/delete", { sessionId: roundTripId });
  check("round-trip session cleaned up", roundTripCleanup.status === 200 && roundTripCleanup.json.deleted === true, `status=${roundTripCleanup.status}`);
  await rm(projectDir, { recursive: true, force: true });
} finally {
  await rm(roundTripWork, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "\nLIVE IMPORT TEST PASSED" : `\nLIVE IMPORT TEST FAILED (${failed} check(s))`);
process.exit(failed === 0 ? 0 : 1);
