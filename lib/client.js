// lib/client.js — dsh-session-mgr browser half.
//
// Two surfaces:
//  1) Settings section "會話管理" (settings.section): full management page —
//     every conversation grouped by its current workspace (archived ones
//     clearly marked), per-row + batch move / archive / restore / backup /
//     delete (delete with double confirmation).
//  2) Conversation header action "移動到工作區"
//     (conversation.session.header.actions): move the open conversation.
//
// All data flows through the host API (POST /dsh-session-mgr/*); after a
// successful operation the client refreshes the native workspace/session
// stores so the sidebar regroups immediately.
window.__ModuleLoader__.load({
  id: "dsh-session-mgr",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    // ---------- styles ----------
    var STYLE_ID = "dsh-session-mgr-style";
    var CSS =
      ".dsm-page{font-size:13px;padding:2px 2px 24px;}" +
      ".dsm-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;position:sticky;top:0;z-index:5;background:var(--dsw-alias-bg-layer-2);padding:4px 0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);}" +
      ".dsm-page-title{font-weight:600;color:var(--dsw-alias-label-primary);}" +
      ".dsm-meta{color:var(--dsw-alias-label-secondary);font-size:12px;}" +
      ".dsm-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer;margin-right:4px;white-space:nowrap;}" +
      ".dsm-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}" +
      ".dsm-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;}" +
      ".dsm-btn-primary:hover:not(:disabled){opacity:.88;color:#fff;}" +
      ".dsm-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}" +
      ".dsm-btn-danger:hover:not(:disabled){background:rgba(230,80,80,.08);color:var(--dsw-alias-state-error-primary);}" +
      ".dsm-btn:disabled{opacity:0.45;cursor:default;}" +
      ".dsm-group{margin-bottom:12px;}" +
      ".dsm-group-head{display:flex;align-items:center;gap:8px;font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 4px;margin-bottom:4px;}" +
      ".dsm-group-path{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace;font-size:11px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".dsm-group-count{flex:none;border-radius:999px;background:rgba(120,120,120,.14);min-width:18px;text-align:center;padding:0 6px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);}" +
      ".dsm-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;}" +
      ".dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover);}" +
      ".dsm-row-main{flex:1;min-width:0;}" +
      ".dsm-row-title{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".dsm-row-id{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px;}" +
      ".dsm-badge{flex:none;border-radius:5px;padding:1px 6px;font-size:11px;line-height:16px;}" +
      ".dsm-badge-archived{background:rgba(217,165,20,.15);color:#a87b00;border:1px solid rgba(217,165,20,.4);}" +
      ".dsm-badge-running{background:rgba(28,158,90,.15);color:#1c9e5a;}" +
      ".dsm-badge-live{background:rgba(90,140,255,.12);color:#4a7dff;}" +
      ".dsm-row-ws{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".dsm-empty,.dsm-error{color:var(--dsw-alias-label-secondary);padding:24px 0;text-align:center;}" +
      ".dsm-error{color:var(--dsw-alias-state-error-primary);}" +
      ".dsm-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:8px 0;}" +
      ".dsm-legend{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:8px 0 10px;font-size:12px;}" +
      ".dsm-legend-item{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px 2px 6px;background:var(--dsw-alias-bg-layer-1);}" +
      ".dsm-legend-dot{width:8px;height:8px;border-radius:50%;flex:none;}" +
      ".dsm-legend-item b{font-weight:600;font-size:12px;}" +
      ".dsm-legend-desc{color:var(--dsw-alias-label-secondary);}" +
      ".dsm-legend-note{flex-basis:100%;color:var(--dsw-alias-state-warn-primary);font-size:12px;margin-top:2px;}" +
      ".dsm-dot-move{background:#4a7dff;}.dsm-dot-archive{background:#d9a514;}.dsm-dot-restore{background:#1c9e5a;}.dsm-dot-backup{background:#7c5cff;}.dsm-dot-delete{background:#d43b3b;}" +
      ".dsm-legend-move b{color:#4a7dff;}.dsm-legend-archive b{color:#a87b00;}.dsm-legend-restore b{color:#1c9e5a;}.dsm-legend-backup b{color:#7c5cff;}.dsm-legend-delete b{color:#d43b3b;}" +
      ".dsm-note{color:var(--dsw-alias-state-warn-primary);font-size:12px;margin:8px 0;}" +
      ".dsm-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;}" +
      ".dsm-modal{box-sizing:border-box;width:480px;max-width:92vw;max-height:82vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:16px;color:var(--dsw-alias-label-primary);font-size:13px;display:flex;flex-direction:column;gap:10px;}" +
      ".dsm-modal-title{font-weight:700;font-size:14px;}" +
      ".dsm-modal-sub{color:var(--dsw-alias-label-secondary);font-size:12px;}" +
      ".dsm-ws-opt{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;}" +
      ".dsm-ws-opt:hover{border-color:var(--dsw-alias-brand-primary);}" +
      ".dsm-ws-opt.dsm-selected{border-color:var(--dsw-alias-brand-primary);background:rgba(90,140,255,.08);}" +
      ".dsm-ws-opt-main{flex:1;min-width:0;}" +
      ".dsm-ws-opt-title{font-weight:600;}" +
      ".dsm-ws-opt-path{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".dsm-input{box-sizing:border-box;width:100%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);padding:7px 10px;font-size:12.5px;outline:none;}" +
      ".dsm-input:focus{border-color:var(--dsw-alias-brand-primary);}" +
      ".dsm-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px;}" +
      ".dsm-lang-switch{flex:none;display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;overflow:hidden;margin-left:auto;}" +
      ".dsm-lang-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;padding:1px 10px;cursor:pointer;}" +
      ".dsm-lang-btn:hover{color:var(--dsw-alias-label-primary);}" +
      ".dsm-lang-btn.dsm-lang-active{background:rgba(90,140,255,.14);color:#4a7dff;font-weight:600;}" +
      ".dsm-header-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:6px;padding:4px 6px;font-size:12px;}" +
      ".dsm-header-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}";

    function ensureStyle() {
      try {
        if (document.getElementById(STYLE_ID)) return;
        var el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch (e) {
        // ignore
      }
    }

    // ---------- localization ----------
    // Three UI languages: English, Simplified Chinese, Traditional Chinese.
    // The base language follows the app's setting (设置/Settings → 语言/Language):
    //   app "en"  -> English UI
    //   app "zh"  -> Simplified Chinese by default
    // The 簡體/繁體 switch inside this plugin page persists the preference.
    var STR = {
      en: {
        "section.label": "Session Manager",
        "page.title": "Session Manager",
        "page.meta": "{count} sessions · {archived} archived{run}{loading}",
        "page.meta.run": " · {running} running (can't move/archive/delete)",
        "page.meta.loading": " · loading…",
        "page.refresh": "Refresh",
        "page.moveSel": "Move selected ({n})…",
        "page.archiveSel": "Archive selected ({n})…",
        "page.restoreSel": "Restore selected ({n})…",
        "page.backupSel": "Backup selected ({n})…",
        "page.deleteSel": "Delete selected ({n})…",
        "page.tipNoArchiveSel": "No selected session can be archived",
        "page.tipNoRestoreSel": "No selected session can be restored",
        "page.ungrouped": "Ungrouped",
        "page.noTitle": "(untitled)",
        "page.created": "created",
        "page.badgeArchived": "Archived",
        "page.badgeRunning": "Running",
        "page.badgeOpen": "Open",
        "page.btnBackup": "Backup",
        "page.btnArchive": "Archive",
        "page.btnRestore": "Restore",
        "page.btnMove": "Move…",
        "page.btnDelete": "Delete",
        "legend.move.label": "Move",
        "legend.move.desc": "assign the session to another workspace (a workspace is a folder)",
        "legend.archive.label": "Archive",
        "legend.archive.desc": "hide from the sidebar (position kept)",
        "legend.restore.label": "Restore",
        "legend.restore.desc": "un-archive, back to its place",
        "legend.backup.label": "Backup",
        "legend.backup.desc": "copy the session folder to a chosen directory",
        "legend.delete.label": "Delete",
        "legend.delete.desc": "permanently erase from disk (double-confirm required)",
        "legend.running": "Running sessions cannot be moved / archived / backed up / deleted",
        "page.empty": "No sessions to manage",
        "page.loading": "Loading…",
        "page.ttRunning": "Running sessions cannot be {action}",
        "action.move": "moved",
        "action.archive": "archived",
        "action.restore": "restored",
        "action.backup": "backed up",
        "action.delete": "deleted",
        "page.selCount": "{n} selected session(s)",
        "page.currentSession": "the current session",
        "page.actions": "modified",
        "moveModal.title": "Move to Workspace",
        "moveModal.subtitle": "Move \"{x}\" to:",
        "moveModal.destLabel": "Choose a destination workspace:",
        "moveModal.otherDir": "Other folder (becomes Ungrouped)",
        "moveModal.otherDirDesc": "Enter an existing folder path; if it is a registered workspace the session moves there",
        "moveModal.cancel": "Cancel",
        "moveModal.confirm": "Move",
        "moveModal.busy": "Moving…",
        "backupModal.title": "Backup Session",
        "backupModal.subtitle": "Back up \"{x}\" to folder:",
        "backupModal.folderLabel": "Backup folder:",
        "backupModal.placeholder": "e.g. D:\\backups\\dsh-sessions",
        "backupModal.hint": "This exports a PORTABLE package — a <sessionId> folder with a manifest.json and the full session log. Copy it to another machine and use \"Import\" there; the import rewrites the cwd so the conversation resumes seamlessly.",
        "backupModal.cancel": "Cancel",
        "backupModal.confirm": "Start Backup",
        "backupModal.busy": "Backing up…",
        "deleteModal.title": "Delete Session",
        "deleteModal.subtitle": "Will permanently delete \"{x}\":",
        "deleteModal.warning": "⚠ This permanently erases the selected session(s) from disk (archive and session data). This cannot be undone. A backup is recommended. Please confirm the deletion again.",
        "deleteModal.cancel": "Cancel",
        "deleteModal.confirm": "Delete",
        "deleteModal.busy": "Deleting…",
        "importModal.title": "Import Session",
        "importModal.subtitle": "Import a portable session package into this machine:",
        "importModal.sourceLabel": "Export package folder (the <sessionId> folder containing manifest.json):",
        "importModal.targetLabel": "Target workspace or folder (the session's new cwd on this machine):",
        "importModal.hint": "The package keeps the whole conversation; the import rewrites the cwd to the destination so the session resumes seamlessly here.",
        "importModal.cancel": "Cancel",
        "importModal.confirm": "Import",
        "importModal.busy": "Importing…",
        "note.imported": "Imported session {sid} to \"{path}\"",
        "page.import": "Import",
        "note.moved": "Moved {n} session(s) to \"{path}\"",
        "note.movedOpen": " (if one is on screen, reopen it to load the new workspace)",
        "note.archived": "Archived {n} session(s)",
        "note.restored": "Restored {n} session(s)",
        "note.backedUp": "Backed up {n} session(s) to \"{path}\"",
        "note.deleted": "Deleted {n} session(s) (irreversible)",
        "note.movedHeader": "Moved. If this session is on screen, reopen it to load the new workspace.",
        "err.prefix": "{action} failed for {n} session(s): {ids}",
        "err.invalidResponse": "Request failed: the service returned an invalid response",
        "err.session-id-required": "sessionId is required",
        "err.target-required": "A destination path is required",
        "err.registry-unavailable": "Workspace registry service is unavailable",
        "err.persistence-unavailable": "Session persistence service is unavailable",
        "err.session-running": "Session is currently running and cannot be modified",
        "err.session-not-found": "No persisted record found for this session",
        "err.no-cwd": "The session has no cwd record, so its workspace cannot be determined",
        "err.target-invalid": "Cannot resolve the destination path (it may not exist): ",
        "err.target-not-dir": "The destination path is not a directory: ",
        "err.target-not-exists": "The destination path does not exist: ",
        "err.already-in-workspace": "This session is already in that workspace",
        "err.locate-failed": "Cannot locate the session archive",
        "err.artifact-missing": "The session archive is missing (possibly deleted from disk): ",
        "err.live-detach-failed": "The session is still resident in memory and cannot be evicted; close it first and retry",
        "err.collision": "A session folder with the same name already exists at the destination; refused to overwrite: ",
        "err.backup-dir-required": "A backup folder path is required",
        "err.backup-dir-not-dir": "The backup folder is not a directory: ",
        "err.backup-collision": "A backup folder with the same name already exists; refused to overwrite: ",
        "err.backup-verify-failed": "Backup failed: the log was not written to the destination",
        "err.not-archived": "This session is not in the archive set",
        "err.registry-not-started": "The workspace registry is not started",
        "err.domain-unavailable": "The storage domain is unavailable",
        "err.import-dir-required": "The import package path is required",
        "err.import-dir-not-found": "The import package path does not exist",
        "err.import-invalid-package": "Not a valid export package (missing or unreadable manifest.json / session log)",
        "err.import-session-exists": "A session with this id already exists on this machine",
        "header.btn": "Move to Workspace",
        "header.title": "Move this session to another workspace",
        "lang.zhLabel": "Language",
        "lang.simplified": "简体",
        "lang.traditional": "繁體"
      },
      "zh-CN": {
        "section.label": "会话管理",
        "page.title": "会话管理",
        "page.meta": "{count} 个会话 · {archived} 个已归档{run}{loading}",
        "page.meta.run": " · {running} 个运行中（不可移动/归档/删除）",
        "page.meta.loading": " · 加载中…",
        "page.refresh": "刷新",
        "page.moveSel": "移动选中 ({n})…",
        "page.archiveSel": "归档选中 ({n})…",
        "page.restoreSel": "恢复选中 ({n})…",
        "page.backupSel": "备份选中 ({n})…",
        "page.deleteSel": "删除选中 ({n})…",
        "page.tipNoArchiveSel": "选中的会话没有可归档的",
        "page.tipNoRestoreSel": "选中的会话没有可恢复的",
        "page.ungrouped": "未分组",
        "page.noTitle": "(无标题)",
        "page.created": "创建于",
        "page.badgeArchived": "已归档",
        "page.badgeRunning": "运行中",
        "page.badgeOpen": "已打开",
        "page.btnBackup": "备份",
        "page.btnArchive": "归档",
        "page.btnRestore": "恢复",
        "page.btnMove": "移动…",
        "page.btnDelete": "删除",
        "legend.move.label": "移动",
        "legend.move.desc": "把会话归到目标工作区（工作区 = 文件夹）",
        "legend.archive.label": "归档",
        "legend.archive.desc": "从侧栏隐藏（保留原位置）",
        "legend.restore.label": "恢复",
        "legend.restore.desc": "取消归档、回到原位置",
        "legend.backup.label": "备份",
        "legend.backup.desc": "复制会话文件夹到指定目录",
        "legend.delete.label": "删除",
        "legend.delete.desc": "从磁盘永久删除（需二次确认）",
        "legend.running": "运行中的会话不可移动／归档／备份／删除",
        "page.empty": "没有可管理的会话",
        "page.loading": "加载中…",
        "page.ttRunning": "运行中的会话不可{action}",
        "action.move": "移动",
        "action.archive": "归档",
        "action.restore": "恢复",
        "action.backup": "备份",
        "action.delete": "删除",
        "page.selCount": "{n} 个已选会话",
        "page.currentSession": "当前会话",
        "page.actions": "操作",
        "moveModal.title": "移动到工作区",
        "moveModal.subtitle": "将「{x}」移动到：",
        "moveModal.destLabel": "选择目标工作区：",
        "moveModal.otherDir": "其他目录（成为「未分组」）",
        "moveModal.otherDirDesc": "输入一个已存在的文件夹路径；若该路径已注册为工作区则移动到该工作区",
        "moveModal.cancel": "取消",
        "moveModal.confirm": "确认移动",
        "moveModal.busy": "移动中…",
        "backupModal.title": "备份会话",
        "backupModal.subtitle": "将「{x}」备份到文件夹：",
        "backupModal.folderLabel": "备份文件夹：",
        "backupModal.placeholder": "例如 D:\\backups\\dsh-sessions",
        "backupModal.hint": "这会汇出一个**可携式包**——一个含 manifest.json 与完整会话日志的 <sessionId> 文件夹。复制到另一台电脑后用「汇入」，汇入会重设 cwd，会话即可无缝继续。",
        "backupModal.cancel": "取消",
        "backupModal.confirm": "开始备份",
        "backupModal.busy": "备份中…",
        "deleteModal.title": "删除会话",
        "deleteModal.subtitle": "将永久删除「{x}」：",
        "deleteModal.warning": "⚠ 此操作会从磁盘永久删除选中的会话（存档与会话数据），不可复原。建议先备份。请再次确认删除。",
        "deleteModal.cancel": "取消",
        "deleteModal.confirm": "确认删除",
        "deleteModal.busy": "删除中…",
        "importModal.title": "汇入会话",
        "importModal.subtitle": "把可携式会话包汇入本机：",
        "importModal.sourceLabel": "汇出包文件夹（含 manifest.json 的 <sessionId> 文件夹）：",
        "importModal.targetLabel": "目标工作区 / 文件夹（此机上该会话的新 cwd）：",
        "importModal.hint": "包内含完整会话；汇入时会把 cwd 重设为目的地路径，会话即可在此机无缝继续。",
        "importModal.cancel": "取消",
        "importModal.confirm": "汇入",
        "importModal.busy": "汇入中…",
        "note.imported": "已汇入会话 {sid} 到「{path}」",
        "page.import": "汇入",
        "note.moved": "已将 {n} 个会话移动到「{path}」",
        "note.movedOpen": "（若其中某个会话正在显示中，请重新打开以加载新工作区）",
        "note.archived": "已归档 {n} 个会话",
        "note.restored": "已恢复 {n} 个会话",
        "note.backedUp": "已备份 {n} 个会话到「{path}」",
        "note.deleted": "已删除 {n} 个会话（不可复原）",
        "note.movedHeader": "已移动。若此会话正在显示中，请重新打开以加载新工作区。",
        "err.prefix": "{action}失败 {n} 个会话：{ids}",
        "err.invalidResponse": "请求失败：服务返回了无效响应",
        "err.session-id-required": "缺少 sessionId",
        "err.target-required": "请填写目标路径",
        "err.registry-unavailable": "工作区注册表服务不可用",
        "err.persistence-unavailable": "会话持久化服务不可用",
        "err.session-running": "会话正在运行中，无法执行此操作",
        "err.session-not-found": "找不到该会话的持久化记录",
        "err.no-cwd": "该会话没有 cwd 记录，无法判断其工作区",
        "err.target-invalid": "目标路径无法解析（可能不存在）：",
        "err.target-not-dir": "目标路径不是目录：",
        "err.target-not-exists": "目标路径不存在：",
        "err.already-in-workspace": "该会话已经在此工作区",
        "err.locate-failed": "无法定位该会话的存档文件",
        "err.artifact-missing": "会话存档文件不存在（可能已从磁盘删除）：",
        "err.live-detach-failed": "会话仍驻留内存且无法移除；请先关闭该会话再重试",
        "err.collision": "目标位置已存在同名会话文件夹，拒绝覆盖：",
        "err.backup-dir-required": "请填写备份文件夹路径",
        "err.backup-dir-not-dir": "备份文件夹不是目录：",
        "err.backup-collision": "备份目标已存在同名文件夹，拒绝覆盖：",
        "err.backup-verify-failed": "备份失败：日志未写入目标文件夹",
        "err.not-archived": "该会话不在归档集合中",
        "err.registry-not-started": "工作区注册表尚未启动",
        "err.domain-unavailable": "存储域服务不可用",
        "err.import-dir-required": "请填写汇入包路径",
        "err.import-dir-not-found": "汇入包路径不存在",
        "err.import-invalid-package": "不是有效的汇出包（缺少或无法读取 manifest.json / 会话日志）",
        "err.import-session-exists": "本机已存在同 id 的会话",
        "header.btn": "移动到工作区",
        "header.title": "移动此会话到其他工作区",
        "lang.zhLabel": "语言",
        "lang.simplified": "简体",
        "lang.traditional": "繁體"
      },
      "zh-TW": {
        "section.label": "會話管理",
        "page.title": "會話管理",
        "page.meta": "{count} 個會話 · {archived} 個已歸檔{run}{loading}",
        "page.meta.run": " · {running} 個運行中（不可移動/歸檔/刪除）",
        "page.meta.loading": " · 載入中…",
        "page.refresh": "重新整理",
        "page.moveSel": "移動選中 ({n})…",
        "page.archiveSel": "歸檔選中 ({n})…",
        "page.restoreSel": "恢復選中 ({n})…",
        "page.backupSel": "備份選中 ({n})…",
        "page.deleteSel": "刪除選中 ({n})…",
        "page.tipNoArchiveSel": "沒有可歸檔的已選會話",
        "page.tipNoRestoreSel": "沒有可恢復的已選會話",
        "page.ungrouped": "未分組",
        "page.noTitle": "(無標題)",
        "page.created": "建立於",
        "page.badgeArchived": "已歸檔",
        "page.badgeRunning": "運行中",
        "page.badgeOpen": "已開啟",
        "page.btnBackup": "備份",
        "page.btnArchive": "歸檔",
        "page.btnRestore": "恢復",
        "page.btnMove": "移動…",
        "page.btnDelete": "刪除",
        "legend.move.label": "移動",
        "legend.move.desc": "把會話歸到目的工作區（工作區 = 資料夾）",
        "legend.archive.label": "歸檔",
        "legend.archive.desc": "從側欄隱藏（保留原位置）",
        "legend.restore.label": "恢復",
        "legend.restore.desc": "取消歸檔、回到原位置",
        "legend.backup.label": "備份",
        "legend.backup.desc": "複製會話資料夾到指定目錄",
        "legend.delete.label": "刪除",
        "legend.delete.desc": "從磁碟永久刪除（需二次確認）",
        "legend.running": "運行中的會話不可移動／歸檔／備份／刪除",
        "page.empty": "沒有可管理的會話",
        "page.loading": "載入中…",
        "page.ttRunning": "運行中的會話不可{action}",
        "action.move": "移動",
        "action.archive": "歸檔",
        "action.restore": "恢復",
        "action.backup": "備份",
        "action.delete": "刪除",
        "page.selCount": "{n} 個已選會話",
        "page.currentSession": "目前會話",
        "page.actions": "操作",
        "moveModal.title": "移動到工作區",
        "moveModal.subtitle": "將「{x}」移動到：",
        "moveModal.destLabel": "選擇目的地工作區：",
        "moveModal.otherDir": "其他目錄（成為「未分組」）",
        "moveModal.otherDirDesc": "輸入一個已存在的資料夾路徑；若該路徑已註冊為工作區則移動到該工作區",
        "moveModal.cancel": "取消",
        "moveModal.confirm": "確認移動",
        "moveModal.busy": "移動中…",
        "backupModal.title": "備份會話",
        "backupModal.subtitle": "將「{x}」備份到資料夾：",
        "backupModal.folderLabel": "備份資料夾：",
        "backupModal.placeholder": "例如 D:\\backups\\dsh-sessions",
        "backupModal.hint": "這會匯出一個**可攜式包**——一個含 manifest.json 與完整會話日誌的 <sessionId> 資料夾。複製到另一台電腦後用「匯入」，匯入會重設 cwd，會話即可無縫繼續。",
        "backupModal.cancel": "取消",
        "backupModal.confirm": "開始備份",
        "backupModal.busy": "備份中…",
        "deleteModal.title": "刪除會話",
        "deleteModal.subtitle": "將永久刪除「{x}」：",
        "deleteModal.warning": "⚠ 此操作會從磁碟永久刪除選取的會話（存檔與會話資料），不可復原。建議先備份。請再次確認刪除。",
        "deleteModal.cancel": "取消",
        "deleteModal.confirm": "確認刪除",
        "deleteModal.busy": "刪除中…",
        "importModal.title": "匯入會話",
        "importModal.subtitle": "把可攜式會話包匯入本機：",
        "importModal.sourceLabel": "匯出包資料夾（含 manifest.json 的 <sessionId> 資料夾）：",
        "importModal.targetLabel": "目標工作區 / 資料夾（此機上該會話的新 cwd）：",
        "importModal.hint": "包內含完整會話；匯入時會把 cwd 重設為目的地路徑，會話即可在此機無縫繼續。",
        "importModal.cancel": "取消",
        "importModal.confirm": "匯入",
        "importModal.busy": "匯入中…",
        "note.imported": "已匯入會話 {sid} 到「{path}」",
        "page.import": "匯入",
        "note.moved": "已將 {n} 個會話移動到「{path}」",
        "note.movedOpen": "（若其中某個會話正在顯示中，請重新開啟以載入新工作區）",
        "note.archived": "已歸檔 {n} 個會話",
        "note.restored": "已恢復 {n} 個會話",
        "note.backedUp": "已備份 {n} 個會話到「{path}」",
        "note.deleted": "已刪除 {n} 個會話（不可復原）",
        "note.movedHeader": "已移動。若此會話正在顯示中，請重新開啟以載入新工作區。",
        "err.prefix": "{action}失敗 {n} 個會話：{ids}",
        "err.invalidResponse": "請求失敗：服務返回了無效回應",
        "err.session-id-required": "缺少 sessionId",
        "err.target-required": "請填寫目標路徑",
        "err.registry-unavailable": "工作區註冊表服務不可用",
        "err.persistence-unavailable": "會話持久化服務不可用",
        "err.session-running": "會話正在運行中，無法執行此操作",
        "err.session-not-found": "找不到該會話的持久化記錄",
        "err.no-cwd": "該會話沒有 cwd 記錄，無法判斷其工作區",
        "err.target-invalid": "目標路徑無法解析（可能不存在）：",
        "err.target-not-dir": "目標路徑不是目錄：",
        "err.target-not-exists": "目標路徑不存在：",
        "err.already-in-workspace": "該會話已經在此工作區",
        "err.locate-failed": "無法定位該會話的存檔檔案",
        "err.artifact-missing": "會話存檔檔案不存在（可能已從磁碟刪除）：",
        "err.live-detach-failed": "會話仍駐留記憶體且無法移除；請先關閉該會話再重試",
        "err.collision": "目標位置已存在同名會話資料夾，拒絕覆蓋：",
        "err.backup-dir-required": "請填寫備份資料夾路徑",
        "err.backup-dir-not-dir": "備份資料夾不是目錄：",
        "err.backup-collision": "備份目標已存在同名資料夾，拒絕覆蓋：",
        "err.backup-verify-failed": "備份失敗：日誌未寫入目標資料夾",
        "err.not-archived": "該會話不在歸檔集合中",
        "err.registry-not-started": "工作區註冊表尚未啟動",
        "err.domain-unavailable": "儲存域服務不可用",
        "err.import-dir-required": "請填寫匯入包路徑",
        "err.import-dir-not-found": "匯入包路徑不存在",
        "err.import-invalid-package": "不是有效的匯出包（缺少或無法讀取 manifest.json / 會話日誌）",
        "err.import-session-exists": "本機已存在同 id 的會話",
        "header.btn": "移動到工作區",
        "header.title": "移動此會話到其他工作區",
        "lang.zhLabel": "語言",
        "lang.simplified": "简体",
        "lang.traditional": "繁體"
      }
    };

    // App locale ('zh' | 'en') follows the harness language setting; the zh
    // script preference (简体/繁體) is this plugin's own persisted choice.
    var appLocale = "zh";
    var zhPref = "zh-CN";
    var localeListeners = [];

    function readZhPref() {
      try {
        var v = window.localStorage.getItem("dsh-session-mgr.zh");
        if (v === "zh-TW" || v === "zh-CN") return v;
      } catch (e) { /* ignore */ }
      return "zh-CN";
    }

    function writeZhPref(v) {
      try {
        window.localStorage.setItem("dsh-session-mgr.zh", v);
      } catch (e) { /* ignore */ }
    }

    function notifyLocale() {
      for (var i = 0; i < localeListeners.length; i++) {
        try { localeListeners[i](); } catch (e) { /* ignore */ }
      }
    }

    function setZhPref(v) {
      zhPref = v;
      writeZhPref(v);
      notifyLocale();
    }

    function syncAppLocale() {
      var next = "zh";
      try {
        if (runtimeCtx.locale && typeof runtimeCtx.locale.getLocale === "function") {
          var snap = runtimeCtx.locale.getLocale();
          if (snap && typeof snap.active === "string" && snap.active === "en") next = "en";
        }
      } catch (e) { /* ignore */ }
      if (appLocale !== next) {
        appLocale = next;
        notifyLocale();
      }
    }

    /** Resolve the active UI language: en / zh-CN / zh-TW. */
    function resolveLang() {
      return appLocale === "en" ? "en" : zhPref;
    }

    /** Localized string lookup with {var} substitution; falls back zh-TW then en. */
    function t(key, vars) {
      var lang = resolveLang();
      var table = STR[lang] || STR["zh-CN"] || STR["zh-TW"];
      var text = table[key];
      if (text === undefined) text = (STR["zh-TW"] || {})[key] || (STR["en"] || {})[key] || key;
      if (vars) {
        for (var k in vars) {
          if (Object.prototype.hasOwnProperty.call(vars, k)) {
            text = text.split("{" + k + "}").join(String(vars[k]));
          }
        }
      }
      return text;
    }

    /** Map a server error (code + raw message) to a localized string. */
    function tErr(code, raw) {
      if (typeof code === "string") {
        var mapped = t("err." + code);
        if (mapped && mapped !== ("err." + code)) return mapped;
      }
      return raw || t("err.invalidResponse");
    }

    function subscribeLocale(fn) {
      localeListeners.push(fn);
      return function () {
        var i = localeListeners.indexOf(fn);
        if (i !== -1) localeListeners.splice(i, 1);
      };
    }

    /** React hook: re-render whenever the app locale or zh script preference changes. */
    function useLocaleTick() {
      var _useState = react.useState(0);
      var tick = _useState[0];
      var setTick = _useState[1];
      react.useEffect(function () {
        var off = subscribeLocale(function () { setTick(function (v) { return v + 1; }); });
        return off;
      }, []);
      return tick;
    }

    // ---------- api ----------
    function api(action, args) {
      return fetch("/dsh-session-mgr/" + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args || {})
      }).then(function (res) {
        return res.json().catch(function () { return null; });
      }).then(function (payload) {
        if (payload === null || typeof payload !== "object") {
          throw new Error(t("err.invalidResponse"));
        }
        if (payload.error) {
          var code = typeof payload.error === "object" && payload.error !== null ? payload.error.code : undefined;
          var raw = typeof payload.error === "object" && payload.error !== null ? payload.error.message : String(payload.error);
          var e = new Error(tErr(code, raw));
          e.code = code;
          e.raw = raw;
          throw e;
        }
        return payload;
      });
    }

    function describe(err) {
      if (err === null || err === undefined) return String(err);
      if (typeof err === "object" && typeof err.message === "string") return err.message;
      return String(err);
    }

    // Client plugin context captured at apply() time; components read it here
    // (a bare `ctx` free variable would be a ReferenceError inside a component).
    var runtimeCtx = null;

    function refreshNativeViews() {
      try {
        if (runtimeCtx.workspaces && typeof runtimeCtx.workspaces.refresh === "function") {
          var p = runtimeCtx.workspaces.refresh();
          if (p && typeof p.catch === "function") p.catch(function () {});
        }
      } catch (e) { /* ignore */ }
      try {
        if (runtimeCtx.sessions && typeof runtimeCtx.sessions.refresh === "function") {
          var p2 = runtimeCtx.sessions.refresh();
          if (p2 && typeof p2.catch === "function") p2.catch(function () {});
        }
      } catch (e) { /* ignore */ }
    }

    function fmtTime(ms) {
      if (!ms) return "—";
      try {
        return new Date(ms).toLocaleString();
      } catch (e) {
        return String(ms);
      }
    }

    // ---------- shared destination picker modal ----------
    // props: title, subtitle, workspaces (array), busy, error, onConfirm(targetPath), onClose
    function MoveModal(props) {
      var _useState = react.useState(null);
      var selected = _useState[0];
      var setSelected = _useState[1];
      var _useState2 = react.useState("");
      var customPath = _useState2[0];
      var setCustomPath = _useState2[1];
      var _useState3 = react.useState("workspace");
      var mode = _useState3[0];
      var setMode = _useState3[1];

      var useCustom = mode === "custom";
      // `selected` holds the chosen workspace's PATH (the server resolves real
      // paths, not workspace ids); custom mode uses the typed path.
      var canConfirm = useCustom ? customPath.trim().length > 0 : selected !== null;
      var target = useCustom ? customPath.trim() : selected;

      var wsOptions = (props.workspaces || []).map(function (ws) {
        return react.createElement("div", {
          key: ws.id,
          className: "dsm-ws-opt" + (selected === ws.path ? " dsm-selected" : ""),
          onClick: function () {
            setSelected(ws.path);
            setMode("workspace");
          }
        },
          react.createElement("input", {
            type: "radio",
            checked: selected === ws.path,
            onChange: function () {
              setSelected(ws.path);
              setMode("workspace");
            }
          }),
          react.createElement("div", { className: "dsm-ws-opt-main" },
            react.createElement("div", { className: "dsm-ws-opt-title" }, ws.title),
            react.createElement("div", { className: "dsm-ws-opt-path" }, ws.path)
          ),
          react.createElement("span", { className: "dsm-group-count" }, String(ws.sessionCount || 0))
        );
      });

      var customOpt = react.createElement("div", {
        className: "dsm-ws-opt" + (useCustom ? " dsm-selected" : ""),
        onClick: function () { setMode("custom"); }
      },
        react.createElement("input", {
          type: "radio",
          checked: useCustom,
          onChange: function () { setMode("custom"); }
        }),
        react.createElement("div", { className: "dsm-ws-opt-main" },
          react.createElement("div", { className: "dsm-ws-opt-title" }, t("moveModal.otherDir")),
          react.createElement("div", { className: "dsm-ws-opt-path" }, t("moveModal.otherDirDesc"))
        )
      );

      return react.createElement("div", { className: "dsm-overlay", onClick: function (e) { if (e.target === e.currentTarget && !props.busy) props.onClose(); } },
        react.createElement("div", { className: "dsm-modal" },
          react.createElement("div", { className: "dsm-modal-title" }, props.title),
          props.subtitle ? react.createElement("div", { className: "dsm-modal-sub" }, props.subtitle) : null,
          react.createElement("div", null, t("moveModal.destLabel")),
          react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, wsOptions, customOpt),
          useCustom ? react.createElement("input", {
            className: "dsm-input",
            placeholder: "D:\\projects\\my-project",
            value: customPath,
            onChange: function (e) { setCustomPath(e.target.value); }
          }) : null,
          props.error ? react.createElement("div", { className: "dsm-error", style: { padding: 0, textAlign: "left" } }, String(props.error)) : null,
          react.createElement("div", { className: "dsm-modal-actions" },
            react.createElement("button", { className: "dsm-btn", disabled: props.busy, onClick: props.onClose }, t("moveModal.cancel")),
            react.createElement("button", {
              className: "dsm-btn dsm-btn-primary",
              disabled: props.busy || !canConfirm,
              onClick: function () { props.onConfirm(target); }
            }, props.busy ? t("moveModal.busy") : t("moveModal.confirm"))
          )
        )
      );
    }

    // ---------- backup modal ----------
    function BackupModal(props) {
      var _useState = react.useState(props.defaultDir || "");
      var dir = _useState[0];
      var setDir = _useState[1];
      return react.createElement("div", { className: "dsm-overlay", onClick: function (e) { if (e.target === e.currentTarget && !props.busy) props.onClose(); } },
        react.createElement("div", { className: "dsm-modal" },
          react.createElement("div", { className: "dsm-modal-title" }, props.title),
          props.subtitle ? react.createElement("div", { className: "dsm-modal-sub" }, props.subtitle) : null,
          react.createElement("div", null, t("backupModal.folderLabel")),
          react.createElement("input", {
            className: "dsm-input",
            placeholder: t("backupModal.placeholder"),
            value: dir,
            onChange: function (e) { setDir(e.target.value); }
          }),
          react.createElement("div", { className: "dsm-hint" }, t("backupModal.hint")),
          props.error ? react.createElement("div", { className: "dsm-error", style: { padding: 0, textAlign: "left" } }, String(props.error)) : null,
          react.createElement("div", { className: "dsm-modal-actions" },
            react.createElement("button", { className: "dsm-btn", disabled: props.busy, onClick: props.onClose }, t("backupModal.cancel")),
            react.createElement("button", {
              className: "dsm-btn dsm-btn-primary",
              disabled: props.busy || dir.trim().length === 0,
              onClick: function () { props.onConfirm(dir.trim()); }
            }, props.busy ? t("backupModal.busy") : t("backupModal.confirm"))
          )
        )
      );
    }

    // ---------- delete confirm modal (double confirmation) ----------
    function DeleteConfirmModal(props) {
      return react.createElement("div", { className: "dsm-overlay", onClick: function (e) { if (e.target === e.currentTarget && !props.busy) props.onClose(); } },
        react.createElement("div", { className: "dsm-modal", style: { borderColor: "var(--dsw-alias-state-error-primary)" } },
          react.createElement("div", { className: "dsm-modal-title" }, props.title),
          props.subtitle ? react.createElement("div", { className: "dsm-modal-sub" }, props.subtitle) : null,
          react.createElement("div", { className: "dsm-error", style: { padding: 0, textAlign: "left", border: "1px solid var(--dsw-alias-state-error-primary)", borderRadius: "8px", padding: "10px 12px", background: "rgba(230,80,80,.06)" } },
            t("deleteModal.warning")),
          props.error ? react.createElement("div", { className: "dsm-error", style: { padding: 0, textAlign: "left" } }, String(props.error)) : null,
          react.createElement("div", { className: "dsm-modal-actions" },
            react.createElement("button", { className: "dsm-btn", disabled: props.busy, onClick: props.onClose }, t("deleteModal.cancel")),
            react.createElement("button", {
              className: "dsm-btn dsm-btn-danger",
              disabled: props.busy,
              onClick: props.onConfirm
            }, props.busy ? t("deleteModal.busy") : t("deleteModal.confirm"))
          )
        )
      );
    }

    // ---------- import modal ----------
    // Import a portable export package (sourceDir) into this machine, remapping
    // the session cwd to a chosen target workspace / folder.
    function ImportModal(props) {
      var _useState = react.useState(props.defaultSourceDir || "");
      var sourceDir = _useState[0];
      var setSourceDir = _useState[1];
      var _useState2 = react.useState("");
      var targetPath = _useState2[0];
      var setTargetPath = _useState2[1];
      return react.createElement("div", { className: "dsm-overlay", onClick: function (e) { if (e.target === e.currentTarget && !props.busy) props.onClose(); } },
        react.createElement("div", { className: "dsm-modal" },
          react.createElement("div", { className: "dsm-modal-title" }, t("importModal.title")),
          react.createElement("div", { className: "dsm-modal-sub" }, t("importModal.subtitle")),
          react.createElement("div", null, t("importModal.sourceLabel")),
          react.createElement("input", {
            className: "dsm-input",
            placeholder: "D:\\backups\\session-xxxx",
            value: sourceDir,
            onChange: function (e) { setSourceDir(e.target.value); }
          }),
          react.createElement("div", null, t("importModal.targetLabel")),
          react.createElement("input", {
            className: "dsm-input",
            placeholder: "D:\\_Personal\\_program\\DeepSeek_Harness\\Chat",
            value: targetPath,
            onChange: function (e) { setTargetPath(e.target.value); }
          }),
          (props.workspaces && props.workspaces.length > 0)
            ? react.createElement("div", { className: "dsm-hint" },
                (props.workspaces || []).map(function (ws) {
                  return react.createElement("button", {
                    key: ws.id,
                    type: "button",
                    className: "dsm-btn",
                    onClick: function () { setTargetPath(ws.path); }
                  }, ws.title);
                }))
            : null,
          react.createElement("div", { className: "dsm-hint" }, t("importModal.hint")),
          props.error ? react.createElement("div", { className: "dsm-error", style: { padding: 0, textAlign: "left" } }, String(props.error)) : null,
          react.createElement("div", { className: "dsm-modal-actions" },
            react.createElement("button", { className: "dsm-btn", disabled: props.busy, onClick: props.onClose }, t("importModal.cancel")),
            react.createElement("button", {
              className: "dsm-btn dsm-btn-primary",
              disabled: props.busy || sourceDir.trim().length === 0 || targetPath.trim().length === 0,
              onClick: function () { props.onConfirm(sourceDir.trim(), targetPath.trim()); }
            }, props.busy ? t("importModal.busy") : t("importModal.confirm"))
          )
        )
      );
    }

    // ---------- settings page ----------
    function MovePage() {
      var _useState = react.useState(true);
      var loading = _useState[0];
      var setLoading = _useState[1];
      var _useState2 = react.useState(null);
      var error = _useState2[0];
      var setError = _useState2[1];
      var _useState3 = react.useState(null);
      var note = _useState3[0];
      var setNote = _useState3[1];
      var _useState4 = react.useState([]);
      var workspaces = _useState4[0];
      var setWorkspaces = _useState4[1];
      var _useState5 = react.useState([]);
      var sessions = _useState5[0];
      var setSessions = _useState5[1];
      var _useState6 = react.useState([]);
      var selected = _useState6[0];
      var setSelected = _useState6[1];
      var _useState7 = react.useState(null);
      var modal = _useState7[0];
      var setModal = _useState7[1];
      var _useState8 = react.useState(false);
      var moving = _useState8[0];
      var setMoving = _useState8[1];
      var _useState9 = react.useState(null);
      var modalError = _useState9[0];
      var setModalError = _useState9[1];
      var _useState10 = react.useState(null);
      var backupModal = _useState10[0];
      var setBackupModal = _useState10[1];
      var _useState11 = react.useState(null);
      var deleteModal = _useState11[0];
      var setDeleteModal = _useState11[1];
      var _useState12 = react.useState("C:\\Users\\03792\\.dsh\\backups\\sessions");
      var backupDefaultDir = _useState12[0];
      var setBackupDefaultDir = _useState12[1];
      var _useState13 = react.useState(null);
      var importModal = _useState13[0];
      var setImportModal = _useState13[1];
      useLocaleTick();

      function load() {
        setLoading(true);
        setError(null);
        api("list", {}).then(function (res) {
          setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
          setSessions(Array.isArray(res.sessions) ? res.sessions : []);
          if (typeof res.backupDefaultDir === "string" && res.backupDefaultDir.length > 0) {
            setBackupDefaultDir(res.backupDefaultDir);
          }
          var ids = {};
          for (var i = 0; i < (res.sessions || []).length; i++) ids[res.sessions[i].id] = true;
          setSelected(function (sel) { return sel.filter(function (id) { return ids[id]; }); });
          setLoading(false);
        }).catch(function (err) {
          setError(describe(err));
          setLoading(false);
        });
      }

      react.useEffect(function () { load(); }, []);

      var wsById = {};
      for (var i = 0; i < workspaces.length; i++) wsById[workspaces[i].id] = workspaces[i];

      // group sessions by current workspace (registry order, then ungrouped)
      var groups = [];
      var accounted = {};
      for (var g = 0; g < workspaces.length; g++) {
        var ws = workspaces[g];
        var members = sessions.filter(function (s) {
          if (s.workspaceId !== ws.id) return false;
          accounted[s.id] = true;
          return true;
        });
        groups.push({ key: ws.id, label: ws.title, path: ws.path, members: members });
      }
      var stray = sessions.filter(function (s) { return !accounted[s.id]; });
      if (stray.length > 0) groups.push({ key: "", label: t("page.ungrouped"), path: null, members: stray });

      function toggleSelect(id) {
        setSelected(function (sel) {
          return sel.includes(id) ? sel.filter(function (x) { return x !== id; }) : sel.concat([id]);
        });
      }

      function openModalFor(ids, fromLabel) {
        setModalError(null);
        setModal({ ids: ids, fromLabel: fromLabel });
      }

      function confirmMove(targetPath) {
        setMoving(true);
        setModalError(null);
        var cursor = Promise.resolve();
        var results = [];
        var ids = modal.ids;
        for (var i = 0; i < ids.length; i++) {
          (function (id) {
            cursor = cursor.then(function () {
              return api("move", { sessionId: id, targetPath: targetPath })
                .then(function () { results.push({ id: id, ok: true }); })
                .catch(function (err) { results.push({ id: id, ok: false, error: describe(err) }); });
            });
          })(ids[i]);
        }
        cursor.then(function () {
          var failed = results.filter(function (r) { return !r.ok; });
          refreshNativeViews();
          if (failed.length > 0) {
            setError(t("err.prefix", { action: t("action.move"), n: failed.length, ids: failed.map(function (f) { return f.id + " (" + f.error + ")"; }).join("；") }));
          } else {
            setError(null);
            setNote(t("note.moved", { n: ids.length, path: targetPath }) + (ids.length === 1 ? "" : t("note.movedOpen")));
          }
          setModal(null);
          setSelected([]);
          setMoving(false);
          return api("list", {});
        }).then(function (res) {
          setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
          setSessions(Array.isArray(res.sessions) ? res.sessions : []);
        }).catch(function (err) {
          setError(describe(err));
          setModal(null);
          setMoving(false);
        });
      }

      var archivedCount = sessions.filter(function (s) { return s.archived; }).length;
      var runningCount = sessions.filter(function (s) { return s.running; }).length;

      function runArchive(ids, archived) {
        setMoving(true);
        setError(null);
        var cursor = Promise.resolve();
        var results = [];
        for (var i = 0; i < ids.length; i++) {
          (function (id) {
            cursor = cursor.then(function () {
              return api(archived ? "archive" : "unarchive", { sessionId: id })
                .then(function () { results.push({ id: id, ok: true }); })
                .catch(function (err) { results.push({ id: id, ok: false, error: describe(err) }); });
            });
          })(ids[i]);
        }
        cursor.then(function () {
          var failed = results.filter(function (r) { return !r.ok; });
          refreshNativeViews();
          if (failed.length > 0) {
            setError(t("err.prefix", { action: t(archived ? "action.archive" : "action.restore"), n: failed.length, ids: failed.map(function (f) { return f.id + " (" + f.error + ")"; }).join("；") }));
          } else {
            setError(null);
            setNote(archived ? t("note.archived", { n: ids.length }) : t("note.restored", { n: ids.length }));
          }
          setSelected([]);
          setMoving(false);
          return api("list", {});
        }).then(function (res) {
          setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
          setSessions(Array.isArray(res.sessions) ? res.sessions : []);
        }).catch(function (err) {
          setError(describe(err));
          setMoving(false);
        });
      }

      var selectedArchived = selected.filter(function (id) {
        var s = sessions.find(function (x) { return x.id === id; });
        return !!(s && s.archived);
      }).length;
      var selectedNotArchived = selected.length - selectedArchived;

      function runBackup(ids, targetDir) {
        setMoving(true);
        setError(null);
        var cursor = Promise.resolve();
        var results = [];
        for (var i = 0; i < ids.length; i++) {
          (function (id) {
            cursor = cursor.then(function () {
              return api("backup", { sessionId: id, targetDir: targetDir })
                .then(function () { results.push({ id: id, ok: true }); })
                .catch(function (err) { results.push({ id: id, ok: false, error: describe(err) }); });
            });
          })(ids[i]);
        }
        cursor.then(function () {
          var failed = results.filter(function (r) { return !r.ok; });
          refreshNativeViews();
          if (failed.length > 0) {
            setError(t("err.prefix", { action: t("action.backup"), n: failed.length, ids: failed.map(function (f) { return f.id + " (" + f.error + ")"; }).join("；") }));
          } else {
            setError(null);
            setNote(t("note.backedUp", { n: ids.length, path: targetDir }));
          }
          setBackupModal(null);
          setSelected([]);
          setMoving(false);
          return api("list", {});
        }).then(function (res) {
          setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
          setSessions(Array.isArray(res.sessions) ? res.sessions : []);
        }).catch(function (err) {
          setError(describe(err));
          setBackupModal(null);
          setMoving(false);
        });
      }

      function runDelete(ids) {
        setMoving(true);
        setError(null);
        var cursor = Promise.resolve();
        var results = [];
        for (var i = 0; i < ids.length; i++) {
          (function (id) {
            cursor = cursor.then(function () {
              return api("delete", { sessionId: id })
                .then(function () { results.push({ id: id, ok: true }); })
                .catch(function (err) { results.push({ id: id, ok: false, error: describe(err) }); });
            });
          })(ids[i]);
        }
        cursor.then(function () {
          var failed = results.filter(function (r) { return !r.ok; });
          refreshNativeViews();
          if (failed.length > 0) {
            setError(t("err.prefix", { action: t("action.delete"), n: failed.length, ids: failed.map(function (f) { return f.id + " (" + f.error + ")"; }).join("；") }));
          } else {
            setError(null);
            setNote(t("note.deleted", { n: ids.length }));
          }
          setDeleteModal(null);
          setSelected([]);
          setMoving(false);
          return api("list", {});
        }).then(function (res) {
          setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
          setSessions(Array.isArray(res.sessions) ? res.sessions : []);
        }).catch(function (err) {
          setError(describe(err));
          setDeleteModal(null);
          setMoving(false);
        });
      }

      function runImport(sourceDir, targetPath) {
        setMoving(true);
        setError(null);
        api("import", { sourceDir: sourceDir, targetPath: targetPath })
          .then(function (res) {
            refreshNativeViews();
            setNote(t("note.imported", { sid: res.sessionId, path: res.cwd || targetPath }));
            setImportModal(null);
          })
          .catch(function (err) { setError(describe(err)); })
          .finally(function () { setMoving(false); });
      }

      var selLabel = t("page.selCount", { n: String(selected.length) });
      var header = react.createElement("div", { className: "dsm-toolbar" },
        react.createElement("span", { className: "dsm-page-title" }, t("page.title")),
        react.createElement("span", { className: "dsm-meta" },
          t("page.meta", {
            count: String(sessions.length),
            archived: String(archivedCount),
            run: runningCount > 0 ? t("page.meta.run", { running: String(runningCount) }) : "",
            loading: loading ? t("page.meta.loading") : ""
          })),
        react.createElement("button", { className: "dsm-btn", disabled: moving, onClick: function () { load(); } }, t("page.refresh")),
        react.createElement("button", {
          className: "dsm-btn",
          disabled: moving,
          onClick: function () {
            setModalError(null);
            setImportModal({});
          }
        }, t("page.import")),
        react.createElement("button", {
          className: "dsm-btn dsm-btn-primary",
          disabled: moving || selected.length === 0,
          onClick: function () { openModalFor(selected, selLabel); }
        }, t("page.moveSel", { n: String(selected.length) })),
        react.createElement("button", {
          className: "dsm-btn",
          disabled: moving || selectedNotArchived === 0,
          title: selectedNotArchived === 0 ? t("page.tipNoArchiveSel") : undefined,
          onClick: function () {
            var ids = selected.filter(function (id) {
              var s = sessions.find(function (x) { return x.id === id; });
              return !!(s && !s.archived);
            });
            runArchive(ids, true);
          }
        }, t("page.archiveSel", { n: String(selectedNotArchived) })),
        react.createElement("button", {
          className: "dsm-btn",
          disabled: moving || selectedArchived === 0,
          title: selectedArchived === 0 ? t("page.tipNoRestoreSel") : undefined,
          onClick: function () {
            var ids = selected.filter(function (id) {
              var s = sessions.find(function (x) { return x.id === id; });
              return !!(s && s.archived);
            });
            runArchive(ids, false);
          }
        }, t("page.restoreSel", { n: String(selectedArchived) })),
        react.createElement("button", {
          className: "dsm-btn",
          disabled: moving || selected.length === 0,
          onClick: function () {
            setModalError(null);
            setBackupModal({ ids: selected.slice(), fromLabel: selLabel });
          }
        }, t("page.backupSel", { n: String(selected.length) })),
        react.createElement("button", {
          className: "dsm-btn dsm-btn-danger",
          disabled: moving || selected.length === 0,
          onClick: function () {
            setModalError(null);
            setDeleteModal({ ids: selected.slice(), fromLabel: selLabel });
          }
        }, t("page.deleteSel", { n: String(selected.length) })),
        appLocale === "zh"
          ? react.createElement("span", { className: "dsm-lang-switch", title: t("lang.zhLabel") },
            react.createElement("button", {
              type: "button",
              className: "dsm-lang-btn" + (zhPref === "zh-CN" ? " dsm-lang-active" : ""),
              onClick: function () { setZhPref("zh-CN"); }
            }, t("lang.simplified")),
            react.createElement("button", {
              type: "button",
              className: "dsm-lang-btn" + (zhPref === "zh-TW" ? " dsm-lang-active" : ""),
              onClick: function () { setZhPref("zh-TW"); }
            }, t("lang.traditional"))
          )
          : null
      );

      var body;
      if (loading && sessions.length === 0) {
        body = react.createElement("div", { className: "dsm-empty" }, t("page.loading"));
      } else if (sessions.length === 0) {
        body = react.createElement("div", { className: "dsm-empty" }, t("page.empty"));
      } else {
        body = groups.map(function (group) {
          var rows = group.members.map(function (s) {
            var badges = [];
            if (s.archived) badges.push(react.createElement("span", { key: "a", className: "dsm-badge dsm-badge-archived" }, t("page.badgeArchived")));
            if (s.running) badges.push(react.createElement("span", { key: "r", className: "dsm-badge dsm-badge-running" }, t("page.badgeRunning")));
            else if (s.live) badges.push(react.createElement("span", { key: "l", className: "dsm-badge dsm-badge-live" }, t("page.badgeOpen")));
            var wsLabel = s.workspaceTitle || (s.cwd ? String(s.cwd).split(/[\\/]/).pop() : t("page.ungrouped"));
            return react.createElement("div", { key: s.id, className: "dsm-row" },
              react.createElement("input", {
                type: "checkbox",
                checked: selected.includes(s.id),
                disabled: moving || s.running,
                title: s.running ? t("page.ttRunning", { action: t("page.actions") }) : undefined,
                onChange: function () { toggleSelect(s.id); }
              }),
              react.createElement("div", { className: "dsm-row-main" },
                react.createElement("div", { className: "dsm-row-title" }, s.title || t("page.noTitle"), " ", badges),
                react.createElement("div", { className: "dsm-row-id" }, s.id + " · " + t("page.created") + " " + fmtTime(s.createdAt))
              ),
              react.createElement("span", { className: "dsm-row-ws", title: s.cwd || "" }, wsLabel),
              react.createElement("button", {
                className: "dsm-btn",
                disabled: moving || s.running,
                title: s.running ? t("page.ttRunning", { action: t("action.backup") }) : undefined,
                onClick: function () {
                  setModalError(null);
                  setBackupModal({ ids: [s.id], fromLabel: s.title || s.id });
                }
              }, t("page.btnBackup")),
              s.archived
                ? react.createElement("button", {
                    className: "dsm-btn",
                    disabled: moving,
                    onClick: function () { runArchive([s.id], false); }
                  }, t("page.btnRestore"))
                : react.createElement("button", {
                    className: "dsm-btn",
                    disabled: moving || s.running,
                    title: s.running ? t("page.ttRunning", { action: t("action.archive") }) : undefined,
                    onClick: function () { runArchive([s.id], true); }
                  }, t("page.btnArchive")),
              react.createElement("button", {
                className: "dsm-btn",
                disabled: moving || s.running,
                onClick: function () { openModalFor([s.id], s.title || s.id); }
              }, t("page.btnMove")),
              react.createElement("button", {
                className: "dsm-btn dsm-btn-danger",
                disabled: moving || s.running,
                title: s.running ? t("page.ttRunning", { action: t("action.delete") }) : undefined,
                onClick: function () {
                  setModalError(null);
                  setDeleteModal({ ids: [s.id], fromLabel: s.title || s.id });
                }
              }, t("page.btnDelete"))
            );
          });
          return react.createElement("div", { key: group.key || "ungrouped", className: "dsm-group" },
            react.createElement("div", { className: "dsm-group-head" },
              react.createElement("span", null, group.label),
              group.path ? react.createElement("span", { className: "dsm-group-path", title: group.path }, group.path) : null,
              react.createElement("span", { className: "dsm-group-count" }, String(group.members.length))
            ),
            rows
          );
        });
      }

      var legendItems = [
        { cls: "dsm-legend-move", dot: "dsm-dot-move", label: t("legend.move.label"), desc: t("legend.move.desc") },
        { cls: "dsm-legend-archive", dot: "dsm-dot-archive", label: t("legend.archive.label"), desc: t("legend.archive.desc") },
        { cls: "dsm-legend-restore", dot: "dsm-dot-restore", label: t("legend.restore.label"), desc: t("legend.restore.desc") },
        { cls: "dsm-legend-backup", dot: "dsm-dot-backup", label: t("legend.backup.label"), desc: t("legend.backup.desc") },
        { cls: "dsm-legend-delete", dot: "dsm-dot-delete", label: t("legend.delete.label"), desc: t("legend.delete.desc") }
      ];
      var hint = react.createElement("div", { className: "dsm-legend" },
        legendItems.map(function (item) {
          return react.createElement("span", { key: item.cls, className: "dsm-legend-item " + item.cls },
            react.createElement("i", { className: "dsm-legend-dot " + item.dot }),
            react.createElement("b", null, item.label),
            react.createElement("span", { className: "dsm-legend-desc" }, item.desc)
          );
        }),
        react.createElement("div", { className: "dsm-legend-note" }, t("legend.running"))
      );

      var modalEl = null;
      if (modal !== null) {
        modalEl = react.createElement(MoveModal, {
          title: t("moveModal.title"),
          subtitle: t("moveModal.subtitle", { x: modal.fromLabel }),
          workspaces: workspaces,
          busy: moving,
          error: modalError,
          onClose: function () { if (!moving) setModal(null); },
          onConfirm: confirmMove
        });
      }
      var backupEl = null;
      if (backupModal !== null) {
        backupEl = react.createElement(BackupModal, {
          title: t("backupModal.title"),
          subtitle: t("backupModal.subtitle", { x: backupModal.fromLabel }),
          defaultDir: backupDefaultDir,
          busy: moving,
          error: modalError,
          onClose: function () { if (!moving) setBackupModal(null); },
          onConfirm: function (dir) { runBackup(backupModal.ids, dir); }
        });
      }
      var deleteEl = null;
      if (deleteModal !== null) {
        deleteEl = react.createElement(DeleteConfirmModal, {
          title: t("deleteModal.title"),
          subtitle: t("deleteModal.subtitle", { x: deleteModal.fromLabel }),
          busy: moving,
          error: modalError,
          onClose: function () { if (!moving) setDeleteModal(null); },
          onConfirm: function () { runDelete(deleteModal.ids); }
        });
      }
      var importEl = null;
      if (importModal !== null) {
        importEl = react.createElement(ImportModal, {
          workspaces: workspaces,
          busy: moving,
          error: modalError,
          onClose: function () { if (!moving) setImportModal(null); },
          onConfirm: function (sourceDir, targetPath) { runImport(sourceDir, targetPath); }
        });
      }

      return react.createElement("div", { className: "dsm-page" },
        error ? react.createElement("div", { className: "dsm-error" }, String(error)) : null,
        note ? react.createElement("div", { className: "dsm-note" }, String(note)) : null,
        header, hint, body, modalEl, backupEl, deleteEl, importEl
      );
    }

    // ---------- conversation header action ----------
    function HeaderMoveAction(props) {
      var sessionId = props.sessionId;
      var _useState = react.useState(false);
      var open = _useState[0];
      var setOpen = _useState[1];
      var _useState2 = react.useState([]);
      var workspaces = _useState2[0];
      var setWorkspaces = _useState2[1];
      var _useState3 = react.useState(false);
      var moving = _useState3[0];
      var setMoving = _useState3[1];
      var _useState4 = react.useState(null);
      var error = _useState4[0];
      var setError = _useState4[1];
      var _useState5 = react.useState(null);
      var note = _useState5[0];
      var setNote = _useState5[1];
      useLocaleTick();

      function openModal() {
        setError(null);
        setNote(null);
        api("list", {}).then(function (res) {
          setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
          setOpen(true);
        }).catch(function (err) {
          setError(describe(err));
        });
      }

      function confirmMove(targetPath) {
        setMoving(true);
        setError(null);
        api("move", { sessionId: sessionId, targetPath: targetPath })
          .then(function () {
            refreshNativeViews();
            setNote(t("note.movedHeader"));
            setOpen(false);
          })
          .catch(function (err) { setError(describe(err)); })
          .finally(function () { setMoving(false); });
      }

      return react.createElement(react.Fragment, null,
        react.createElement("button", {
          type: "button",
          className: "dsm-header-btn",
          title: t("header.title"),
          onClick: openModal
        }, t("header.btn")),
        open ? react.createElement(MoveModal, {
          title: t("moveModal.title"),
          subtitle: t("moveModal.subtitle", { x: t("page.currentSession") }),
          workspaces: workspaces,
          busy: moving,
          error: error,
          onClose: function () { if (!moving) setOpen(false); },
          onConfirm: confirmMove
        }) : null,
        note ? react.createElement("span", { className: "dsm-note", style: { margin: 0 } }, String(note)) : null
      );
    }

    // ---------- plugin body ----------
    var inject = ["slots", "workspaces", "sessions", "locale"];

    function apply(ctx) {
      runtimeCtx = ctx;
      ensureStyle();
      zhPref = readZhPref();
      syncAppLocale();
      // Follow the harness language setting (Settings → Language) live.
      var localeSvc = ctx.get("locale");
      if (localeSvc && typeof localeSvc.subscribe === "function") {
        ctx.effect(function () {
          return localeSvc.subscribe(function () {
            syncAppLocale();
          });
        }, "ui-dsh-session-mgr: locale subscription");
      }
      ctx.effect(function () {
        return function () {
          try {
            var el = document.getElementById(STYLE_ID);
            if (el) el.remove();
          } catch (e) {
            // ignore
          }
        };
      }, "ui-dsh-session-mgr: style cleanup");

      var slots = ctx.get("slots");
      if (slots === undefined) return;

      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "dsh-session-mgr", order: 31, label: function () { return t("section.label"); } },
          function () { return react.createElement(MovePage); }
        );
      });

      slots.inject("conversation.session.header.actions", function () {
        return slots.register(
          { name: "conversation.session.header.actions", id: "dsh-session-mgr-action", order: 25 },
          HeaderMoveAction
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
