/**
 * dsh-session-mgr — host half.
 *
 * Lets the web UI manage conversations: move a conversation (or an archived
 * conversation) from one workspace to another, archive/unarchive, backup and
 * delete. A session belongs to a workspace through its session header `cwd`
 * (the directory the session was launched from); the workspace registry groups
 * sessions by that canonical path. "Moving" therefore means:
 *
 *   1. move the session artifact directory on disk from
 *      <root>/<projectKey(oldCwd)>/<id> to <root>/<projectKey(newCwd)>/<id>,
 *   2. rewrite the `cwd` field of the session header line (first line / first
 *      zstd frame) in the JSONL log,
 *   3. update the in-memory workspace registry (header index + session
 *      accounting) so the UI reflects the move without a restart.
 *
 * Sessions whose agent is currently running are refused. Live (attached) but
 * idle sessions are evicted from memory first so the next open reads the
 * rewritten header from disk. Archived state is registry-global and is
 * preserved across a move — an archived session simply keeps its archive flag
 * while its workspace accounting slot moves.
 *
 * HTTP API (all POST, JSON):
 *   POST /dsh-session-mgr/list       {}                          -> { ok, workspaces, sessions, archivedSessionIds, backupDefaultDir }
 *   POST /dsh-session-mgr/move       { sessionId, targetPath }   -> { ok, sessionId, archived, from, to }
 *   POST /dsh-session-mgr/archive    { sessionId }               -> { ok, archived, sessionId, archivedSessionIds }
 *   POST /dsh-session-mgr/unarchive  { sessionId }               -> { ok, archived, sessionId, changed, archivedSessionIds }
 *   POST /dsh-session-mgr/backup     { sessionId, targetDir }    -> { ok, sessionId, cwd, archived, backupPath, sizeBytes, manifest }
 *   POST /dsh-session-mgr/import     { sourceDir, targetPath }   -> { ok, sessionId, importPath, cwd, workspaceId?, workspaceTitle? }
 *   POST /dsh-session-mgr/delete     { sessionId }               -> { ok, sessionId, deleted, reason?, path, sizeBytes?, cwd? }
 *
 * `backup` produces a PORTABLE export package (folder + manifest.json) that
 * can be transferred to another machine and resumed via `import`, which
 * remaps the session header `cwd` to a directory that exists on this machine.
 *
 * Pure file helpers are exported for standalone testing.
 */

import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

export const name = "dsh-session-mgr";

/** Hard dependency: the harness HTTP carrier. */
export const inject = ["webServer"];

// ---------------------------------------------------------------------------
// Path / format helpers — format-compatible with
// @deepseek-ai/dsh-session-persistence-jsonl (pure, exported for tests).
// ---------------------------------------------------------------------------

const ZSTD_MAGIC = 4247762216; // 0xFD2FB528 little-endian
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

/** Encode an arbitrary string as one safe path segment (same scheme as the JSONL backend). */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error("cannot encode an empty path segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

/** Build the readable project-directory key for a cwd (same scheme as the JSONL backend). */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path");
  let readable = "";
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/** Locate complete zstd frame ranges (same structural scan as the JSONL backend). */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

/**
 * Rewrite the `cwd` field of a session log's header line.
 * @param raw - the raw log bytes (plaintext JSONL or concatenated zstd frames).
 * @param cwd - the new canonical workspace path.
 * @param compressed - whether the log is zstd-encoded.
 * @returns the full rewritten log bytes (event bytes untouched).
 */
export function rewriteLogHeader(raw, cwd, compressed) {
  if (!compressed) {
    const nl = raw.indexOf(10);
    if (nl === -1) throw new Error("corrupt session log: header line missing");
    const headerLine = raw.subarray(0, nl).toString("utf8");
    const rest = raw.subarray(nl + 1);
    const parsed = JSON.parse(headerLine);
    parsed.cwd = cwd;
    return Buffer.concat([Buffer.from(JSON.stringify(parsed) + "\n"), rest]);
  }
  const { frames } = scanZstdFrames(raw);
  if (frames.length === 0) throw new Error("empty or header-less Zstandard session log");
  const first = frames[0];
  const plaintext = zstdDecompressSync(raw.subarray(first.start, first.end)).toString("utf8");
  const nl = plaintext.indexOf("\n");
  if (nl === -1) throw new Error("corrupt Zstandard session log: header frame is not one header line");
  const parsed = JSON.parse(plaintext.slice(0, nl));
  parsed.cwd = cwd;
  const newFrame = zstdCompressSync(Buffer.from(JSON.stringify(parsed) + "\n"), CHECKSUM_OPTIONS);
  return Buffer.concat([newFrame, raw.subarray(first.end)]);
}

/**
 * Move a session's artifact directory to the project directory of `newCwd`,
 * rewriting the header `cwd` in place. Pure filesystem work, no services.
 *
 * Strategy: read the log once, rename the whole session directory (atomic on
 * the same volume; recursive copy fallback across volumes), then rewrite the
 * header line at the new location via a temp file + swap. The rename happens
 * before the header rewrite, so a crash in between leaves the session intact
 * at the new location with the old header — recoverable on restart (the
 * registry regroups by header cwd and persistence locates by id scan).
 *
 * @param oldLogPath - current session log path (locate() result).
 * @param newCwd - canonical destination directory path.
 * @param sessionId - the session id (used to name the session directory).
 * @param compressed - whether the log is zstd-encoded.
 * @returns move outcome details.
 */
export async function moveSessionFiles({ oldLogPath, newCwd, sessionId, compressed }) {
  const logName = basename(oldLogPath);
  const oldDir = dirname(oldLogPath);
  const root = dirname(dirname(oldDir));
  const newDir = join(root, projectKey(newCwd), encodeSegment(sessionId));
  const newLogPath = join(newDir, logName);
  if (newDir === oldDir) {
    return { moved: false, oldDir, newDir, newLogPath };
  }
  if (await exists(newLogPath)) {
    throw fail("collision", `A session folder with the same name already exists at the destination: ${newLogPath}`);
  }
  const raw = await readFile(oldLogPath);
  const newContent = rewriteLogHeader(raw, newCwd, compressed);
  await mkdir(dirname(newDir), { recursive: true });
  let renamed = false;
  try {
    await rename(oldDir, newDir);
    renamed = true;
  } catch (error) {
    if (error && error.code !== "EXDEV") throw error;
    // Cross-volume: recursive copy then remove the source.
    for (const entry of await readdir(oldDir, { withFileTypes: true })) {
      await cp(join(oldDir, entry.name), join(newDir, entry.name), { recursive: true, force: true });
    }
    await rm(oldDir, { recursive: true, force: true });
  }
  // Rewrite the header in place at the new location.
  const tmp = join(newDir, `.${logName}.move-${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, newContent);
  await rm(join(newDir, logName), { force: true });
  await rename(tmp, join(newDir, logName));
  return { moved: true, oldDir, newDir, newLogPath, renamed };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Create an Error carrying a stable machine code so the client can localize it. */
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// ---------------------------------------------------------------------------
// Service-aware orchestration.
// ---------------------------------------------------------------------------

function sessionRunning(ctx, sessionId) {
  const agents = ctx.get("agents");
  if (!agents || typeof agents.get !== "function") return false;
  const agent = agents.get(sessionId);
  return !!(agent && agent.status === "running");
}

/** Evict an idle live session from the in-memory store so the next open reads the rewritten header. */
function detachLive(ctx, sessionId) {
  const sessions = ctx.get("sessions");
  if (!sessions) return false;
  try {
    const store = sessions.store;
    if (!store || typeof store.get !== "function") return false;
    const entry = store.get(sessionId);
    if (!entry || typeof entry.detach !== "function") return false;
    entry.detach();
    return true;
  } catch {
    return false;
  }
}

async function findHeader(persistence, sessionId) {
  const headers = await persistence.list();
  return headers.find((h) => h.id === sessionId);
}

/** The workspace entity that accounts `sessionId`, if any. */
function workspaceAccountingFor(registry, sessionId) {
  for (const entity of registry.entities.values()) {
    if (entity.record.sessionIds.includes(sessionId)) return entity;
  }
  return undefined;
}

/**
 * Update the workspace registry's in-memory view after the disk move so the
 * sidebar reflects the new grouping immediately: header index, canonical-cwd
 * path index, and the old/new workspace session accounting.
 */
async function updateRegistryAccounting(ctx, sessionId, header, canonicalTarget, targetEntity) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry) return;
  const newHeader = { ...header, cwd: canonicalTarget };
  registry.headers.set(sessionId, newHeader);
  registry.sessionPaths.set(sessionId, canonicalTarget);
  registry.invalidSessionPaths.delete(sessionId);
  const oldWorkspace = workspaceAccountingFor(registry, sessionId);
  if (oldWorkspace !== undefined) await oldWorkspace.detachSession(sessionId);
  if (targetEntity !== undefined) await targetEntity.attachSession(sessionId);
}

/**
 * Perform the move for one session.
 * @param ctx - plugin context.
 * @param sessionId - the session to move.
 * @param targetPath - destination directory in any spelling (registered workspace or any existing dir).
 * @returns a description of the move.
 */
async function moveSession(ctx, sessionId, targetPath) {
  if (typeof sessionId !== "string" || sessionId.length === 0) throw fail("session-id-required", "sessionId is required");
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) throw fail("target-required", "A destination path is required");
  const registry = ctx.get("workspaceRegistry");
  const persistence = ctx.get("sessionPersistence");
  if (!registry) throw fail("registry-unavailable", "Workspace registry service is unavailable");
  if (!persistence) throw fail("persistence-unavailable", "Session persistence service is unavailable");
  if (sessionRunning(ctx, sessionId)) throw fail("session-running", `Session is running and cannot be moved: ${sessionId}`);

  // Accept either a real directory path or a registered workspace id.
  const targetWorkspace = registry.get(targetPath.trim());
  const resolvedTarget = targetWorkspace !== undefined ? targetWorkspace.path : targetPath;

  const header = await findHeader(persistence, sessionId);
  if (header === undefined) throw fail("session-not-found", `No persisted record found for session: ${sessionId}`);
  const oldCwd = header.cwd;
  if (typeof oldCwd !== "string" || oldCwd.length === 0) {
    throw fail("no-cwd", `Session has no cwd record; its workspace cannot be determined: ${sessionId}`);
  }

  let canonicalTarget;
  try {
    canonicalTarget = await realpath(resolvedTarget);
  } catch (error) {
    throw fail("target-invalid", `Cannot resolve the destination path (it may not exist): ${resolvedTarget}`);
  }
  try {
    if (!(await stat(canonicalTarget)).isDirectory()) {
      throw fail("target-not-dir", `The destination path is not a directory: ${canonicalTarget}`);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") throw fail("target-not-exists", `The destination path does not exist: ${canonicalTarget}`);
    throw error;
  }
  let oldCanonical;
  try {
    oldCanonical = await realpath(oldCwd);
  } catch {
    oldCanonical = oldCwd;
  }
  if (oldCanonical === canonicalTarget) {
    throw fail("already-in-workspace", "This session is already in that workspace");
  }

  const located = persistence.locate(header);
  if (!located || typeof located.path !== "string" || located.path.length === 0) {
    throw fail("locate-failed", `Cannot locate the session archive: ${sessionId}`);
  }
  const compressed = located.path.endsWith(".jsonl.zstd");
  if (!(await exists(located.path))) {
    throw fail("artifact-missing", `Session archive is missing (possibly deleted from disk): ${located.path}`);
  }

  const targetEntity = await registry.resolveByPath(canonicalTarget);
  const fromWorkspace = workspaceAccountingFor(registry, sessionId);
  const archived = Array.isArray(registry.archivedSessionIds) && registry.archivedSessionIds.includes(sessionId);

  let moved = null;
  try {
    moved = await moveSessionFiles({ oldLogPath: located.path, newCwd: canonicalTarget, sessionId, compressed });
    // Evict an idle live session so the rewritten header is authoritative on
    // next open — only after the disk move succeeded, so a failed move never
    // leaves the session detached.
    if (ctx.get("sessions") && ctx.get("sessions").get(sessionId) !== undefined) {
      if (!detachLive(ctx, sessionId)) {
        throw fail("live-detach-failed", `Session is still resident in memory and cannot be evicted: ${sessionId}`);
      }
    }
    await updateRegistryAccounting(ctx, sessionId, header, canonicalTarget, targetEntity);
  } catch (error) {
    // Best-effort rollback of the disk move when a later step failed.
    if (moved && moved.moved) {
      try {
        await moveSessionFiles({ oldLogPath: moved.newLogPath, newCwd: oldCwd, sessionId, compressed });
      } catch (rollbackError) {
        ctx.logger?.warn?.("dsh-session-mgr: rollback failed: " + String(rollbackError));
      }
    }
    throw error;
  }

  return {
    sessionId,
    archived,
    from: {
      path: oldCanonical,
      workspaceId: fromWorkspace ? fromWorkspace.id : undefined,
      workspaceTitle: fromWorkspace ? fromWorkspace.title : undefined
    },
    to: {
      path: canonicalTarget,
      workspaceId: targetEntity ? targetEntity.id : undefined,
      workspaceTitle: targetEntity ? targetEntity.title : undefined
    }
  };
}

// ---------------------------------------------------------------------------
// list endpoint
// ---------------------------------------------------------------------------

async function buildList(ctx) {
  const registry = ctx.get("workspaceRegistry");
  const persistence = ctx.get("sessionPersistence");
  if (!registry || !persistence) return { workspaces: [], sessions: [], archivedSessionIds: [] };

  const workspaces = registry.list().map((entity) => ({
    id: entity.id,
    title: entity.title,
    path: entity.path,
    sessionCount: entity.sessionIds.length
  }));

  const archivedSessionIds = Array.isArray(registry.archivedSessionIds) ? [...registry.archivedSessionIds] : [];
  const headers = await persistence.list();

  const query = ctx.get("sessionQuery");
  const titles = new Map();
  if (query && typeof query.readTitleSnapshots === "function") {
    try {
      const results = await query.readTitleSnapshots(headers.map((h) => h.id));
      for (const r of results) {
        if (r && r.status === "fulfilled" && r.value && r.value.title && typeof r.value.title.title === "string") {
          titles.set(r.sessionId, r.value.title.title);
        }
      }
    } catch {
      // best effort
    }
  }

  const sessions = ctx.get("sessions");
  const agents = ctx.get("agents");
  const accountedBy = new Map();
  for (const entity of registry.entities.values()) {
    for (const id of entity.record.sessionIds) {
      if (!accountedBy.has(id)) accountedBy.set(id, entity);
    }
  }

  const items = [];
  for (const header of headers) {
    let entity = accountedBy.get(header.id);
    if (entity === undefined && typeof header.cwd === "string") {
      try {
        const canonical = await realpath(header.cwd);
        for (const ws of registry.entities.values()) {
          if (ws.path === canonical) {
            entity = ws;
            break;
          }
        }
      } catch {
        // ungrouped
      }
    }
    const agent = agents && typeof agents.get === "function" ? agents.get(header.id) : undefined;
    items.push({
      id: header.id,
      title: titles.get(header.id) || null,
      cwd: header.cwd || null,
      createdAt: header.createdAt,
      archived: archivedSessionIds.includes(header.id),
      running: !!(agent && agent.status === "running"),
      live: !!(sessions && typeof sessions.get === "function" && sessions.get(header.id) !== undefined),
      workspaceId: entity ? entity.id : undefined,
      workspaceTitle: entity ? entity.title : undefined
    });
  }
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { workspaces, sessions: items, archivedSessionIds, backupDefaultDir: backupDefaultDir() };
}

// ---------------------------------------------------------------------------
// HTTP route
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(Buffer.concat(chunks).toString("utf8"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Archive / unarchive
// ---------------------------------------------------------------------------

function sessionIdOf(args) {
  if (args === null || typeof args !== "object") throw fail("session-id-required", "sessionId is required");
  const id = args.sessionId;
  if (typeof id !== "string" || id.length === 0) throw fail("session-id-required", "sessionId is required");
  return id;
}

/**
 * Archive one session durably through the registry's official API. The
 * session keeps its workspace accounting slot (unarchiving restores the
 * position); it simply disappears from every grouping surface.
 */
async function archiveSession(ctx, sessionId) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry) throw fail("registry-unavailable", "Workspace registry service is unavailable");
  if (sessionRunning(ctx, sessionId)) throw fail("session-running", `Session is running and cannot be archived: ${sessionId}`);
  await registry.archiveSession(sessionId);
  return { ok: true, archived: true, sessionId, archivedSessionIds: [...registry.archivedSessionIds] };
}

/**
 * Remove one id from the durable archive set. The registry has no official
 * unarchive method, so this reaches into its durable state the same way the
 * archived-sessions plugin does (proven in production): write the next state
 * through the registry's own setState, falling back to the storage domain.
 * The session keeps its `sessionIds` slot, so unarchiving restores its
 * original workspace position.
 */
async function unarchiveSession(ctx, sessionId) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry) throw fail("registry-unavailable", "Workspace registry service is unavailable");
  if (!registry.state || typeof registry.state !== "object") {
    throw fail("registry-not-started", "Workspace registry is not started");
  }
  const current = registry.archivedSessionIds;
  if (!Array.isArray(current) || !current.includes(sessionId)) {
    throw fail("not-archived", `Session is not in the archive set: ${sessionId}`);
  }
  const next = current.filter((id) => id !== sessionId);
  const state = Object.assign({}, registry.state, { archivedSessionIds: next });
  if (typeof registry.setState === "function") {
    await registry.setState(state);
    return { ok: true, archived: false, sessionId, changed: true, archivedSessionIds: [...state.archivedSessionIds] };
  }
  const domain = ctx.get("storageDomain");
  if (!domain) throw fail("domain-unavailable", "Storage domain service is unavailable");
  const unit = domain.get("workspace");
  if (!unit || !unit.global || typeof unit.global.set !== "function") {
    throw fail("domain-unavailable", "Workspace domain is not open");
  }
  await unit.global.set(state);
  registry.state = state;
  return { ok: true, archived: false, sessionId, changed: true, archivedSessionIds: [...state.archivedSessionIds] };
}

// ---------------------------------------------------------------------------
// Backup / delete
// ---------------------------------------------------------------------------

/** Recursive byte size of a directory (bounded depth). */
async function dirSizeBytes(dir, depth) {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return info.size || 0;
    if (depth > 10) return 0;
    let total = 0;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const child = join(dir, entry.name);
      total += entry.isDirectory() ? await dirSizeBytes(child, depth + 1) : (entry.isSymbolicLink() ? 0 : (await stat(child).catch(() => 0))?.size ?? 0);
    }
    return total;
  } catch {
    return 0;
  }
}

function dshHomeDir() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

/** Default backup root: <DSH_HOME>/backups/sessions (created on demand). */
export function backupDefaultDir() {
  return join(dshHomeDir(), "backups", "sessions");
}

/** Locate a session's artifact directory + header, or throw. */
async function locateSession(ctx, sessionId) {
  const persistence = ctx.get("sessionPersistence");
  if (!persistence) throw fail("persistence-unavailable", "Session persistence service is unavailable");
  const header = await findHeader(persistence, sessionId);
  if (header === undefined) throw fail("session-not-found", `No persisted record found for session: ${sessionId}`);
  const located = persistence.locate(header);
  if (!located || typeof located.path !== "string" || located.path.length === 0) {
    throw fail("locate-failed", `Cannot locate the session archive: ${sessionId}`);
  }
  return { persistence, header, logPath: located.path };
}

/**
 * Export one session as a PORTABLE package that can be re-imported on another
 * machine and resumed seamlessly. The package is a folder
 * `<targetDir>/<encodedSessionId>/` containing:
 *   - `manifest.json` — session metadata and the original `cwd` (informational)
 *   - the session log (`session.jsonl(.zstd)`), whose header carries `cwd`
 *   - any session-local artifact files
 *
 * Because a session's workspace membership is derived from its header `cwd`
 * (an absolute path), the same log resumed on another machine must have `cwd`
 * remapped to a path that exists there. Import does that remap — the
 * conversation content is untouched, so it continues seamlessly.
 * Running sessions are refused (the log may be mid-append).
 */
async function backupSession(ctx, sessionId, targetDir) {
  if (typeof targetDir !== "string" || targetDir.trim().length === 0) {
    throw fail("backup-dir-required", "A backup folder path is required");
  }
  if (sessionRunning(ctx, sessionId)) throw fail("session-running", `Session is running and cannot be exported: ${sessionId}`);
  const { header, logPath } = await locateSession(ctx, sessionId);
  const sourceDir = dirname(logPath);
  if (!(await exists(sourceDir))) {
    throw fail("artifact-missing", `Session archive folder is missing (possibly deleted from disk): ${sourceDir}`);
  }
  const destRoot = resolve(targetDir);
  await mkdir(destRoot, { recursive: true });
  const info = await stat(destRoot).catch(() => undefined);
  if (!info || !info.isDirectory()) throw fail("backup-dir-not-dir", `The backup folder is not a directory: ${destRoot}`);
  const destDir = join(destRoot, encodeSegment(sessionId));
  if (await exists(destDir)) {
    throw fail("backup-collision", `A backup package with the same name already exists; refused to overwrite: ${destDir}`);
  }
  // Copy the whole session folder (log + artifacts), then add the manifest.
  await cp(sourceDir, destDir, { recursive: true, force: false });
  const logName = basename(logPath);
  if (!(await exists(join(destDir, logName)))) {
    await rm(destDir, { recursive: true, force: true });
    throw fail("backup-verify-failed", `Export failed: ${logName} was not written to the destination`);
  }
  // Best-effort title is already in the log (session/title events); record it here for reference.
  const manifest = {
    schema: 1,
    kind: "dsh-session-export",
    sessionId,
    version: header.version,
    createdAt: header.createdAt,
    cwd: header.cwd ?? null,
    parentSession: header.parentSession ?? null,
    agentPreset: header.agentPreset ?? null,
    origin: header.origin ?? null,
    delegationDepth: header.delegationDepth ?? 0,
    logName,
    exportedAt: new Date().toISOString()
  };
  await writeFile(join(destDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const sizeBytes = await dirSizeBytes(destDir, 0);
  return {
    ok: true,
    sessionId,
    cwd: header.cwd ?? null,
    archived: Array.isArray(ctx.get("workspaceRegistry")?.archivedSessionIds)
      ? ctx.get("workspaceRegistry").archivedSessionIds.includes(sessionId)
      : false,
    backupPath: destDir,
    sizeBytes,
    manifest
  };
}

/**
 * Import a portable export package (the folder produced by backupSession) and
 * install it as a live session in THIS machine's DSH home, remapping its
 * header `cwd` to `targetPath` (a directory that exists here). This is what
 * makes a conversation backed up on one machine resumable on another: the
 * events are untouched, only the workspace anchor is replaced.
 *
 * Steps:
 *   1. read <sourceDir>/manifest.json; require `sessionId` and the log file;
 *   2. rewrite the log header `cwd` to the canonical target path;
 *   3. place the folder at <DSH_HOME>/sessions/<projectKey(target)>/<id>/
 *      (refusing an id that already exists here);
 *   4. copy any other files from the package alongside the log;
 *   5. update the in-memory workspace registry so the sidebar shows it now.
 */
async function importSession(ctx, sourceDir, targetPath) {
  if (typeof sourceDir !== "string" || sourceDir.trim().length === 0) {
    throw fail("import-dir-required", "The import package path is required");
  }
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    throw fail("target-required", "A destination workspace path is required");
  }
  const src = resolve(sourceDir);
  if (!(await exists(src))) throw fail("import-dir-not-found", `The import package path does not exist: ${src}`);
  const manifestPath = join(src, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw fail("import-invalid-package", "Not a valid export package: missing or unreadable manifest.json");
  }
  const sessionId = manifest && typeof manifest.sessionId === "string" ? manifest.sessionId : undefined;
  if (!sessionId) throw fail("import-invalid-package", "The export manifest has no sessionId");

  const registry = ctx.get("workspaceRegistry");
  const persistence = ctx.get("sessionPersistence");
  if (!registry) throw fail("registry-unavailable", "Workspace registry service is unavailable");
  if (!persistence) throw fail("persistence-unavailable", "Session persistence service is unavailable");

  // Log filename: manifest.logName if present, else the first session* file in the package.
  let logName = typeof manifest.logName === "string" && manifest.logName.length > 0 ? manifest.logName : undefined;
  if (!logName) {
    const entries = await readdir(src);
    const match = entries.find((name) => /^session\.jsonl(\.zstd)?$/.test(name));
    logName = match;
  }
  if (!logName) throw fail("import-invalid-package", "The export package contains no session log");
  const sourceLog = join(src, logName);
  if (!(await exists(sourceLog))) throw fail("import-invalid-package", `The export package is missing its log: ${logName}`);

  let canonicalTarget;
  try {
    canonicalTarget = await realpath(targetPath);
  } catch {
    throw fail("target-invalid", `Cannot resolve the destination path (it may not exist): ${targetPath}`);
  }
  try {
    if (!(await stat(canonicalTarget)).isDirectory()) throw fail("target-not-dir", `The destination path is not a directory: ${canonicalTarget}`);
  } catch (error) {
    if (error && error.code === "ENOENT") throw fail("target-not-exists", `The destination path does not exist: ${canonicalTarget}`);
    throw error;
  }

  // Session root = dirname(dirname(any session dir)). Derive from the persistence root
  // if available; else from an arbitrary known path is impossible, so locate via locate().
  const probe = await findHeader(persistence, sessionId).catch(() => undefined);
  const sessionsRoot = probe !== undefined ? dirname(dirname(persistence.locate(probe).path)) : dshSessionsRoot();
  const destDir = join(sessionsRoot, projectKey(canonicalTarget), encodeSegment(sessionId));
  if (await exists(destDir)) {
    throw fail("import-session-exists", `A session with id ${sessionId} already exists on this machine: ${destDir}`);
  }
  await mkdir(dirname(destDir), { recursive: true });
  await mkdir(destDir, { recursive: true });

  const compressed = logName.endsWith(".jsonl.zstd");
  const raw = await readFile(sourceLog);
  const rewritten = rewriteLogHeader(raw, canonicalTarget, compressed);
  await writeFile(join(destDir, logName), rewritten);

  // Copy the rest of the package (any artifacts), skipping the log + manifest.
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.name === logName || entry.name === "manifest.json") continue;
    await cp(join(src, entry.name), join(destDir, entry.name), { recursive: true, force: false });
  }

  // Keep the in-memory registry consistent so the sidebar regroups now.
  const newHeader = {
    id: sessionId,
    version: manifest.version ?? 3,
    createdAt: manifest.createdAt ?? Date.now(),
    cwd: canonicalTarget,
    parentSession: manifest.parentSession,
    seedLength: manifest.seedLength,
    origin: manifest.origin,
    delegationDepth: manifest.delegationDepth ?? 0,
    agentPreset: manifest.agentPreset
  };
  registry.headers.set(sessionId, newHeader);
  registry.sessionPaths.set(sessionId, canonicalTarget);
  registry.invalidSessionPaths.delete(sessionId);
  const targetEntity = await registry.resolveByPath(canonicalTarget);
  if (targetEntity !== undefined) await targetEntity.attachSession(sessionId);

  return {
    ok: true,
    sessionId,
    importPath: destDir,
    cwd: canonicalTarget,
    workspaceId: targetEntity ? targetEntity.id : undefined,
    workspaceTitle: targetEntity ? targetEntity.title : undefined
  };
}

function dshSessionsRoot() {
  return join(dshHomeDir(), "sessions");
}

/** Remove an id from the durable archive set if present (tolerant — used by delete). */
async function pruneArchivedSet(ctx, sessionId) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry || !registry.state || typeof registry.state !== "object") return false;
  const current = registry.archivedSessionIds;
  if (!Array.isArray(current) || !current.includes(sessionId)) return false;
  const next = current.filter((id) => id !== sessionId);
  const state = Object.assign({}, registry.state, { archivedSessionIds: next });
  if (typeof registry.setState === "function") {
    await registry.setState(state);
    return true;
  }
  const domain = ctx.get("storageDomain");
  if (!domain) return false;
  const unit = domain.get("workspace");
  if (!unit || !unit.global || typeof unit.global.set !== "function") return false;
  await unit.global.set(state);
  registry.state = state;
  return true;
}

/**
 * Delete one session from disk and bookkeeping. Destructive and irreversible:
 * the caller must double-confirm. Refuses running sessions; evicts an idle
 * live session first; removes the artifact directory, then detaches the
 * session from its workspace accounting and prunes the archive set.
 */
async function deleteSession(ctx, sessionId) {
  if (sessionRunning(ctx, sessionId)) throw fail("session-running", `Session is running and cannot be deleted: ${sessionId}`);
  const { header, logPath } = await locateSession(ctx, sessionId);
  const sourceDir = dirname(logPath);
  if (!(await exists(sourceDir))) {
    // Already gone from disk: just clean bookkeeping.
    await pruneBookkeeping(ctx, sessionId);
    return { ok: true, sessionId, deleted: false, reason: "no-artifact", path: sourceDir };
  }
  // Evict an idle live session so it cannot resurface after deletion.
  if (ctx.get("sessions") && ctx.get("sessions").get(sessionId) !== undefined) {
    if (!detachLive(ctx, sessionId)) {
      throw fail("live-detach-failed", `Session is still resident in memory and cannot be evicted: ${sessionId}`);
    }
  }
  const sizeBytes = await dirSizeBytes(sourceDir, 0);
  await rm(sourceDir, { recursive: true, force: true });
  await pruneBookkeeping(ctx, sessionId);
  return { ok: true, sessionId, deleted: true, path: sourceDir, sizeBytes, cwd: header.cwd ?? null };
}

/** Detach from workspace accounting + prune the archive set (idempotent). */
async function pruneBookkeeping(ctx, sessionId) {
  const registry = ctx.get("workspaceRegistry");
  if (registry) {
    const workspace = workspaceAccountingFor(registry, sessionId);
    if (workspace !== undefined) {
      try {
        await workspace.detachSession(sessionId);
      } catch (error) {
        ctx.logger?.warn?.("dsh-session-mgr: detach after delete failed: " + String(error));
      }
    }
  }
  await pruneArchivedSet(ctx, sessionId);
}

/** Plugin body: register the /dsh-move API on the harness web server. */
export function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) {
    console.error("[dsh-session-mgr] webServer service unavailable at apply; route not registered");
    return;
  }
  const handlers = {
    list: () => buildList(ctx),
    move: async (args) => {
      const argsObj = args && typeof args === "object" ? args : {};
      const result = await moveSession(ctx, argsObj.sessionId, argsObj.targetPath);
      return { ok: true, ...result };
    },
    archive: (args) => archiveSession(ctx, sessionIdOf(args)),
    unarchive: (args) => unarchiveSession(ctx, sessionIdOf(args)),
    backup: async (args) => {
      const argsObj = args && typeof args === "object" ? args : {};
      return backupSession(ctx, sessionIdOf(args), argsObj.targetDir);
    },
    import: async (args) => {
      const argsObj = args && typeof args === "object" ? args : {};
      return importSession(ctx, argsObj.sourceDir, argsObj.targetPath);
    },
    delete: (args) => deleteSession(ctx, sessionIdOf(args))
  };

  async function handler(req, res) {
    if ((req.method || "") !== "POST") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    const pathname = (req.url || "").split("?")[0].replace(/\/+$/, "");
    let action = null;
    for (const key of Object.keys(handlers)) {
      if (pathname === "/dsh-session-mgr/" + key) {
        action = key;
        break;
      }
    }
    if (action === null) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let body = {};
    try {
      const raw = await readBody(req);
      if (raw.trim().length > 0) body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    try {
      sendJson(res, 200, await handlers[action](body));
    } catch (error) {
      const code = error && typeof error === "object" && typeof error.code === "string" ? error.code : undefined;
      const message = (error && error.message) || String(error);
      sendJson(res, 500, code !== undefined ? { error: { code, message } } : { error: message });
    }
  }

  ctx.effect(() => webServer.register({
    kind: "prefix",
    path: "/dsh-session-mgr",
    handler
  }), "dsh-session-mgr: route");
}
