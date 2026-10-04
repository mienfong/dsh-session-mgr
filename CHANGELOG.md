# Changelog / 更新日志

本文件记录 `dsh-session-mgr` 的所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

All notable changes to `dsh-session-mgr` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.7] - 2026-10-04

### 中文

#### 修复
- 升级后尚未打开过的会话不再被误判为档案遗失（备份/移动曾回 `artifact-missing`）—— 日志解析改以目录中**最新实际存在**的世代为准。感谢 [@kaschey9](https://github.com/mienfong/dsh-session-mgr/issues/4)（[#4](https://github.com/mienfong/dsh-session-mgr/issues/4)）。
- 移动后侧边栏不再掉标题 —— 移动成功后会重新绑定投影快取记录的 `cwd`。感谢 [@kaschey9](https://github.com/mienfong/dsh-session-mgr/issues/5)（[#5](https://github.com/mienfong/dsh-session-mgr/issues/5)）。
- 删除会话时会一并回收它的投影快取记录，不再累积孤儿。感谢 [@kaschey9](https://github.com/mienfong/dsh-session-mgr/issues/6)（[#6](https://github.com/mienfong/dsh-session-mgr/issues/6)）。
- 归档状态不再在「备份 → 删除 → 汇入」之后遗失。
- 备份会回报「引用但本机已不存在」的附件（`missingAttachments`），不再等到还原后第一次发送才失败。
- 取消归档改为幂等（`ok` / `changed: false`，不再回 500）。
- 读不出日志的会话不再隐形：`/list` 回报 `unreadable`，设定页可删除它。
- 并发的移动/删除竞争改为回 `artifact-missing`，不再抛原始 `ENOENT`；备份的「同名拒绝覆盖」改为原子。
- 标题查询失败不再被永久记为「没有标题」；注册表索引落后时不再误报 `artifact-missing`。
- 补齐 `err.unsafe-archive-member` 三语讯息，移除两个死键。

#### 变更
- 单笔操作不再扫描全部会话：300 个会话时 backup / move / delete 由 ~0.5 秒降到 ~5–15 毫秒。
- 会话标题按日志 revision 快取：本机 11 个真实会话的列表由 ~0.7 秒降到 ~25 毫秒。
- 不可压缩的内容不再浪费 CPU（跳过 deflate、使用原生 CRC-32）：20 MB 附件备份由 836 毫秒降到 225 毫秒。
- 可从 npm 安装：`dsh plugin --profile web add dsh-session-mgr`。
- `package.json` 的 `files` 修正（补上 `README.EN.md` 与 `CHANGELOG.md`）。
- 新增三语一致性自我检查 `scripts/test-i18n.mjs`，并扩充单元与实机测试。

### English

#### Fixes
- A session not opened since an upgrade is no longer mistaken for a missing artifact (backup/move used to answer `artifact-missing`): log resolution now takes the newest generation actually on disk. Thanks [@kaschey9](https://github.com/mienfong/dsh-session-mgr/issues/4) ([#4](https://github.com/mienfong/dsh-session-mgr/issues/4)).
- The sidebar keeps the title after a move: the projection-cache record is re-keyed to the new `cwd`. Thanks [@kaschey9](https://github.com/mienfong/dsh-session-mgr/issues/5) ([#5](https://github.com/mienfong/dsh-session-mgr/issues/5)).
- Deleting a session reclaims its projection-cache record instead of leaving an orphan. Thanks [@kaschey9](https://github.com/mienfong/dsh-session-mgr/issues/6) ([#6](https://github.com/mienfong/dsh-session-mgr/issues/6)).
- The archived state survives Backup → Delete → Import.
- Backup reports attachments that are referenced but missing here (`missingAttachments`) instead of failing on the restored session's first send.
- Unarchiving is idempotent (`ok` / `changed: false`, no more 500).
- A session whose log cannot be read is reported as `unreadable` and can be deleted from the settings page.
- A racing move/delete answers `artifact-missing` instead of a raw `ENOENT`, and the backup "refuse to overwrite" guard is atomic.
- A failed title lookup is no longer cached as "no title"; a lagging registry header no longer misreports `artifact-missing`.
- Added the missing `err.unsafe-archive-member` message and removed two dead keys.

#### Changed
- Single-session operations no longer scan every session: ~0.5 s → ~5–15 ms at 300 sessions.
- Session titles are cached by log revision: ~0.7 s → ~25 ms for this machine's 11 real sessions.
- Incompressible content no longer pays for deflate (and uses the native CRC-32): a 20 MB attachment backup drops from 836 ms to 225 ms.
- Installable from npm: `dsh plugin --profile web add dsh-session-mgr`.
- `package.json` `files` corrected (adds `README.EN.md` and `CHANGELOG.md`).
- New trilingual self-check `scripts/test-i18n.mjs`, and more unit and live tests.

## [0.6.6] - 2026-09-29

### 中文

#### 修复
- **汇入压缩档时不再可能写到解压目录之外（zip-slip / tar-slip，CWE-22）。** `extractMembersToDir()` 现在会在任何版面处理之前先校验每一个成员名称：反斜线一律视为分隔符，绝对路径、磁盘机或 UNC 前缀、`..` 片段与内嵌 NUL 全部拒绝；空片段与 `.` 片段则正规化移除（`tar czf … .` 产生的 `./<name>` 仍可正常汇入，因为 `.` 无法逃逸）。只要有一个名称不安全，**整个包会被拒绝**（错误码 `unsafe-archive-member`）并且**不写入任何文件** —— 因此既不会逃逸到解压目录之外，也不会留下半汇入的残缺档案；`resolve` + `relative` 的容纳复查保留为第二道防线。感谢 [@kaschey9](https://github.com/kaschey9) 回报（[#1](https://github.com/mienfong/dsh-session-mgr/issues/1)）。
- **深色主题下主要按钮的文字不再看不见。** `.dsm-btn-primary` 不再写死白色文字，改用主题配对的 `--dsw-alias-label-primary-foreground`（深色主题下翻转为近黑，浅色主题为白），底色与 hover 改用设计系统自己的 `--dsw-alias-button-primary-fill` / `-hover`（原本 hover 那条同样写死了 `#fff`）；disabled 状态不再用 `opacity` 把整个按钮连文字一起淡化，改为只把底色换成中性的 `--dsw-alias-bg-layer-3`、文字用 `--dsw-alias-label-tertiary`，两个主题下都保持可读。感谢 [@kaschey9](https://github.com/kaschey9) 回报（[#2](https://github.com/mienfong/dsh-session-mgr/issues/2)）。

#### 已验证
- 已对 DeepSeek Harness **0.2.0-rc.2**（会话格式版本 **4**、事件词表 59 种）完成实机验证：会话列表、移动（含「目标目录不存在时以 `target-invalid` 拒绝」）、归档/恢复、v4 会话的可携式备份、汇入、删除全部与文件所述一致。新增的 `scripts/test-session-ops-live.mjs` 会在合成的 v4 会话上跑完整轮，同时也是本插件所依赖的工作区注册表接缝的升级相容性检查。

### English

#### Fixed
- **Importing an archive can no longer write outside the extraction directory (zip-slip / tar-slip, CWE-22).** `extractMembersToDir()` now validates every member name before any layout handling: backslashes are treated as separators, and absolute names, drive or UNC prefixes, `..` segments and an embedded NUL are all refused, while empty and `.` segments are normalised away (`./<name>` members — what `tar czf … .` produces — still import, since `.` cannot escape). A single unsafe name refuses the **whole package** (error code `unsafe-archive-member`) and **writes nothing at all** — so nothing escapes the extraction directory and no half-imported file is left behind; the `resolve` + `relative` containment check remains as a second line of defence. Thanks to [@kaschey9](https://github.com/kaschey9) for the report ([#1](https://github.com/mienfong/dsh-session-mgr/issues/1)).
- **Primary button labels are no longer invisible in the dark theme.** `.dsm-btn-primary` no longer hard-codes white text: it uses the theme's paired `--dsw-alias-label-primary-foreground` (near-black in the dark theme, white in the light one), and its fill and hover now use the design system's own `--dsw-alias-button-primary-fill` / `-hover` tokens (the hover rule hard-coded `#fff` as well). Disabled no longer dims the entire button — label included — through `opacity`; it swaps the fill for the neutral `--dsw-alias-bg-layer-3` and the label for `--dsw-alias-label-tertiary`, which stays readable in both themes. Thanks to [@kaschey9](https://github.com/kaschey9) for the report ([#2](https://github.com/mienfong/dsh-session-mgr/issues/2)).

#### Verified
- Verified live against DeepSeek Harness **0.2.0-rc.2** (session format version **4**, event vocabulary of 59 types): session list, move (including a destination that does not exist being refused with `target-invalid`), archive/unarchive, portable backup of a v4 session, import, and delete all behave as documented. The new `scripts/test-session-ops-live.mjs` runs that round trip on a synthetic v4 session and doubles as the compatibility check for the workspace-registry seam this plugin drives.

## [0.6.5] - 2026-09-22

### 中文

#### 修复
- **汇入失败不再留下残缺目录。** 安装过程中任何一步失败 —— 打包的日志不是它档名承诺的容器、写入失败、或安装后校验不通过 —— 都会删除已建立的会话目录，并回报编码错误（`import-log-unreadable` / `import-log-encoding` / `import-log-generation`），而不是留下一个让 DSH 读不到会话的空目录（原始 codec 讯息会附在错误里方便诊断）。另外 `unknownEvents` 改为按 `(type, seq)` 去重：一个包通常同时带旧世代与当前世代的日志、两份都会被标记，同一个事件不再被算两次。
- **由较新版本 DSH 写出的包，汇入成功但会话打不开。** 会话日志是事件溯源的：读取时只要遇到一个「本机词表里没有、且信封上没有 `ignorable: true` 标记」的事件，后端就会**拒绝整条会话** —— 于是 `import` 回报成功，打开会话却报 `failed to observe session … unknown to this harness and not marked ignorable`。写入方在引入新事件类型时本应自己打上该标记，漏打（例如 alpha 版写出的 `workspace/changes`）就会让旧版读不了。`import` 现在会在安装时用**本机 harness 自己的事件词表**（`@deepseek-ai/dsh-session` 的 `KNOWN_SESSION_EVENT_TYPES`）逐条比对，为这类事件补上 `ignorable: true`：只重压含该事件的那一帧，header 帧与其他帧保持原字节与校验和，事件数量、顺序与序号一律不变。被跳过的事件以 `unknownEvents` 回报（`{ type, count }`），界面同时提示「该包由更新版本的 DSH 写出：N 个本机不认识的事件（类型…）已标记为可跳过」。词表无法解析时行为与之前完全一致，不改动日志。

### English

#### Fixed
- **A failed import no longer strands a partial directory.** Any failure while installing — a packaged log that is not the container its name promises, a write error, or a failed post-install check — now removes the session directory it had created and answers with a coded error (`import-log-unreadable` / `import-log-encoding` / `import-log-generation`) instead of leaving an empty directory that makes DSH unable to read the session; the original codec message is kept inside the error for diagnosis. `unknownEvents` is now de-duplicated by `(type, seq)`: a package normally carries both the legacy and the current generation log, both are marked, and one event is no longer counted twice.
- **A package written by a newer DSH imported into a session that would not open.** Session logs are event-sourced: a single event whose type is absent from this build's vocabulary *and* whose envelope lacks the `ignorable: true` marker makes the backend refuse the **whole session** — the import reported success, then opening the conversation failed with `failed to observe session … unknown to this harness and not marked ignorable`. Writers of a new event type are expected to set that marker themselves; when they forget (an alpha build's `workspace/changes`, for instance) older builds cannot read the log. `import` now compares every event against **the local harness' own vocabulary** (`KNOWN_SESSION_EVENT_TYPES` from `@deepseek-ai/dsh-session`) and adds the missing marker: only the frames containing such an event are re-compressed, the header frame and every other frame keep their original bytes and checksum, and the event count, order and sequence numbering never change. What was skipped is reported as `unknownEvents` (`{ type, count }`) and surfaced in the UI ("this package came from a newer DSH: N event(s) … were marked skippable"). When the vocabulary cannot be resolved the import behaves exactly as before and leaves the log untouched.

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
