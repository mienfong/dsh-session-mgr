# awesome-dsh-plugin Submission · 投稿资料

This folder documents the submission of **dsh-session-mgr** to
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin),
following its [`contributing.md`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md).

## Entry · 条目（建议添加到 `data/plugins/`）

Create **one file**: `data/plugins/mienfong__dsh-session-mgr.yml`

```yaml
url: https://github.com/mienfong/dsh-session-mgr
name: mienfong/dsh-session-mgr
category: session
description:
  en: 'Move, archive, restore, backup/export and import sessions across workspaces in the DeepSeek Harness web UI.'
  zh: '在 DeepSeek Harness 网页界面中跨工作区移动、归档、恢复、备份/导出与导入会话。'
```

- `description.en` is required; `zh` is provided.
- Both descriptions are quoted (contain no `: ` colon-space anyway) and are accurate to the code.
- **Category `session`** matches what the plugin does — it manages sessions (move / archive / restore / backup-export / import / delete).

> 说明：只加这一个文件；`data/plugins/mienfong__dsh-session-mgr.yml`。README 由脚本生成，勿手改。

## Requirements self-check · 要求自检

| Requirement · 要求 | Status · 状态 |
|---|---|
| `package.json` declares `dsh.bundle` manifest | ✅ `"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web" } }` |
| `cordis.patch.yml` at repo root | ✅ |
| Real working code (host `lib/host.js` + browser `lib/client.js`) | ✅ |
| `dsh-plugin` topic on the repo | ✅ (added via `gh repo edit`) |
| Official `@deepseek-ai/*` as **peers**, not deps | ✅ (only `peerDependencies`: react / react-dom / @deepseek-ai/cordis) |
| **Repo ≥ 1 day old** | ❌ created 2026-08-24 — wait until it is 1 day old |
| **≥ 10 commits** | ⚠️ currently **8** — see the commits below |
| At most 3 entries per PR | ✅ (a single entry) |

### Closing the gaps · 补齐缺口

1. **≥ 10 commits** — add at least two more real commits. `CONTRIBUTING.md` and `CHANGELOG.md` in this repo already do that; add any docs improvements you like, then push.
2. **Repo age ≥ 1 day** — nothing to do but wait. The CI check is automatic and filters only freshly-minted repos; a resubmission the next day is fine.

## Screenshots · 截图（可选）

The plugin already ships 5 screenshots in `docs/screenshots/`. To surface them in the storefront, add an entry to `data/screenshots.json` keyed by the repo URL:

```jsonc
{
  "https://github.com/mienfong/dsh-session-mgr": [
    "https://raw.githubusercontent.com/mienfong/dsh-session-mgr/main/docs/screenshots/session-manager.png",
    "https://raw.githubusercontent.com/mienfong/dsh-session-mgr/main/docs/screenshots/move-dialog.png",
    "https://raw.githubusercontent.com/mienfong/dsh-session-mgr/main/docs/screenshots/backup.png",
    "https://raw.githubusercontent.com/mienfong/dsh-session-mgr/main/docs/screenshots/import.png",
    "https://raw.githubusercontent.com/mienfong/dsh-session-mgr/main/docs/screenshots/delete-confirm.png"
  ]
}
```

(All are GitHub-hosted `https` images in the repo itself; skipping this is fine too — storefronts fall back to extracting from the README.)

## PR description suggestion · PR 描述建议

> **Add `dsh-session-mgr` (`session`)**
>
> Session manager for the DeepSeek Harness web UI: move, archive, restore, backup/export and import sessions across workspaces — including archived ones. Trilingual UI (English / 简体 / 繁體).
>
> - `dsh.bundle` manifest + `cordis.patch.yml` ✅
> - `dsh-plugin` topic ✅
> - Screenshots in `docs/screenshots/` (optional storefront entry added)

## After merge · 合并后

The site rebuilds automatically — no further action required.

---

## Commit list · 提交清单

| # | Subject |
|---|---|
| 1 | feat: dsh-session-mgr — move/archive/restore/backup(export)+import/delete sessions (trilingual) |
| 2 | docs(package): set repository URL to mienfong/dsh-session-mgr |
| 3 | docs: polish READMEs (badge version 0.5.0, screenshots walkthrough, import usage, contributing, screenshots dir) |
| 4 | fix(ui): move dialog excludes the session's current workspace and hints when no other workspace exists |
| 5 | docs: embed real screenshots in README (en + zh-CN) |
| 6 | docs(en): translate cross-machine note to English |
| 7 | docs(zh-CN): add cross-machine note in Chinese; refresh import screenshot |
| 8 | docs(zh-CN): fix heading typo (会话管理) |
| 9 | docs: add CONTRIBUTING.md |
| 10 | docs: add CHANGELOG.md |
