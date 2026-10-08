/**
 * 操作ログ用：Google Apps Script Webアプリ（スプレッドシートに紐づけて使う）
 *
 * ■ 目的
 * トライアル期間中、「誰が・どのタブで・どのコレクションに何回読み書きしたか」
 * 「書き込みの呼び出し元（関数名）」を、ログ用スプレッドシートに記録する。
 * Firestoreは使わないので、Firestoreの読み書き枠は消費しない。
 *
 * ■ 事前準備（お知らせ添付ファイル用の apps-script-storage.gs とは別のプロジェクトにすること）
 * 1. ログ用のGoogleスプレッドシートを新規作成する（名前は任意。例：「ポータル操作ログ」）
 * 2. そのスプレッドシートで「拡張機能」→「Apps Script」を開く
 * 3. このファイルの中身を丸ごと貼り付ける
 * 4. 下の SECRET を、他人に推測されにくい長いランダム文字列（半角英数字20文字以上）に書き換える
 *    （firebase-config.js の ACTIVITY_LOG_CONFIG.secret と同じ値にする）
 * 5. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    - 実行するユーザー：自分
 *    - アクセスできるユーザー：全員
 *    →「デプロイ」を押し、承認画面が出たら承認する。発行された「ウェブアプリのURL」を控える
 * 6. 控えたURLを firebase-config.js の ACTIVITY_LOG_CONFIG.webAppUrl に貼り付ける
 * 7. コードを書き換えたときは「デプロイを管理」→ 鉛筆アイコン →「新バージョン」で再デプロイしないと反映されない
 *
 * ■ シート構成
 * 「log」シートに、受信のたびに行を追加する（1行＝1イベント）。
 *   列：受信日時(JST) / 端末日時(JST) / メール / ページ / セッション / 種別 / タブ / コレクション / パス / 操作 / 読 / 書 / ローカル反映 / 呼び出し元 / 前のタブ
 *   ページ：一般画面（index.html）／管理画面（admin.html）
 *   種別：
 *     件数                … 前回送信からの、コレクション別の読み取り・書き込み件数の増分
 *     書き込み            … 書き込み1件ごとの記録（パス・操作・呼び出し元つき。1回の送信につき最大100件）
 *     書き込み(省略分)    … 上の上限を超えて個別記録を省いた書き込み件数
 *     タブ切替            … タブの切り替え
 *   操作：登録(上書き)／更新／追加／削除
 *   タブ：画面上の表示名（一般画面と管理画面で、同じ内部IDでも表示名が違うものは、画面ごとに変換）
 *   ※ 日本語化は、このスクリプト側の変換で行っている（ポータル側のファイルは、従来どおり英語の内部名で送ってくる）。
 *   ※ 列の見出しを変えたため、古い英語表記の行が残っている場合は、シートの2行目以降を一度削除してください。
 *
 * ■ 集計
 * エディタ上部の関数選択で「makeSummary」を選んで実行すると、「集計」シートに
 *   ・書き込みの 呼び出し元 × コレクション 別の件数
 *   ・メール別の 読み/書き 合計
 *   ・タブ別の 読み/書き 合計
 * を作る（実行のたびに作り直す）。
 *
 * ■ 保存日数（蓄積量）
 * ポータルの管理画面「システム管理 → 操作ログ（トライアル用）」の「記録の保存日数」で指定する。
 * 指定した日数より古い行は、ログを受信したときに、1日1回自動で削除される（トリガーの設定は不要）。
 * 保存ボタンを押した時にも、その場で削除される。未設定のときの既定値は DEFAULT_KEEP_DAYS。
 * 指定値は、このスクリプトの「スクリプト プロパティ」に保存される（コードを書き換え直しても消えない）。
 * ※ スプレッドシートには全体で約1,000万セルの上限がある。
 *
 * ■ 注意
 * ・このWebアプリのURLとSECRETは firebase-config.js（ページのソース）から誰でも読めるため、
 *   「偽のログを書き込まれうる」「保存日数を勝手に変えられうる（古いログが消える）」前提で、
 *   ログは「目安」として扱うこと。
 * ・記録するのは、メール・ページ名・タブ名・コレクション名・ドキュメントパス・件数・呼び出し元だけ。
 *   お知らせ・チャット・業務情報の本文など、ドキュメントの中身は記録しない。
 */

var SECRET = "kjkaenvhakfkklklksdfgsdfgawert45623sdfgxfv2r55";
var SHEET_NAME = "log";
var DEFAULT_KEEP_DAYS = 14;   // 管理画面で未設定のときの保存日数
var MIN_KEEP_DAYS = 1;
var MAX_KEEP_DAYS = 365;
var MAX_EVENTS_PER_REQUEST = 300;
var HEADERS = ["受信日時(JST)", "端末日時(JST)", "メール", "ページ", "セッション", "種別", "タブ",
               "コレクション", "パス", "操作", "読", "書", "ローカル反映", "呼び出し元", "前のタブ"];

// ---- 日本語への変換表 ----
var PAGE_LABEL = { "index.html": "一般画面", "admin.html": "管理画面", "kiosk.html": "掲示板モード" };
var TYPE_LABEL = { "tab": "タブ切替", "count": "件数", "write": "書き込み", "write-overflow": "書き込み(省略分)" };
var OP_LABEL = { "set": "登録(上書き)", "update": "更新", "add": "追加", "delete": "削除" };
// タブの表示名（内部ID → 画面上の名前）。画面（ページ）ごとに別の表。
var TAB_LABEL_GENERAL = {
  "dashboard": "ダッシュボード", "notices": "お知らせ", "calendar": "カレンダー", "whereabouts": "行き先",
  "chat": "チャット", "reserve": "予約", "contracts": "入札", "bizinfo": "業務情報", "checkout": "機材",
  "visitors": "出入予定", "safety": "安否確認", "safetyresponse": "安否回答"
};
var TAB_LABEL_ADMIN = {
  "equipment": "設備管理", "reservations": "予約状況（全体）", "userimport": "ユーザー管理", "notices": "お知らせ管理",
  "whereabouts": "行き先管理", "contracts": "入札管理", "bizinfo": "業務情報管理", "chatsettings": "チャット管理",
  "visitorsettings": "出入予定管理", "systemsettings": "システム管理", "calendar": "カレンダー管理"
};

function label(map, key) {
  if (key === undefined || key === null || key === "") return "";
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
}
function tabLabel(page, id) {
  var map = (page === "admin.html") ? TAB_LABEL_ADMIN : TAB_LABEL_GENERAL;
  return label(map, id);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!SECRET || SECRET.indexOf("YOUR_") === 0 || body.secret !== SECRET) {
      return jsonResponse({ error: "unauthorized" });
    }
    if (body.action === "log") return handleLog(body);
    if (body.action === "getSettings") return handleGetSettings();
    if (body.action === "setKeepDays") return handleSetKeepDays(body);
    return jsonResponse({ error: "unknown action" });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

function handleLog(body) {
  var events = (body.events || []).slice(0, MAX_EVENTS_PER_REQUEST);
  if (!events.length) return jsonResponse({ ok: true, rows: 0 });

  var now = new Date();
  var page = String(body.page || "");
  var rows = events.map(function (ev) {
    return [
      fmt(now),
      ev.t ? fmt(new Date(Number(ev.t))) : "",
      cell(body.email), cell(label(PAGE_LABEL, page)), cell(body.sid),
      cell(label(TYPE_LABEL, ev.type)), cell(tabLabel(page, ev.tab)),
      cell(ev.coll), cell(ev.path), cell(label(OP_LABEL, ev.op)),
      num(ev.reads), num(ev.writes), num(ev.local),
      cell(ev.caller), cell(tabLabel(page, ev.from))
    ];
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getLogSheet();
    var start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
    maybeTrimDaily(sheet); // 1日1回だけ、保存日数を超えた古い行を削除する
  } finally {
    lock.releaseLock();
  }
  return jsonResponse({ ok: true, rows: rows.length });
}

function handleGetSettings() {
  var sheet = getLogSheet();
  var last = sheet.getLastRow();
  var oldest = "";
  if (last >= 2) oldest = fmtAny(sheet.getRange(2, 1).getValue());
  var stored = PropertiesService.getScriptProperties().getProperty("KEEP_DAYS");
  return jsonResponse({
    ok: true,
    keepDays: getKeepDays(),
    isDefault: !stored,
    defaultDays: DEFAULT_KEEP_DAYS,
    rows: Math.max(last - 1, 0),
    cells: sheet.getMaxRows() * sheet.getMaxColumns(),
    oldest: oldest
  });
}

function handleSetKeepDays(body) {
  var days = Number(body.days);
  if (!isFinite(days) || Math.floor(days) !== days || days < MIN_KEEP_DAYS || days > MAX_KEEP_DAYS) {
    return jsonResponse({ error: "days must be an integer between " + MIN_KEEP_DAYS + " and " + MAX_KEEP_DAYS });
  }
  PropertiesService.getScriptProperties().setProperty("KEEP_DAYS", String(days));
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var deleted = 0;
  try {
    deleted = trimOldRowsOf(getLogSheet());
    PropertiesService.getScriptProperties().setProperty("LAST_TRIM_DATE", Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd"));
  } finally {
    lock.releaseLock();
  }
  var sheet = getLogSheet();
  return jsonResponse({ ok: true, keepDays: days, deleted: deleted, rows: Math.max(sheet.getLastRow() - 1, 0) });
}

function getKeepDays() {
  var v = Number(PropertiesService.getScriptProperties().getProperty("KEEP_DAYS"));
  return (isFinite(v) && v >= MIN_KEEP_DAYS && v <= MAX_KEEP_DAYS) ? v : DEFAULT_KEEP_DAYS;
}

function maybeTrimDaily(sheet) {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  if (props.getProperty("LAST_TRIM_DATE") === today) return;
  trimOldRowsOf(sheet);
  props.setProperty("LAST_TRIM_DATE", today);
}

// 保存日数より古い行（受信日時が古い行。行は受信順に並んでいる前提）を削除し、削除した行数を返す
function trimOldRowsOf(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var cutoff = new Date(Date.now() - getKeepDays() * 24 * 60 * 60 * 1000);
  var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  var del = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    var d = (v instanceof Date) ? v : new Date(String(v).replace(/-/g, "/"));
    if (isNaN(d.getTime()) || d >= cutoff) break;
    del++;
  }
  if (del > 0) sheet.deleteRows(2, del);
  return del;
}

function getLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    // 見出しが古い（英語表記など）場合は、現在の見出しに揃える
    var cur = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    var same = true;
    for (var i = 0; i < HEADERS.length; i++) if (cur[i] !== HEADERS[i]) { same = false; break; }
    if (!same) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
  }
  return sheet;
}

function fmt(d) {
  return Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}

function fmtAny(v) {
  return (v instanceof Date) ? fmt(v) : String(v);
}

// 文字列セルの無害化：先頭が = + - @ のとき数式として解釈されないよう、先頭にアポストロフィを付ける。長さも制限する。
function cell(v) {
  if (v === undefined || v === null) return "";
  var s = String(v).slice(0, 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function num(v) {
  var n = Number(v);
  return isFinite(n) ? n : "";
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 集計シートを作り直す（手動実行） */
function makeSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_NAME);
  if (!log || log.getLastRow() < 2) return;
  var data = log.getRange(2, 1, log.getLastRow() - 1, HEADERS.length).getValues();
  var I = { email: 2, type: 5, tab: 6, coll: 7, path: 8, reads: 10, writes: 11, caller: 13 };

  var byCaller = {}, byEmail = {}, byTab = {};
  data.forEach(function (r) {
    var type = r[I.type];
    if (type === TYPE_LABEL["write"]) {
      var k = r[I.caller] + "\t" + r[I.coll];
      byCaller[k] = (byCaller[k] || 0) + 1;
    }
    if (type === TYPE_LABEL["count"]) {
      var e = byEmail[r[I.email]] || (byEmail[r[I.email]] = [0, 0]);
      e[0] += Number(r[I.reads]) || 0; e[1] += Number(r[I.writes]) || 0;
      var t = byTab[r[I.tab] || "(不明)"] || (byTab[r[I.tab] || "(不明)"] = [0, 0]);
      t[0] += Number(r[I.reads]) || 0; t[1] += Number(r[I.writes]) || 0;
    }
  });

  var sheet = ss.getSheetByName("集計") || ss.insertSheet("集計");
  sheet.clear();
  var out = [["【書き込み1件ごとの記録】呼び出し元", "コレクション", "件数（上限100件/送信のため目安）"]];
  Object.keys(byCaller).map(function (k) { var p = k.split("\t"); return [p[0], p[1], byCaller[k]]; })
    .sort(function (a, b) { return b[2] - a[2]; }).forEach(function (x) { out.push(x); });
  out.push(["", "", ""]);
  out.push(["【メール別】メール", "読み取り合計", "書き込み合計"]);
  Object.keys(byEmail).map(function (k) { return [k, byEmail[k][0], byEmail[k][1]]; })
    .sort(function (a, b) { return b[1] - a[1]; }).forEach(function (x) { out.push(x); });
  out.push(["", "", ""]);
  out.push(["【タブ別】タブ", "読み取り合計", "書き込み合計"]);
  Object.keys(byTab).map(function (k) { return [k, byTab[k][0], byTab[k][1]]; })
    .sort(function (a, b) { return b[1] - a[1]; }).forEach(function (x) { out.push(x); });
  sheet.getRange(1, 1, out.length, 3).setValues(out);
}

/** 保存日数（管理画面で指定。未設定は DEFAULT_KEEP_DAYS）より古い行を、手動で削除する */
function trimOldRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (sheet) trimOldRowsOf(sheet);
}
