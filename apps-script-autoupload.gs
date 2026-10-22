/**
 * 業務情報の「自動更新（社内PC）」用：Google Apps Script 追加ファイル
 *
 * 既存の apps-script-storage.gs と同じプロジェクトに、「新しいファイル」として追加して貼り付ける。
 * （ファイルを追加するには、エディタ左側の「ファイル」の「＋」→「スクリプト」）
 *
 * ■ 役割
 *  - 管理画面（業務情報管理）からの設定（対象ファイルのパス・スケジュール。通知先は管理画面が業務情報の管理者＋システム管理者を書き込む）を保存する
 *  - 社内ノートPCのスクリプトからの「定期確認」を受け取り、設定を返す／結果を記録する
 *  - ノートPCからのファイルを、業務情報の既存ドライブファイルに「同じファイルIDのまま」上書きする
 *  - 失敗・ノートPCの停止をメールで知らせる
 *
 * ■ 設定手順（1回だけ）
 * 1. 下の AUTO_SECRET を、ノートPC専用の長いランダム文字列（20文字以上）に書き換える。
 *    ※ 管理画面（ブラウザ）用の SECRET とは別の値にすること。この値はブラウザ側のファイルには書かない。
 * 2. 既存の apps-script-storage.gs の doPost 関数の「先頭の var body = JSON.parse(...) の直後」に、次の2行を追加する：
 *      var autoRes = autoDispatch(body);
 *      if (autoRes) return autoRes;
 * 3. 「サービス」の「Drive API」が追加済みであることを確認する（空き容量表示で追加済みのはず）。
 * 4. エディタ上部の関数選択で autoSetupTrigger を選び「実行」する（1回だけ。メール送信などの権限の承認画面が出る）。
 *    → ノートPCからの連絡が一定時間途絶えた時にメールする、1時間ごとの確認が登録される。
 * 5. 「デプロイ」→「デプロイを管理」→ 鉛筆アイコン →「新バージョン」で再デプロイする（権限追加のため再承認が出る場合あり）。
 */

var AUTO_SECRET = "ここをノートPC専用の長いランダム文字列に書き換える";
var AUTO_HEARTBEAT_STALE_MIN = 60; // ノートPCからの連絡がこの分数途絶えたらメールする

function autoDispatch(body) {
  var pcActions = { autoPoll: 1, autoReplace: 1 };
  var uiActions = { autoGetState: 1, autoSaveConfig: 1 };
  try {
    if (pcActions[body.action]) {
      if (!AUTO_SECRET || AUTO_SECRET.indexOf("ここを") === 0 || body.autoSecret !== AUTO_SECRET) {
        return jsonResponse({ error: "unauthorized" });
      }
    } else if (uiActions[body.action]) {
      if (!SECRET || body.secret !== SECRET) return jsonResponse({ error: "unauthorized" });
    } else {
      return null; // 自動更新とは無関係のアクション
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (body.action === "autoGetState") return jsonResponse(autoGetState_());
      if (body.action === "autoSaveConfig") return jsonResponse(autoSaveConfig_(body.cfg));
      if (body.action === "autoPoll") return jsonResponse(autoPoll_(body));
      if (body.action === "autoReplace") return jsonResponse(autoReplace_(body));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
  return null;
}

/* ---------- 保存まわり（ScriptProperties） ---------- */
function autoLoad_(key, def) {
  var s = PropertiesService.getScriptProperties().getProperty(key);
  if (!s) return def;
  try { return JSON.parse(s); } catch (e) { return def; }
}
function autoSave_(key, obj) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(obj));
}
function autoCfg_() { return autoLoad_("auto_cfg", { adminEmails: [], targets: {} }); }

// メールアドレスの配列を整える（形式チェック・重複除去・最大50件）
function autoEmails_(list) {
  var seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(function (e) {
    var v = String(e || "").trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+$/.test(v) && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out.slice(0, 50);
}

/* ---------- 管理画面向け ---------- */
function autoGetState_() {
  return {
    cfg: autoCfg_(),
    status: autoLoad_("auto_status", {}),
    hb: autoLoad_("auto_hb", null),
    now: Date.now()
  };
}

function autoSaveConfig_(cfg) {
  cfg = cfg || {};
  // 2026-10-22：通知先は「その業務情報の管理者＋システム管理者」。管理画面が保存時に宛先を書き込む（旧alertEmailsは廃止）
  var out = { adminEmails: autoEmails_(cfg.adminEmails), targets: {} };
  var src = cfg.targets || {};
  Object.keys(src).forEach(function (id) {
    var t = src[id] || {};
    var path = String(t.path || "").trim();
    if (!path) return;
    out.targets[id] = {
      name: String(t.name || "").slice(0, 100),
      fileId: String(t.fileId || ""),
      path: path.slice(0, 500),
      mode: t.mode === "interval" ? "interval" : "daily",
      time: /^\d{1,2}:\d{2}$/.test(String(t.time || "")) ? String(t.time) : "08:30",
      hours: Math.max(1, Math.min(168, Number(t.hours) || 24)),
      enabled: t.enabled !== false,
      notifyTo: autoEmails_(t.notifyTo),
      runNowToken: String(t.runNowToken || "")
    };
  });
  autoSave_("auto_cfg", out);
  // 設定から外れた対象の実行状況を消す
  var status = autoLoad_("auto_status", {});
  Object.keys(status).forEach(function (id) { if (!out.targets[id]) delete status[id]; });
  autoSave_("auto_status", status);
  return { ok: true };
}

/* ---------- ノートPC向け ---------- */
function autoPoll_(body) {
  var cfg = autoCfg_();
  var status = autoLoad_("auto_status", {});
  var now = Date.now();
  var today = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  var reports = body.reports || [];
  reports.forEach(function (r) {
    if (!r || !r.itemId || !cfg.targets[r.itemId]) return;
    var st = status[r.itemId] || {};
    st.lastAttemptAt = now;
    st.lastResult = r.result;
    st.lastMessage = String(r.message || "").slice(0, 300);
    if (r.result === "ok" || r.result === "unchanged") {
      st.lastOkAt = now;
      if (r.result === "ok") st.lastUploadAt = now;
      st.alertedKey = "";
    } else if (r.result === "error") {
      var key = today + "|" + st.lastMessage;
      if (st.alertedKey !== key) {
        st.alertedKey = key;
        autoMail_(autoTargetRecipients_(cfg, cfg.targets[r.itemId]), "【ポータル自動更新】失敗：" + (cfg.targets[r.itemId].name || r.itemId),
          "業務情報「" + (cfg.targets[r.itemId].name || r.itemId) + "」の自動更新に失敗しました。\n\n" +
          "原因：" + st.lastMessage + "\n" +
          "パス：" + cfg.targets[r.itemId].path + "\n\n" +
          "ノートPCで、O:ドライブ（コワークストレージ）に接続できているかを確認してください。\n" +
          "同じ原因の通知は1日1回までです。");
      }
    }
    status[r.itemId] = st;
  });
  autoSave_("auto_status", status);

  var hb = autoLoad_("auto_hb", null) || {};
  var wasAlerted = !!hb.alerted;
  hb = { at: now, host: String(body.host || "").slice(0, 60), alerted: false };
  autoSave_("auto_hb", hb);
  if (wasAlerted) {
    autoMail_(autoAdminRecipients_(cfg), "【ポータル自動更新】ノートPCからの連絡が再開しました",
      "ノートPC（" + hb.host + "）からの連絡が再開しました。");
  }
  return { cfg: cfg, serverTime: now };
}

function autoReplace_(body) {
  var cfg = autoCfg_();
  var t = cfg.targets[body.itemId];
  if (!t) throw new Error("設定にない対象です");
  if (!t.fileId || t.fileId !== body.fileId) throw new Error("ファイルIDが設定と一致しません（管理画面で保存し直してください）");
  // 業務情報の保存先フォルダ内のファイルだけを対象にする
  var file = DriveApp.getFileById(body.fileId);
  var parents = file.getParents();
  var inFolder = false;
  while (parents.hasNext()) { if (parents.next().getId() === FOLDER_ID) inFolder = true; }
  if (!inFolder) throw new Error("保存先フォルダ外のファイルは更新できません");
  var bytes = Utilities.base64Decode(body.base64Data);
  var blob = Utilities.newBlob(bytes, body.mimeType || "application/octet-stream", file.getName());
  // 同じファイルID・同じURLのまま中身だけを置き換える（Drive 高度なサービス）
  Drive.Files.update({}, body.fileId, blob);
  return { ok: true };
}

/* ---------- 停止検知（1時間ごとのトリガー） ---------- */
function autoCheckHeartbeat() {
  var cfg = autoCfg_();
  var hasEnabled = Object.keys(cfg.targets).some(function (id) { return cfg.targets[id].enabled !== false; });
  if (!hasEnabled) return;
  var hb = autoLoad_("auto_hb", null);
  if (!hb || !hb.at) return;
  if (hb.alerted) return;
  var minutes = (Date.now() - hb.at) / 60000;
  if (minutes >= AUTO_HEARTBEAT_STALE_MIN) {
    hb.alerted = true;
    autoSave_("auto_hb", hb);
    autoMail_(autoAdminRecipients_(cfg), "【ポータル自動更新】ノートPCからの連絡が途絶えています",
      "ノートPC（" + (hb.host || "不明") + "）からの最終連絡は約" + Math.round(minutes) + "分前です。\n\n" +
      "考えられる原因：電源断／Windows Updateなどによる再起動／ネットワーク切断／スクリプトの停止。\n" +
      "ノートPCの状態を確認してください。連絡が再開すると、復旧のメールが届きます。");
  }
}

function autoSetupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "autoCheckHeartbeat") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("autoCheckHeartbeat").timeBased().everyHours(1).create();
}

// 宛先：失敗通知＝その業務情報の管理者＋システム管理者。未設定の場合はこのスクリプトの所有者へ送る。
function autoTargetRecipients_(cfg, target) {
  var to = autoEmails_((target && target.notifyTo || []).concat(cfg.adminEmails || []));
  return to.length ? to : autoOwner_();
}
// 停止検知・復旧のメールはシステム管理者へ
function autoAdminRecipients_(cfg) {
  var to = autoEmails_(cfg.adminEmails);
  return to.length ? to : autoOwner_();
}
function autoOwner_() {
  var me = "";
  try { me = Session.getEffectiveUser().getEmail(); } catch (e) {}
  return me ? [me] : [];
}
function autoMail_(to, subject, text) {
  if (!to || !to.length) return;
  MailApp.sendEmail(to.join(","), subject, text);
}
