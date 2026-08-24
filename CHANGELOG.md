# Changelog

All notable changes to `dsh-session-mgr` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
