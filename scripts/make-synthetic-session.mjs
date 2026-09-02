// scripts/make-synthetic-session.mjs — create a synthetic disposable session
// on disk in the live DSH home so backup/import can be tested end-to-end
// without touching real conversations and without the session.create API.
// Usage: node scripts/make-synthetic-session.mjs <home> <cwd> <sessionId>
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { constants, zstdCompressSync } from "node:zlib";
import { projectKey, encodeSegment } from "../lib/host.js";

const home = process.argv[2];
const cwd = process.argv[3];
const id = process.argv[4];
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

const header = JSON.stringify({
  type: "session", version: 3, id, createdAt: Date.now(), cwd, delegationDepth: 0, agentPreset: "standard"
}) + "\n";
const body = JSON.stringify({ type: "turn/start", seq: 0, time: 1, data: { turn: 1 } }) + "\n";
const dir = join(home, "sessions", projectKey(cwd), encodeSegment(id));
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "session.jsonl.zstd"), Buffer.concat([
  zstdCompressSync(Buffer.from(header), CHECKSUM_OPTIONS),
  zstdCompressSync(Buffer.from(body), CHECKSUM_OPTIONS)
]));
console.log(JSON.stringify({ id, dir }));
