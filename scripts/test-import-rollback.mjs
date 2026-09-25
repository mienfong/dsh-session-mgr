// scripts/test-import-rollback.mjs — LIVE test that a failed import leaves
// nothing behind, against a running `dsh web` instance.
//
// A hand-built package can name its log `.zstd` while the bytes are plaintext
// (or ship a zero-byte log). The compatibility scan cannot decode that, and the
// import must fail with a CODED error and remove the session directory it had
// already created — a half-installed directory is exactly the stranded artifact
// that makes the harness' own session reads fail for the whole root.
//
// Usage: node scripts/test-import-rollback.mjs [baseUrl] [dshHome]
//   baseUrl default http://127.0.0.1:3080/dsh-session-mgr
//   dshHome default: derived from the plugin's own attachmentStoreRoot()
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { attachmentStoreRoot, encodeSegment, makeZip, projectKey } from "../lib/host.js";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3080/dsh-session-mgr").replace(/\/+$/, "");
const storeRoot = attachmentStoreRoot();
const dshHome = process.argv[3] ? resolve(process.argv[3]) : dirname(dirname(storeRoot));
const sessionsRoot = join(dshHome, "sessions");
const logName = "session.v3.jsonl.zstd";

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

const work = await mkdtemp(join(tmpdir(), "dsm-rollback-live-"));
const targetDir = join(work, "workspace");
const pkgDir = join(work, "pkg");
const sessionId = `session-${randomUUID()}`;
const destDir = join(sessionsRoot, projectKey(targetDir), encodeSegment(sessionId));

try {
  console.log(`baseUrl   = ${baseUrl}`);
  console.log(`sessionId = ${sessionId}`);
  console.log(`scenario  = a log named ${logName} whose bytes are plaintext\n`);

  await mkdir(pkgDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  const header = JSON.stringify({
    type: "session", version: 3, id: sessionId, createdAt: Date.now(), cwd: "D:\\OtherMachine\\X",
    isSeeded: false, delegationDepth: 0
  }) + "\n";
  // named `.zstd`, but plaintext bytes: the compatibility scan cannot decode it
  await writeFile(join(pkgDir, logName), header);
  await writeFile(join(pkgDir, "manifest.json"), JSON.stringify({
    schema: 1, kind: "dsh-session-export", sessionId, version: 3, createdAt: Date.now(),
    cwd: "D:\\OtherMachine\\X", logName, attachments: []
  }, null, 2));
  const archive = join(work, `${encodeSegment(sessionId)}.zip`);
  await writeFile(archive, makeZip([
    { name: "manifest.json", data: await readFile(join(pkgDir, "manifest.json")) },
    { name: logName, data: await readFile(join(pkgDir, logName)) }
  ]));

  const res = await post("/import", { sourcePath: archive, targetPath: targetDir });
  const code = res.json && res.json.error && typeof res.json.error === "object" ? res.json.error.code : undefined;
  check("import is refused", res.status === 500 || res.json?.ok !== true, `status=${res.status}`);
  check("refusal carries a coded error", code === "import-log-unreadable", `code=${code} body=${JSON.stringify(res.json).slice(0, 160)}`);
  check("no session directory left behind", !(await stat(destDir).then(() => true, () => false)), destDir);

  const list = await post("/list", {});
  const listed = Array.isArray(list.json.sessions) ? list.json.sessions.some((s) => s.id === sessionId) : false;
  check("list route healthy afterwards", list.status === 200, `status=${list.status}`);
  check("the failed import is not listed", !listed);
} finally {
  await rm(destDir, { recursive: true, force: true });
  // the import created the project folder for the temp workspace; drop it when empty
  await rm(join(sessionsRoot, projectKey(targetDir)), { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  const list = await post("/list", {}).catch(() => ({ status: 0 }));
  check("list route healthy after cleanup", list.status === 200, `status=${list.status}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "\nLIVE ROLLBACK TEST PASSED" : `\nLIVE ROLLBACK TEST FAILED (${failed} check(s))`);
process.exit(failed === 0 ? 0 : 1);
