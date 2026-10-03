# Changelog / 更新日志

本文件记录 `dsh-session-mgr` 的所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

All notable changes to `dsh-session-mgr` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.7] - 2026-10-04

### 中文

#### 修复
- **升级后「还没打开过」的会话，不再被误判为档案遗失。** `persistence.locate()` 只计算**当前**格式世代（例如 `session.v4.jsonl.zstd`）的路径、**不查硬盘**，而世代迁移是**惰性**的 —— 那个文件要等到会话下次被打开才产生。于是在旧版 harness 写过、升级后尚未打开过的会话，做**备份**或**移动**都会失败（`backup-verify-failed` / `artifact-missing`），尽管会话本身完全健康（回报者的机器上 31 个会话里有 20 个是这种状态）。现在 `locate` 的结果会回到硬盘复查：不存在就回退到目录中**最新实际存在的**世代（优先同一种容器），只有整个目录都没有正规日志时才报 `artifact-missing`。感谢 [@kaschey9](https://github.com/kaschey9) 回报（[#4](https://github.com/mienfong/dsh-session-mgr/issues/4)）。
- **移动之后，侧边栏不再丢掉会话标题。** projection-cache 的每条记录都绑定一个**包含 `cwd`** 的生命周期身份，而移动只改写了日志 header 的 `cwd`，记录随即不再匹配，列表会退化成「Untitled」直到会话被重新打开。现在移动成功后会重新绑定该记录的 `cwd`（仅 unseeded 会话；seeded fork 的继承切点不在 header 里，按设计跳过），失败或记录不存在只是下次打开时多回放一段，不会出现错误值。感谢 [@kaschey9](https://github.com/kaschey9) 回报（[#5](https://github.com/mienfong/dsh-session-mgr/issues/5)）。
- **删除会话时，一并回收它的 projection-cache 记录。** 快取服务刻意不提供驱逐 API，而 harness 自己从不删除会话目录，所以插件的删除是唯一能回收孤儿记录的地方 —— 否则每轮「备份 → 删除 → 汇入」都会永久留下一个（本机 11 个活会话曾累积 13 个孤儿记录）。现在 `pruneBookkeeping()` 会在两条删除路径上都 best-effort 移除该会话的 per-record 文件（`<DSH_HOME>/storages/session_projcache/sessions/<id>.json`），legacy 单文件布局不动。感谢 [@kaschey9](https://github.com/kaschey9) 回报（[#6](https://github.com/mienfong/dsh-session-mgr/issues/6)）。
- **（自我检查发现）归档状态不再在「备份 → 删除 → 汇入」之后遗失。** `manifest.json` 现在记录 `archived`，汇入时若为真就把会话重新加入归档集合，回应也多一个 `archived` 字段（界面提示「已一并还原为归档状态」）。此前一个已归档的会话在还原后会静默变回活跃列表。
- **（自我检查发现）备份会回报「引用但本机已不存在」的附件。** 这类附件无法打包，而还原后的会话在第一次发送时会以 `ATTACHMENT_NOT_FOUND` 失败 —— 现在 `backup` 会以 `missingAttachments`（回应与 `manifest.json`）列出它们，界面上也出现警告，让使用者在迁移前就知道，而不是到另一台机器才发现。这个缺口原先会在 `DSH_HOME` 搬迁漏掉 `attachments/`（见 0.6.3）之后被静默放大。
- **（自我检查发现）取消归档改为幂等。** 对一个「不在归档集合」的会话取消归档，以前回 500（`not-archived`），连点两次就会在一次成功的还原之后弹出错误；现在回 `ok`、`changed: false`。
- **（自我检查发现）补齐与清理三语字串。** 新增 `err.unsafe-archive-member`（0.6.6 的安全拒绝原先会显示英文原文）；移除两个已无用的键（`err.not-archived`、`err.import-archive-unsupported`）。三语表现在 129 个键完全对齐。
- **（自我检查发现）并发的移动/删除竞争不再回原始 `ENOENT`。** 两个并发操作抢同一个会话时，落败的一方以前会把文件系统的 `ENOENT` 直接抛给使用者；现在改为 `artifact-missing`（已翻译，且说明档案在操作途中消失）。结局本身一直是一致的 —— 会话只会落在一处。
- **（自我检查发现）备份的「同名拒绝覆盖」改为原子。** 改用 `wx` 旗标写入：两个并发备份不会再双双通过存在性检查而互相覆盖（串行情况本来就正确，拒绝时回 `backup-collision`）。
- **（自我检查发现，优化引入）标题快照查询失败的会话，不再被永久当成「没有标题」。** 上一版把任何非 fulfilled 的结果（包括暂时性的读取失败）都写进 revision 快取，于是那个会话的标题会一直空白，直到日志下次变动为止。现在只快取真正 fulfilled 的结果：「这个日志没有标题事件」仍是有效答案并被快取，而失败会在下次列表时重试。
- **（自我检查发现，优化引入）注册表 header 落后时，不再把健康的会话误报为 `artifact-missing`。** 单笔操作改为先查注册表在内存里的 header 索引（这是上一版的优化），但若另一个 DSH 实例在外部搬动过会话，索引里的 `cwd` 就会落后 —— 明明磁盘上存在却解析不到，`/move` 回 500 `artifact-missing`（已实机重现）。现在解析出的路径不存在时，会重读一次权威 header（`cwd` 确实不同才重试），`move` 也改走同一条解析路径。
- **（自我检查发现）读不出日志的会话不再隐形，也能删除了。** 若一个会话的日志被截断或损坏，它的 header 就读不出来，于是它不在 `persistence.list()` 里 —— 以前它不出现在任何列表，`backup` / `delete` 又都回 `session-not-found`，使用者只能自己进文件系统删资料夹。现在 `/list` 会额外回报 `unreadable`（读不出 header 的会话目录，含 id 与路径），设定页新增「N 个无法读取的会话文件夹」区块（附说明与红色删除，沿用二次确认）；`delete` 在找不到 header 时会回退到磁盘上按 id 找到的目录（回应带 `reason: "unreadable-header"`）。

#### 变更
- `package.json` 的 `files` 修正：移除已不存在的 `README.zh-CN.md`，补上 `README.EN.md` 与 `CHANGELOG.md`（此前从 npm/git 安装的副本里没有 changelog）。
- 新增单元测试 `scripts/test-session-ops.mjs` 与三语自我检查 `scripts/test-i18n.mjs`；`scripts/test-session-ops-live.mjs` 增加「旧世代会话」「cache 回收」「归档往返」「缺附件回报」「unarchive 幂等」等情境；README 说明实机测试可把其他位址当第一个参数传入（桌面版 App 的端口不同）。
- **（自我检查发现）`/list` 会缓存每个 cwd 的正规化结果。** 未分组的会话常共享同一个 cwd（例如工作区资料夹已被删除、或一批一起搬移的会话），以前每笔各做一次 `realpath`，现在每个 cwd 只解析一次。实测量级：本机 11 个会话约 0.7 秒、311 个约 3.4 秒（≈10ms/会话），主要成本来自 harness 自己的会话扫描。
- **（优化）单一会话的操作不再扫描全部会话。** `findHeader()` 以前一律呼叫 `persistence.list()`（把机器上每个会话的 header 都读一遍）—— 实测 300 个会话时，单笔 backup / move / delete 各要 ~0.5 秒，而 11 个会话时只要 ~10–30 毫秒。现在会先查工作区注册表已经在内存里的 header 索引（设定页本身读的就是它）；只有注册表不认识这个 id 时才回退到全量扫描，并在扫描成功后**回填索引**，让启动后才出现的目录（外部工具建立、还原的备份）只需付一次扫描成本。实测：真实会话（注册表认得）在 311 个会话下 backup 从 ~0.5 秒降到 **4–15 毫秒**。
- **（优化）会话标题按 revision 快取。** `/list` 里最贵的一段是每个会话一次标题快照查询（实测 ≈10ms/会话，而 `persistence.list()` 本身只有 ≈1.8ms/会话）。标题只会在会话内容变动时改变，而快照带有由 stat 推导的 `revision`，所以现在只重新查询**真正变动**的会话；新增的会话会被查询、删除的会被淘汰。设定页每次操作后都会重新载入，这个快取在日常使用里最有感。
- **（优化）ZIP 校验和改用原生 CRC-32。** Node ≥22.2 提供 zlib.crc32，输出与我们的查表实作完全相同但快约 9 倍（20MB：~6ms vs ~57ms）；旧版 Node 仍走原本的回退实作（以命名空间汇入判断，不会因为缺少具名导出而载入失败）。搭配上面两项，20MB 随机内容的打包从 ~568ms 降到约 **23ms**。
- **（优化）不会压缩的内容不再浪费 CPU 做 deflate。** ZIP 写入器本来就会在「deflate 没变小」时改用 store，但**仍然先付出 deflate 的 CPU**（实测不可压缩内容约 25ms/MB，任何压缩等级都一样）。现在分两层判断：先看是否已知已压缩（副档名或 **magic bytes** —— 附件是内容寻址、没有副档名，只能靠字节判断），没有特征的内容再**抽样**（先 deflate 前 64KB，无明显缩减就直接 store）。实测 5MB zstd 日志 + 1MB PNG 打包从 ~130–250ms 降到 **17ms**；20MB 随机内容的附件从 ~568ms 降到 **70ms**；可压缩内容完全不受影响（280KB 文字仍压到 1KB，99.5% 缩减），压缩档也不会变大，往返逐位元组相同。
- **（优化/加固）日志一律取「最新实际存在」的世代。** `resolveExistingLogPath()` 不再「只要 locate 的路径存在就用它」，而是挑目录里版本号最高的正規日志（同版本时优先 locate 的容器）。这样即使注册表 header 在惰性迁移后落后（指向仍然存在的旧世代），也不会把旧世代当成主要日志 —— 否则汇入时改写的是旧世代，而 harness 读的是新世代，`cwd` 就会对不上。

### English

#### Fixed
- **A session that has not been opened since an upgrade is no longer mistaken for a missing artifact.** `persistence.locate()` only computes the path of the **current** format generation (e.g. `session.v4.jsonl.zstd`) and never touches the disk, while generation migration is **lazy** — that file appears when the session is next opened. So any session last written by an older harness failed **backup** and **move** (`backup-verify-failed` / `artifact-missing`) while being perfectly healthy (20 of 31 sessions on the reporter's machine were in that state). The located path is now checked against the disk and falls back to the **newest canonical generation actually present** (preferring the same container); `artifact-missing` is kept for a directory with no canonical log at all. Thanks to [@kaschey9](https://github.com/kaschey9) for the report ([#4](https://github.com/mienfong/dsh-session-mgr/issues/4)).
- **The sidebar no longer loses the session title after a move.** Every projection-cache record is bound to a lifecycle identity that **includes `cwd`**, and a move rewrites only the log header, so the stored record stops matching and the row degrades to "Untitled" until the session is reopened. A successful move now re-keys the record's `cwd` (unseeded sessions only — a seeded fork's inherited cut is not part of a stored header, so it is skipped by design); a missing or refused record only costs a longer tail replay on the next open, never a wrong value. Thanks to [@kaschey9](https://github.com/kaschey9) for the report ([#5](https://github.com/mienfong/dsh-session-mgr/issues/5)).
- **Deleting a session also reclaims its projection-cache record.** The cache service deliberately exposes no eviction API and the harness itself never deletes a session directory, so the plugin's delete is the only place an orphaned record can be reclaimed — without it every Backup → Delete → Import cycle stranded one permanently (this machine had 13 orphans for 11 living sessions). `pruneBookkeeping()` now removes the session's per-record document (`<DSH_HOME>/storages/session_projcache/sessions/<id>.json`) on both delete paths, best effort; the legacy single-document layout is left alone. Thanks to [@kaschey9](https://github.com/kaschey9) for the report ([#6](https://github.com/mienfong/dsh-session-mgr/issues/6)).
- **(found by self-audit) The archived state survives Backup → Delete → Import.** `manifest.json` now records `archived`, an import re-adds the session to the archive set when it was, and the response carries an `archived` field (the UI says "restored into the archive"). Previously an archived conversation silently reappeared in the active list after a restore.
- **(found by self-audit) Backup reports attachments that are referenced but no longer exist here.** Such a blob cannot be packaged, and the restored session would fail with `ATTACHMENT_NOT_FOUND` on its first send — `backup` now lists them in `missingAttachments` (response and `manifest.json`) and the UI warns, so the user learns about it before migrating instead of on the other machine. The gap had been silently widened by the `DSH_HOME` move that dropped `attachments/` (see 0.6.3).
- **(found by self-audit) Unarchiving is idempotent.** Restoring a session that is not in the archive set used to answer 500 (`not-archived`), so a double click produced an error after a successful restore; it now answers `ok` with `changed: false`.
- **(found by self-audit) Trilingual strings completed and pruned.** Added `err.unsafe-archive-member` (the 0.6.6 security refusal previously surfaced as raw English) and removed two dead keys (`err.not-archived`, `err.import-archive-unsupported`). All three tables now hold the same 129 keys.
- **(found by self-audit, introduced by an optimization) A session whose title lookup failed is no longer remembered as having no title.** The previous revision cache stored every non-fulfilled result — including a transient read failure — so that session's title stayed blank until its log next changed. Only fulfilled observations are cached now: "this log carries no title event" is a real answer worth caching, while a failure is retried on the next listing.
- **(found by self-audit, introduced by an optimization) A lagging registry header no longer reports a healthy session as `artifact-missing`.** Single-session operations consult the registry's in-memory header index first (the previous optimization), but when another DSH instance moved a session outside this process that index's `cwd` is stale: the log resolves to a directory that no longer exists and `/move` answered 500 `artifact-missing` for a session that is right there on disk (reproduced live). Resolution now re-reads the authoritative header once when the resolved path is missing (retrying only when its `cwd` actually differs), and `move` goes through that same path.
- **(found by self-audit) A session whose log cannot be read is no longer invisible — and can be deleted.** A truncated or corrupt log means no readable header, so the session is absent from `persistence.list()`: it appeared in no listing while `backup` and `delete` both answered `session-not-found`, leaving manual folder removal as the only option. `/list` now also reports `unreadable` (session directories with no readable header, with their id and path), the settings page shows an "N unreadable session folder(s)" group with the explanation and a red delete (same double confirmation), and `delete` falls back to the directory found by id on disk (the response carries `reason: "unreadable-header"`).

#### Changed
- `package.json` `files` corrected: the removed `README.zh-CN.md` is gone and `README.EN.md` / `CHANGELOG.md` are shipped (an npm/git install previously carried no changelog).
- New unit tests `scripts/test-session-ops.mjs` and the trilingual self-check `scripts/test-i18n.mjs`; `scripts/test-session-ops-live.mjs` gained a legacy-generation session, cache reclamation, the archived round trip, the missing-attachment report and the unarchive idempotence check; the READMEs note that the live tests take a different harness URL as their first argument (the desktop app serves on another port).
- **(found by self-audit) `/list` caches the canonical resolution of each cwd.** Ungrouped sessions often share one cwd (a deleted workspace, a batch moved together) and each used to cost its own `realpath`; now each cwd is resolved once. Measured scale: ~0.7 s for 11 sessions and ~3.4 s for 311 on this machine (~10 ms per session), dominated by the harness' own session scan.
- **(optimization) A single-session operation no longer scans every session.** `findHeader()` used to call `persistence.list()` unconditionally — reading the header of every session on the machine — which measured ~0.5 s per backup/move/delete at 300 sessions versus ~10–30 ms at 11. It now consults the header index the workspace registry already holds in memory (the same one the settings page reads), falls back to the full scan only for an id the registry does not know, and **warms the index** after a successful scan so a directory that appeared after startup (an external tool, a restored backup) costs one scan rather than one per operation. Measured: a real session (known to the registry) drops from ~0.5 s to **4–15 ms** at 311 sessions.
- **(optimization) Session titles are cached by revision.** The expensive part of `/list` is one title-snapshot lookup per session (measured ~10 ms per session, against ~1.8 ms per session for `persistence.list()` itself). A title only changes when the session does, and the snapshot carries a stat-derived `revision`, so only the sessions that actually moved are queried again; new sessions are queried and deleted ones are pruned. The settings page reloads after every operation, so this cache is what makes daily use feel fast.
- **(optimization) ZIP checksums use the native CRC-32.** Node >= 22.2 ships `zlib.crc32`, which produces exactly the same value as our table loop but runs ~9x faster (20 MB: ~6 ms against ~57 ms); older runtimes keep the fallback (resolved through a namespace import, so a missing named export cannot break loading). Together with the two entries above, packaging 20 MB of random content went from ~568 ms to about **23 ms**.
- **(optimization) Content that cannot be compressed no longer pays for deflate.** The ZIP writer already fell back to `store` when deflate failed to shrink a member, but it still paid deflate's CPU first (measured ~25 ms per MB of incompressible data, at every level). It now decides in two steps: known-compressed content (by extension or by **magic bytes** — attachment blobs are content-addressed and carry no extension) is stored outright, and anything unremarkable is **sampled** (deflate the first 64 KB; no meaningful shrink means store). A 5 MB zstd log plus a 1 MB PNG measured **17 ms** instead of ~130–250 ms, a 20 MB random attachment dropped from ~568 ms to **70 ms**, compressible content is untouched (280 KB of text still shrinks to 1 KB, 99.5%), the archive never grows, and every round trip stays byte-exact.
- **(optimization / hardening) Log resolution always takes the newest generation that exists.** `resolveExistingLogPath()` no longer accepts the located path merely because it exists: it picks the highest canonical generation in the directory (the located container breaking a version tie). A registry header that lags a lazy migration — pointing at a legacy generation that is still present — therefore cannot make an import rewrite only the old log while the harness reads the new one, which would leave `cwd` wrong.

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
