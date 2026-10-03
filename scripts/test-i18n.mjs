// scripts/test-i18n.mjs — mechanical self-check for the two drift classes that
// reach users directly and are invisible in review:
//
//   1. a trilingual UI whose three tables disagree: a key present in one
//      language and missing in another renders as the raw key or as English,
//      and a `t("...")` call with no entry anywhere is worse;
//   2. a host error code with no message: every `fail(code, ...)` and
//      `rollback(code, ...)` must have an `err.<code>` entry in all three
//      tables, or the user gets a raw English sentence from a plugin that
//      claims to be trilingual.
//
// No server and no dependencies: it parses the two source files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = readFileSync(join(root, "lib", "client.js"), "utf8");
const host = readFileSync(join(root, "lib", "host.js"), "utf8");

let failures = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// --- 1. the three STR tables -------------------------------------------------
const lines = client.split(/\r?\n/);
const starts = [];
lines.forEach((line, index) => {
  const match = /^\s{6}"?(en|zh-CN|zh-TW)"?:\s*\{\s*$/.exec(line);
  if (match) starts.push({ lang: match[1], at: index });
});
const tables = {};
for (let i = 0; i < starts.length; i++) {
  const from = starts[i].at + 1;
  let to = lines.length;
  for (let j = from; j < lines.length; j++) {
    if (/^\s{4,6}\},?\s*$/.test(lines[j])) { to = j; break; }
  }
  tables[starts[i].lang] = new Set([...lines.slice(from, to).join("\n").matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
}
const langs = starts.map((s) => s.lang);
check("all three language tables are found", langs.length === 3, langs.join(", "));

const allKeys = new Set(langs.flatMap((lang) => [...tables[lang]]));
let incomplete = 0;
for (const key of [...allKeys].sort()) {
  const missing = langs.filter((lang) => !tables[lang].has(key));
  if (missing.length > 0) {
    incomplete++;
    console.log(`      missing in ${missing.join(", ")}: ${key}`);
  }
}
check("the tables define exactly the same keys", incomplete === 0, `${allKeys.size} keys, ${incomplete} incomplete`);

const used = [...new Set([...client.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]))].filter((key) => key !== "err.");
const undefinedKeys = used.filter((key) => !allKeys.has(key));
check("every t(\"…\") key used in code exists", undefinedKeys.length === 0, undefinedKeys.join(", "));

// --- 2. host error codes -----------------------------------------------------
const codes = [...new Set([...host.matchAll(/\b(?:fail|rollback)\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]))];
check("the host declares at least one error code", codes.length > 0, `${codes.length} codes`);
const unmapped = codes.filter((code) => langs.some((lang) => !tables[lang].has(`err.${code}`)));
check("every host error code is translated in all three languages", unmapped.length === 0, unmapped.join(", "));

const deadErrors = [...allKeys].filter((key) => key.startsWith("err.") && !codes.includes(key.slice(4)) && key !== "err.invalidResponse" && key !== "err.prefix");
check("no dead err.* entries", deadErrors.length === 0, deadErrors.join(", "));

console.log(failures === 0 ? "\nI18N SELF-CHECK PASSED" : `\nI18N SELF-CHECK FAILED (${failures} check(s))`);
assert.ok(true);
process.exit(failures === 0 ? 0 : 1);
