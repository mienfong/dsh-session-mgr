# Changelog

All notable changes to `dsh-session-mgr` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.3] - 2026-09-13

### Added
- **Attachments travel with the backup.** `backup` now scans the session log for every referenced `attachmentId` (images *and* files), packs the matching blobs into the archive under `attachments/v1/objects/<xx>/<sha256>` (plus `file-objects/…` for file attachments), and lists them in `manifest.json` as `attachments`. `import` restores them into this machine's attachment store.
- Attachment payloads are content-addressed: a blob already present locally is skipped, so importing the same package twice copies each file once.

### Fixed
- **Restored conversations no longer fail on their first image.** A backup taken before this release carried only the session folder, so after restoring it on another machine `prepareRequestImages` raised `ATTACHMENT_NOT_FOUND` — which the LLM transport reported as a misleading `DeepSeek API stream … failed`. Old packages still import (the log header is used when `manifest.json` has no `attachments`).
- Verified against DeepSeek Harness **0.1.5-rc.2**: session format version is still `3` and the header shape is unchanged, so no adapter changes were needed.

## [0.6.2] - 2026-08-28

### Fixed
- **Import accepts both archive layouts.** A ZIP/tar.gz package is now unpacked whether its files sit at the archive root (a `dsh-session-mgr` backup) *or* wrapped in a top-level folder (e.g. a Windows "Compressed Folder"): directory entries are skipped and a common top-level prefix is stripped. This fixes the `EEXIST` error when importing a folder-wrapped zip.
- **Import tolerates a missing `manifest.json`.** If only the session log is present, `import` derives the manifest from the log header (sessionId / cwd / createdAt / …), so manually-zipped session folders import too.

## [0.6.1] - 2026-08-28

### Fixed
- **Compatibility with DeepSeek Harness 0.1.2-rc.1**: `persistence.list()` now returns `[{ header, revision, sizeBytes }]` snapshots instead of bare headers. Added `headerOf()` to normalise both the old bare-header shape (DSH ≤ 0.1.0-rc.7) and the new snapshot shape (DSH ≥ 0.1.2), and updated `findHeader` / session listing to read through it. The session list no longer renders empty rows; `backup`/`import`/`move`/`delete` keep working on both versions.

## [0.6.0] - 2026-08-28

### Added
- **Portable archive backup**: `backup` now produces a compressed **archive file** instead of a folder. The user picks the format: `.zip` (Windows-friendly) or `.tar.gz` (Linux-friendly), so a backup can be transferred and re-imported on another machine.
- **Import from archive**: `import` reads a `.zip` / `.tar.gz` backup archive (a legacy folder package still works), extracts it, remaps the session header `cwd` to the destination, and installs it here.
- Dependency-free ZIP (DEFLATE) and tar.gz (ustar) writers/readers in `lib/host.js` (pure, unit-tested).

### Changed
- `backup` produces `<sessionId>.zip` / `<sessionId>.tar.gz`; the Backup dialog now has a format selector; the Import dialog asks for the archive file.

## [0.5.0] - 2026-08-24

### Added
- **Portable Backup / Export**: `backup` now produces a portable package — a `<sessionId>` folder with a `manifest.json` and the full session log (including any artifacts). Transferable to another machine.
- **Import**: install a portable package on this machine, rewriting the session header `cwd` to a workspace/folder that exists here, so a conversation backed up on another machine resumes seamlessly.
- Trilingual UI (English / 简体中文 / 繁體中文) that follows the harness language setting, with an in-plugin 简体/繁體 switch when the harness language is Chinese.
- Host error codes (`fail(code, msg)`) so the client can localize server messages per language.

### Changed
- `backup` semantics: from a same-machine folder copy to a cross-machine portable export.

## [0.4.0] - 2026-08-24

### Added
- **Backup** (copy session folder to a chosen directory).

## [0.3.0] - 2026-08-24

### Added
- **Delete** (red double-confirm) and **Restore** (un-archive); renamed the plugin page to "Session Manager / 会话管理".

## [0.2.0] - 2026-08-24

### Added
- **Archive / Restore** of conversations via the workspace registry's archive set.

## [0.1.0] - 2026-08-24

### Added
- Move conversations (including archived ones) between workspaces from the Settings page, plus a "Move to Workspace" header action.
