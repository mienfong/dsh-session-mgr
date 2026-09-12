# Changelog / 更新日志

本文件记录 `dsh-session-mgr` 的所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

All notable changes to `dsh-session-mgr` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.4] - 2026-09-13

### 中文

#### 修复
- **导入的会话可能让整台机器的会话列表失效。** JSONL 后端只接受一种日志容器（`zstd`，或 `none`），而且读取时会检查**整个 sessions root**：只要有一个会话目录的 generation log 用了另一种容器，所有会话读取都会失败（设定页与侧边栏的会话列表一片空白/报错）。`import` 以前把来源机器的日志容器原样照搬，因此在容器设定不同的机器之间传输备份（或导入以纯文本日志打包的包）就会触发。现在 `import` 会把日志重新编码成本机容器，连同同目录的其他 generation log 一并处理。
- **日志文件名与 header 版本必须一致。** 后端会比对该会话的世代编号与 header 里的 `version`（例如「档名代表 v0，但 header 代表 v3」）。手工打包或较旧版本产出的包如今会在导入时自动改名为 header 宣告的世代（如 `session.jsonl` → `session.v3.jsonl.zstd`）。
- **导入后校验并回滚。** 安装完成后会重新读取每一个日志，确认「容器 = 本机编码」且「档名世代 = header 版本」；不符就删除刚安装的整个目录并回报错误（`import-log-unreadable` / `import-log-encoding` / `import-log-generation`，已提供中英三语讯息），因此不会再留下会让整台机器读不到会话的残缺产物。

### English

#### Fixed
- **An imported session could break the session list of the whole machine.** The JSONL backend accepts exactly one log container (`zstd`, or `none`) and validates the **entire sessions root** on read: a single session directory whose generation log uses the other container makes every session read fail (the Settings page and sidebar lists go blank / error). `import` used to copy the source machine's container verbatim, so transferring a backup between machines with different container settings (or importing a package built from plaintext logs) triggered it. `import` now re-encodes the log into this machine's container, including any sibling generation logs.
- **A log's filename must agree with its header version.** The backend cross-checks the generation it reads from the filename against the header's `version` (e.g. "filename identifies v0, but its header identifies v3"). Hand-built packages, or ones produced by older harness versions, are now renamed on import to the generation their header declares (`session.jsonl` → `session.v3.jsonl.zstd`).
- **Post-install verification with rollback.** After installing, every log is read back and checked for "container = local encoding" and "filename generation = header version"; a mismatch deletes the freshly installed directory and reports an error (`import-log-unreadable` / `import-log-encoding` / `import-log-generation`, with trilingual messages), so an import can no longer strand an artifact that makes the machine's sessions unreadable.

## [0.6.3] - 2026-09-13

### 中文

#### 新增
- **附件随备份一起打包。** `backup` 现在会扫描会话日志中引用的每一个 `attachmentId`（图片与文件），把对应的二进制内容打包进压缩档的 `attachments/v1/objects/<xx>/<sha256>`（文件附件另含 `file-objects/…`），并记录在 `manifest.json` 的 `attachments` 字段中；`import` 会把它们还原到本机的附件库。
- 附件内容按内容寻址（content-addressed）：本机已存在的文件会被跳过，因此重复导入同一个包时每个附件只会复制一次。

#### 修复
- **还原后的会话不再卡在第一张图片上。** 本版本之前的备份只包含会话目录，在另一台机器还原后 `prepareRequestImages` 会抛出 `ATTACHMENT_NOT_FOUND`，而该错误被 LLM 传输层报成误导性的 `DeepSeek API stream … failed`。旧包仍可导入（当 `manifest.json` 没有 `attachments` 时改由日志头推导）。
- 已针对 DeepSeek Harness **0.1.5-rc.2** 验证：会话格式版本仍为 `3`、header 结构未变，因此适配层无需改动。

### English

#### Added
- **Attachments travel with the backup.** `backup` now scans the session log for every referenced `attachmentId` (images *and* files), packs the matching blobs into the archive under `attachments/v1/objects/<xx>/<sha256>` (plus `file-objects/…` for file attachments), and lists them in `manifest.json` as `attachments`. `import` restores them into this machine's attachment store.
- Attachment payloads are content-addressed: a blob already present locally is skipped, so importing the same package twice copies each file once.

#### Fixed
- **Restored conversations no longer fail on their first image.** A backup taken before this release carried only the session folder, so after restoring it on another machine `prepareRequestImages` raised `ATTACHMENT_NOT_FOUND` — which the LLM transport reported as a misleading `DeepSeek API stream … failed`. Old packages still import (the log header is used when `manifest.json` has no `attachments`).
- Verified against DeepSeek Harness **0.1.5-rc.2**: session format version is still `3` and the header shape is unchanged, so no adapter changes were needed.

## [0.6.2] - 2026-08-28

### 中文

#### 修复
- **导入同时接受两种压缩包结构。** 无论包内文件位于压缩档根目录（`dsh-session-mgr` 的标准备份），还是被包在一层顶层文件夹里（例如 Windows「压缩文件夹」），现在都能正确解包：目录条目会被跳过，共同的最外层前缀会被剥离。这修复了导入文件夹包裹型 zip 时的 `EEXIST` 错误。
- **导入容忍缺失的 `manifest.json`。** 若包内只有会话日志，`import` 会从日志头推导清单（sessionId / cwd / createdAt 等），因此手工压缩的会话文件夹也能导入。

### English

#### Fixed
- **Import accepts both archive layouts.** A ZIP/tar.gz package is now unpacked whether its files sit at the archive root (a `dsh-session-mgr` backup) *or* wrapped in a top-level folder (e.g. a Windows "Compressed Folder"): directory entries are skipped and a common top-level prefix is stripped. This fixes the `EEXIST` error when importing a folder-wrapped zip.
- **Import tolerates a missing `manifest.json`.** If only the session log is present, `import` derives the manifest from the log header (sessionId / cwd / createdAt / …), so manually-zipped session folders import too.

## [0.6.1] - 2026-08-28

### 中文

#### 修复
- **兼容 DeepSeek Harness 0.1.2-rc.1**：`persistence.list()` 由裸 header 数组改为返回 `[{ header, revision, sizeBytes }]` 快照。新增 `headerOf()` 同时归一化旧的裸 header 形状（DSH ≤ 0.1.0-rc.7）与新的快照形状（DSH ≥ 0.1.2），并让 `findHeader` 与会话列表都经由它读取。会话列表不再渲染空行；`backup` / `import` / `move` / `delete` 在两个版本上都正常工作。

### English

#### Fixed
- **Compatibility with DeepSeek Harness 0.1.2-rc.1**: `persistence.list()` now returns `[{ header, revision, sizeBytes }]` snapshots instead of bare headers. Added `headerOf()` to normalise both the old bare-header shape (DSH ≤ 0.1.0-rc.7) and the new snapshot shape (DSH ≥ 0.1.2), and updated `findHeader` / session listing to read through it. The session list no longer renders empty rows; `backup`/`import`/`move`/`delete` keep working on both versions.

## [0.6.0] - 2026-08-28

### 中文

#### 新增
- **可携式压缩档备份**：`backup` 不再产出文件夹，改为产出一个压缩**档案**。格式由用户选择：`.zip`（适合 Windows）或 `.tar.gz`（适合 Linux），便于传到另一台机器后重新导入。
- **从压缩档导入**：`import` 可读取 `.zip` / `.tar.gz` 备份档（旧的文件夹包仍可导入），解压后把会话 header 的 `cwd` 重映射到目标位置并安装到本机。
- `lib/host.js` 内自带零依赖的 ZIP（DEFLATE）与 tar.gz（ustar）读写实现（纯函数，含单元测试）。

#### 变更
- `backup` 产出 `<sessionId>.zip` / `<sessionId>.tar.gz`；备份对话框新增格式选择；导入对话框改为选择压缩档文件。

### English

#### Added
- **Portable archive backup**: `backup` now produces a compressed **archive file** instead of a folder. The user picks the format: `.zip` (Windows-friendly) or `.tar.gz` (Linux-friendly), so a backup can be transferred and re-imported on another machine.
- **Import from archive**: `import` reads a `.zip` / `.tar.gz` backup archive (a legacy folder package still works), extracts it, remaps the session header `cwd` to the destination, and installs it here.
- Dependency-free ZIP (DEFLATE) and tar.gz (ustar) writers/readers in `lib/host.js` (pure, unit-tested).

#### Changed
- `backup` produces `<sessionId>.zip` / `<sessionId>.tar.gz`; the Backup dialog now has a format selector; the Import dialog asks for the archive file.

## [0.5.0] - 2026-08-24

### 中文

#### 新增
- **可携式备份 / 导出**：`backup` 产出一个可携式包——一个 `<sessionId>` 文件夹，内含 `manifest.json` 与完整会话日志（含所有产物）。可传到另一台机器。
- **导入**：在本机安装可携式包，并把会话 header 的 `cwd` 重写为本机存在的工作区/文件夹，让另一台机器上备份的会话无缝继续。
- 三语界面（English / 简体中文 / 繁體中文），跟随 harness 的语言设置；当 harness 语言为中文时，插件内提供简体/繁体切换。
- 主机端错误码（`fail(code, msg)`），让客户端能按语言本地化服务端消息。

#### 变更
- `backup` 语义变更：从「同机器文件夹复制」改为「跨机器可携式导出」。

### English

#### Added
- **Portable Backup / Export**: `backup` now produces a portable package — a `<sessionId>` folder with a `manifest.json` and the full session log (including any artifacts). Transferable to another machine.
- **Import**: install a portable package on this machine, rewriting the session header `cwd` to a workspace/folder that exists here, so a conversation backed up on another machine resumes seamlessly.
- Trilingual UI (English / 简体中文 / 繁體中文) that follows the harness language setting, with an in-plugin 简体/繁體 switch when the harness language is Chinese.
- Host error codes (`fail(code, msg)`) so the client can localize server messages per language.

#### Changed
- `backup` semantics: from a same-machine folder copy to a cross-machine portable export.

## [0.4.0] - 2026-08-24

### 中文

#### 新增
- **备份**（把会话文件夹复制到指定目录）。

### English

#### Added
- **Backup** (copy session folder to a chosen directory).

## [0.3.0] - 2026-08-24

### 中文

#### 新增
- **删除**（红色二次确认）与**恢复**（取消归档）；插件页面改名为「会话管理 / Session Manager」。

### English

#### Added
- **Delete** (red double-confirm) and **Restore** (un-archive); renamed the plugin page to "Session Manager / 会话管理".

## [0.2.0] - 2026-08-24

### 中文

#### 新增
- 通过工作区注册表的归档集合对会话进行**归档 / 恢复**。

### English

#### Added
- **Archive / Restore** of conversations via the workspace registry's archive set.

## [0.1.0] - 2026-08-24

### 中文

#### 新增
- 在设置页把会话（含已归档会话）移动到不同工作区，并提供「移动到工作区」的会话头部操作。

### English

#### Added
- Move conversations (including archived ones) between workspaces from the Settings page, plus a "Move to Workspace" header action.
