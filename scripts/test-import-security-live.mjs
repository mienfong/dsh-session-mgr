// scripts/test-import-security-live.mjs — LIVE test that a crafted archive
// cannot write outside the extraction directory, against a running `dsh web`.
//
// The import unpacks a package into `<tmp>/dsh-import-*`, so a member named
// `../<sentinel>` would land in `<tmp>/<sentinel>` if the name were trusted
// (CWE-22, "zip-slip"). The import must refuse the whole package with a coded
// error, write nothing at all, and leave the session list healthy.
//
// Usage: node scripts/test-import-security-live.mjs [baseUrl] [dshHome]
//   baseUrl default http://127.0.0.1:3080/dsh-session-mgr
//   dshHome default: derived from the plugin's own attachmentStoreRoot()
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { attachmentStoreRoot, encodeSegment, makeZip, projectKey, readZip } from "../lib/host.js";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3080/dsh-session-mgr").replace(/\/+$/, "");
const dshHome = process.argv[3] ? resolve(process.argv[3]) : dirname(dirname(attachmentStoreRoot()));
const sessionsRoot = join(dshHome, "sessions");

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

const work = await mkdtemp(join(tmpdir(), "dsm-zipslip-live-"));
const targetDir = join(work, "workspace");
const sessionId = `session-${randomUUID()}`;
const destDir = join(sessionsRoot, projectKey(targetDir), encodeSegment(sessionId));
// the extraction dir is a sibling of the package's own mkdtemp entry, so this is
// exactly where a trusted `../` member would land
const sentinel = `dsm-escaped-${randomUUID()}.txt`;
const sentinelPath = join(tmpdir(), sentinel);

try {
  console.log(`baseUrl   = ${baseUrl}`);
  console.log(`sessionId = ${sessionId}`);
  console.log(`scenario  = a package whose member name is "../${sentinel}"\n`);

  await mkdir(targetDir, { recursive: true });
  const archive = join(work, `${encodeSegment(sessionId)}.zip`);
  await writeFile(archive, makeZip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify({
      schema: 1, kind: "dsh-session-export", sessionId, version: 3, createdAt: Date.now(),
      cwd: "D:\\OtherMachine\\X", logName: "session.v3.jsonl", attachments: []
    })) },
    { name: "session.v3.jsonl", data: Buffer.from(`${JSON.stringify({
      type: "session", version: 3, id: sessionId, createdAt: Date.now(), cwd: "D:\\OtherMachine\\X",
      isSeeded: false, delegationDepth: 0
    })}\n`) },
    { name: `../${sentinel}`, data: Buffer.from("pwned\n") }
  ]));

  // sanity: the archive really carries the traversal name
  const names = readZip(await readFile(archive)).map((m) => m.name);
  check("the crafted archive carries the traversal name", names.includes(`../${sentinel}`), names.join(", "));

  const res = await post("/import", { sourcePath: archive, targetPath: targetDir });
  const code = res.json && res.json.error && typeof res.json.error === "object" ? res.json.error.code : undefined;
  check("import is refused", res.status === 500 || res.json?.ok !== true, `status=${res.status}`);
  check("refusal carries a coded error", code === "unsafe-archive-member", `code=${code} body=${JSON.stringify(res.json).slice(0, 160)}`);

  check("nothing escaped the extraction directory", !(await exists(sentinelPath)), sentinelPath);
  check("no session directory was created", !(await exists(destDir)), destDir);

  const list = await post("/list", {});
  const listed = Array.isArray(list.json.sessions) ? list.json.sessions.some((s) => s.id === sessionId) : false;
  check("list route healthy and nothing imported", list.status === 200 && !listed, `status=${list.status} listed=${listed}`);
} finally {
  await rm(sentinelPath, { force: true });
  await rm(destDir, { recursive: true, force: true });
  await rm(join(sessionsRoot, projectKey(targetDir)), { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  check("sentinel cleaned up", !(await exists(sentinelPath)));
  const after = await post("/list", {}).catch(() => ({ status: 0 }));
  check("list route healthy after cleanup", after.status === 200, `status=${after.status}`);
}

// A directory package (no archive) is imported in place, so a manifest.logName
// carrying "../" would be joined against BOTH the package directory (read) and
// the session directory (write). The write is the dangerous half: a stray
// "*.jsonl*" file left in a project folder makes DSH reject the WHOLE sessions
// root, so every list call breaks. The import must refuse the name up front.
const work2 = await mkdtemp(join(tmpdir(), "dsm-logname-live-"));
const target2 = join(work2, "workspace");
const sessionId2 = `session-${randomUUID()}`;
const sentinel2 = `dsm-logname-${randomUUID()}.jsonl.zstd`;
const dest2 = join(sessionsRoot, projectKey(target2), encodeSegment(sessionId2));
const stray2 = join(sessionsRoot, projectKey(target2), sentinel2);
try {
  await mkdir(target2, { recursive: true });
  const pkg = join(work2, "pkg");
  await mkdir(pkg, { recursive: true });
  const header2 = JSON.stringify({
    type: "session", version: 3, id: sessionId2, createdAt: Date.now(), cwd: "D:\\OtherMachine\\X",
    isSeeded: false, delegationDepth: 0
  });
  await writeFile(join(pkg, "manifest.json"), JSON.stringify({
    schema: 1, kind: "dsh-session-export", sessionId: sessionId2, version: 3, createdAt: Date.now(),
    cwd: "D:\\OtherMachine\\X", logName: `../${sentinel2}`, attachments: []
  }));
  await writeFile(join(pkg, "session.v3.jsonl"), `${header2}\n`);
  await writeFile(join(work2, sentinel2), `${header2}\n`);

  const res2 = await post("/import", { sourcePath: pkg, targetPath: target2 });
  const code2 = res2.json && res2.json.error && typeof res2.json.error === "object" ? res2.json.error.code : undefined;
  check("directory package with a trailing-evil logName is refused", res2.status === 400 && code2 === "import-invalid-package", `status=${res2.status} code=${code2}`);
  check("no stray log file was written into the project folder", !(await exists(stray2)), stray2);
  check("no session directory was created for the refused package", !(await exists(dest2)), dest2);
  const list2 = await post("/list", {});
  const listed2 = Array.isArray(list2.json.sessions) ? list2.json.sessions.some((s) => s.id === sessionId2) : false;
  check("list route healthy after the refused directory package", list2.status === 200 && !listed2, `status=${list2.status} listed=${listed2}`);
} finally {
  await rm(stray2, { force: true });
  await rm(dest2, { recursive: true, force: true });
  await rm(join(sessionsRoot, projectKey(target2)), { recursive: true, force: true });
  await rm(work2, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "\nLIVE ZIP-SLIP TEST PASSED" : `\nLIVE ZIP-SLIP TEST FAILED (${failed} check(s))`);
process.exit(failed === 0 ? 0 : 1);
