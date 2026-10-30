/* =========================================================
   fs-counter.js  ―  Firestore 読み取り・書き込みの観測用ラッパー（診断専用）
   2026年10月6日：読み取り急増の原因切り分け用に追加。

   【仕組み】
   index.html / admin.html の Firestore import 元を、
     "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
   から "./fs-counter.js" に差し替えるだけで有効になる。
   このファイルは元のモジュールの全エクスポートをそのまま再エクスポートし、
   読み取り・書き込み系の関数だけ「数えてから本物を呼ぶ」版に置き換える。
   アプリ側のコードは一切変更不要・挙動も変わらない（数えるだけ）。
   元に戻す時は import 先を元のURLに戻せばよい。

   【使い方】
   ・（v3で廃止）画面右下のカウンタ ?fscount=1 は使えない。件数はスプレッドシートのログで確認する。
   ・F12 コンソールで：
       __fs.top()      … コレクション別の読み取り/書き込み件数（多い順）
       __fs.report()   … 上記を貼り付け用テキストで取得（クロに送る用）
       __fs.reset()    … 数え直し
   ・書き込みが短時間に集中（10秒で25件以上）すると、コンソールに
     [FS-BURST] と呼び出し元のスタックトレースを自動で出す（ループ特定用）。

   【読み取り件数の数え方（推定）】
   課金される読み取りに近づけるため、サーバーから届いた分だけを数える。
   ・getDoc = 1 / getDocs = 取得件数（キャッシュ由来は除外）
   ・onSnapshot = サーバー配信の docChanges 件数
     （自分の書き込みによるローカル反映＝hasPendingWrites、キャッシュ由来＝fromCache は
       別枠 local として数え、読み取りには含めない）
   ・Firestoreセキュリティルール内の exists()/get() による読み取りは、
     ブラウザ側からは見えないので、このカウンタには含まれない。
     → Firebaseコンソールの使用状況と差が出る場合、その差が候補。

   【2026年10月8日追加：操作ログ送信（トライアル期間の診断用）】
   firebase-config.js の ACTIVITY_LOG_CONFIG.webAppUrl が設定されているときだけ、
   「誰が・どのタブで・どのコレクションに何回読み書きしたか」「書き込みの呼び出し元」を
   Googleスプレッドシート（Apps Script経由）に、5分おき＋ページを閉じるときにまとめて送る。
   ・URLが空 / "YOUR_" で始まる場合は何もしない（完全に無効）。
   ・送るのは、メールアドレス・ページ名・タブ名・コレクション名・ドキュメントパス・件数・呼び出し元の関数名のみ。
     お知らせ本文・チャット本文・ドキュメントの中身は送らない。
   ・送信の失敗は握りつぶす（アプリの動作には一切影響しない）。
   ・止める時は ACTIVITY_LOG_CONFIG.webAppUrl を "" にするだけ。

   【2026年10月9日 v2：隠れ読み取り（課金とカウンタの差）の切り分け用に強化】
   ・「removed」（リスナーから消えた文書の通知）は読み取りに数えない。別枠 removed に分ける。
     ※v1のログとは「読」の意味が少し変わる（v1は removed も読に含めていた）。
   ・新しいログ行の種類（スプシの「種別」列。既存の列だけ使う＝Apps Script変更不要）
       listen  … リスナー開始後、サーバーから最初に届いたスナップショット。
                 コレクション列=ラベル / 読=クエリ全体の件数（課金される再送の上限の目安）/
                 ローカル反映=差分(docChanges)件数 / 呼び出し元="size=N changes=M"
                 ※この行の「読」は集計に足さない（count行と二重になる）。種別で除外すること。
       removed … removed 通知の件数（読列に件数。これも読の合計には足さない）
       env     … 端末情報。コレクション列=カウンタ版 / パス="OS/ブラウザ/standalone|browser/SW有|無" /
                 呼び出し元="w幅xh高 online=.."（セッション初回の送信時に1行）
       conn    … 接続・表示状態の変化。操作=hidden/visible/online/offline/freeze/resume/pageshow-bfcache/
                 sdk-offline/sdk-online、パス="前の状態が続いた秒数"
   ・sdk-offline/sdk-online は、既存の設定監視(app_settings/activity_log)のメタデータ変化から検出する。
     追加の読み取りは発生しない。
   ・ログが OFF の間は、これらの行も一切送らない（従来どおり）。

   【2026年10月30日 v3.7：無操作からの「再開」で課金される読み取りを、ログで説明できるようにする（観測のみ・挙動は変えない）】
   ・10/30のログとコンソールの突き合わせで、読み取りのスパイクは「無操作30分で解除した購読の再開」と時刻が一致した
     （14:25・14:35・14:40・14:50・15:38・15:40）。従来のログは、この再開で再課金される分を数えていなかった。
   ・再開のたびに、種別「env」・コレクション「復帰」の行を1本送る（件数行は送信のタイミングで時刻がずれるため、事象の時刻はこの行で見る）。
       パス   ＝ 原因（input:pointerdown / visible / focus / pageshow / exempt）・停止していた秒数・再開した購読の数・
                 再課金の上限（各購読の直近の件数の合計）・冷（30分以上停止）／温
       呼び出し元 ＝ 件数の多い購読の上位（ラベル:件数）
   ・冷（停止が30分以上）のときは、再課金の上限を「推定」に加える（件数行「★再接続推定 (再開)…」。累計の「推定」にも入る）。
     温（30分未満）は推定に加えない（環境行のみ）。実際に課金されたかどうかは、コンソールのグラフと見比べて判断する。
   ・解除した時刻（無操作30分）も、既存の「無操作時の購読停止」行に残る。

   【2026年10月28日 v3.6：無操作時の購読停止から、カレンダー編集中データの購読（calendar_days、約365件）を除外】
   ・停止→再開のたびに365件が丸ごと再課金されていたため（10/26〜28のログ：ヒネの再開で約365〜458件が6回）。
     つながったままなら、変更があった日付の分だけが課金される。それ以外の購読は、従来どおり停止・再開する。

   【2026年10月21日 v3.0：ログ1本化（画面のカウンタは廃止）と、取りこぼしの削減】
   ・読み書きの件数は、スプレッドシートのログだけで確認する。画面右下のカウンタ（?fscount）は廃止。
     （F12コンソールの __fs.top() / __fs.report() は残してある）
   ・ログ（種別「件数」）の 読・書 を合計すれば、一般画面・管理画面とも、そのページが数えた読み書きの合計になる。
   ・種別「env」でコレクションが「累計」の行 ＝ そのセッションの累計（読・書・推定・除）。件数行の合計と突き合わせれば、
     送信の取りこぼしがあったかどうかが分かる（seq が飛んでいれば、その送信が届いていない）。
   ・30分以上の切断のあとに再接続すると、Firestoreは購読中の結果を丸ごと再課金する（公式の料金説明）。
     ブラウザからは差分しか見えないため、切断が30分以上だったと判断できたとき、購読中の件数を
     「★再接続推定 コレクション名」の件数行として加える（推定値。実測ではない）。
   ・送信間隔 5分→2分、初回 30〜90秒→10〜25秒。送信失敗時は破棄せず次回に再送。バッファ上限 300→1000。
   ・ログ監視用の購読（app_settings/activity_log）の読み取りも、件数に含める。

   【2026年10月21日 v3.3：初回全件推定の取りこぼしを修正】
   ・v3.2は、購読の「最初のサーバー配信」でだけ推定していたため、データに変化がなく配信されない購読（約半数）が漏れていた
     （13:22の一般画面：local37に対し推定18）。購読の「最初の配信（キャッシュ由来でも）」の時点で、全件−実測の差を1回だけ推定に加える。
   ・読み込みが30分以内（温間）の分は、従来どおり別枠（参考）で、課金には数えない。

   【2026年10月21日 v3.2：実験で分かったこと（間が空いた後の読み込みは、キャッシュ分も全件課金される）の反映】
   ・実験（12:40〜12:56）：数分前に開いた画面の再読み込みは、課金が実測分（約18）だけ。42分空けた後の一般画面の読み込みは、
     コンソールが+48（実測8＋キャッシュ表示37＋他の人2＝47に一致）。→ 30分を超えて間が空くと、購読の結果が丸ごと課金される。
   ・そこで、前回の稼働（localStorage の心拍）から30分以上空いて読み込んだセッションでは、「★初回全件推定」を課金扱いで加算する。
     30分以内なら「☆初回全件（続き）」として別枠にし、課金には数えない（参考）。
   ・画面が休止していた（タイマーが2分以上止まった）場合も、その時間を再接続の切断時間として使う。
   ・env行の呼び出し元欄に「前回稼働から○秒」を追記。

   【2026年10月21日 v3.1：コンソールの件数との差を調べるための追加ログ】
   ・操作数：env行・コレクション「操作数」・パス=対象 に、前回送信からの getDoc/getDocs/count/listen開始/書き込み(set,update,add,delete)の回数
     （サーバー由来とキャッシュ由来を分ける）。Firestoreルール内の exists()/get() の読み取りを、ルールの内容と突き合わせて見積もるための材料。
   ・購読終了：env行・コレクション「購読終了 対象」に、生存秒・配信回数・読み・local・購読した場所。購読の張り直し（その都度全件が課金され得る）を見つける材料。
   ・★初回全件推定：購読の最初のサーバー配信で、画面側の差分より全件が多いとき、その差を件数行に加える（上限の推定）。
     キャッシュに前回の続きがある場合は実際の課金はこれより少ない。
   ・listen行の呼び出し元欄に、購読した場所（関数@ファイル:行）を追記。
   ・再接続検知：env行・コレクション「再接続検知」に、切断秒・購読数・推定。
   ・getCountFromServer / getAggregateFromServer / getDocFromServer / getDocsFromServer も数える（以前は数えていなかった：件数集計は1000件ごとに最低1件分の課金）。
   ・累計行に、稼働秒・購読中の数・配信回数・初回全件推定の累計を追記。

   【2026年10月12日 v2.1：異常急増の自動停止（ブレーカー）と、v2の既知の不具合2件の修正】
   ・ブレーカー：サーバーから届いた読み取りが「1分で2,000件超」または「10分で6,000件超」、
     書き込みが「1分で800件超」になったら、自動で
       ①全てのonSnapshot購読を解除 ②以後の読み書き・新しい購読を拒否 ③画面上部に赤い帯を表示
       ④ログに conn 行（操作=BREAKER、パス=理由）を送る（ログがOFFでも1回だけ送る）
     する。10/6の約8.8万件の急増（自己再帰）の再発を、数分で食い止めるための安全装置。
     画面を再読み込みすれば解除される（状態はメモリ上のみ）。
     無効化：URLに ?fsbreaker=0 を付けて開く（そのブラウザでは以後も無効。戻す時は ?fsbreaker=1）。
     ※通常の使い方（管理者が年度カレンダーを開く＝約366件、カレンダー公開＝書き込み約365件）は閾値の範囲内。
   ・修正1：ログON判定が届く前に来る「起動直後のlisten行」が失われていた → 判定が届くまで保留し、ONなら送る。
   ・修正2：__fs.reset() が logPrev を消さないため、ログに負の差分行が出た → logPrev も初期化する。
   ========================================================= */
const FS_COUNTER_VERSION = "v3.7 2026-10-30";
import * as FS from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const stats = {};            // label -> { reads, writes, local, removed, snapCalls }
const writeTimes = {};       // label -> [timestamps]
const lastWarnAt = {};       // label -> timestamp
const startedAt = Date.now();
// v3.2: 前回の稼働からの経過（読み込み時）と、画面休止の検出
const ALIVE_KEY = "fs_alive_at";
let coldGapSec = 0, coldKnown = false;
let lastTick = Date.now(), frozenGapSec = 0, frozenAt = 0;
try{
  const prev = Number(localStorage.getItem(ALIVE_KEY) || 0);
  if(prev){ coldGapSec = Math.round((Date.now() - prev) / 1000); coldKnown = true; }
}catch(e){}
const IS_COLD = !coldKnown || coldGapSec >= 1800;   // 記録が無い＝初回は、課金されるものとして扱う
function aliveTouch(){ try{ localStorage.setItem(ALIVE_KEY, String(Date.now())); }catch(e){} }
aliveTouch();
try{
  setInterval(()=>{
    const n = Date.now(), g = n - lastTick;
    if(g > 120000){ frozenGapSec = Math.round(g / 1000); frozenAt = n; }
    lastTick = n; aliveTouch();
  }, 20000);
  window.addEventListener("pagehide", aliveTouch);
}catch(e){}

function bucket(label){
  return stats[label] || (stats[label] = { reads:0, writes:0, local:0, removed:0, snapCalls:0 });
}
// 参照（doc / collection / query）から「コレクション名」のラベルを作る
function labelOf(ref){
  try{
    if(!ref) return "(unknown)";
    if(ref.__fsLabel) return ref.__fsLabel;
    if(typeof ref.path === "string"){
      // DocumentReference は親コレクション、CollectionReference はそのパス
      if(ref.type === "document" && ref.parent && typeof ref.parent.path === "string") return ref.parent.path;
      return ref.path;
    }
    const qp = ref._query && ref._query.path && typeof ref._query.path.canonicalString === "function"
      ? ref._query.path.canonicalString() : null;
    if(qp) return qp + " [query]";
  }catch(e){ /* 観測用なので失敗しても無視 */ }
  return "(unknown)";
}
/* ---------- 異常急増の自動停止（ブレーカー。v2.1） ---------- */
const BREAKER = { readsPerMin: 2000, readsPer10Min: 6000, writesPerMin: 800 };
let breakerTripped = false;
let breakerDisabled = false;
const breakerReadTimes = [];    // [時刻, 件数]
const breakerWriteTimes = [];
const liveUnsubs = new Set();
const liveSizes = new Map();    // v3: 購読ID -> { label, size }（再接続の再課金を推定するため、購読中の件数を覚えておく）
let liveSeq = 0;
const estStats = {};            // v3: label -> 推定の再課金件数（累計）   // onSnapshot の購読解除関数（トリップ時に全て解除する）
try{
  const bq = new URLSearchParams(location.search).get("fsbreaker");
  if(bq === "0") localStorage.setItem("fsbreaker_off", "1");
  if(bq === "1") localStorage.removeItem("fsbreaker_off");
  breakerDisabled = localStorage.getItem("fsbreaker_off") === "1";
}catch(e){}
function breakerNote(kind, n){
  if(breakerDisabled || breakerTripped || !(n > 0)) return;
  try{
    const now = Date.now();
    const arr = kind === "r" ? breakerReadTimes : breakerWriteTimes;
    arr.push([now, n]);
    while(arr.length && now - arr[0][0] > 600000) arr.shift();
    let m1 = 0, m10 = 0;
    for(const [t, c] of arr){ m10 += c; if(now - t <= 60000) m1 += c; }
    if(kind === "r" && (m1 > BREAKER.readsPerMin || m10 > BREAKER.readsPer10Min)) breakerTrip(`読み取り 1分${m1}件/10分${m10}件`);
    else if(kind === "w" && m1 > BREAKER.writesPerMin) breakerTrip(`書き込み 1分${m1}件`);
  }catch(e){}
}
function breakerTrip(reason){
  if(breakerTripped) return;
  breakerTripped = true;
  try{ console.error("[FS-BREAKER] 異常な急増を検知したため、読み書きと購読を自動停止しました：", reason, new Error("breaker-origin").stack); }catch(e){}
  try{ const us = Array.from(liveUnsubs); liveUnsubs.clear(); us.forEach(u=>{ try{ u(); }catch(e){} }); }catch(e){}
  try{ breakerShowBanner(reason); }catch(e){}
  try{ breakerReport(reason); }catch(e){}
}
function breakerShowBanner(reason){
  const mount = ()=>{
    if(document.getElementById("fs-breaker-banner")) return;
    const el = document.createElement("div");
    el.id = "fs-breaker-banner";
    el.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#B00020;color:#fff;font:14px/1.5 sans-serif;padding:10px 14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.4);";
    const msg = document.createElement("span");
    msg.textContent = "【自動停止】短時間にデータの読み書きが異常に増えたため、安全のため更新を止めました。この画面を再読み込み（F5）してください。（" + reason + "）";
    const btn = document.createElement("button");
    btn.textContent = "再読み込み";
    btn.style.cssText = "margin-left:12px;padding:3px 10px;border:0;border-radius:4px;cursor:pointer;";
    btn.addEventListener("click", ()=> location.reload());
    el.appendChild(msg); el.appendChild(btn);
    document.body.appendChild(el);
  };
  if(document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
}
// ログがOFFでも、トリップは1回だけ送る（conn 行の形式＝既存の列だけ使う）
async function breakerReport(reason){
  try{
    if(!logCfg) return;
    const email = await logResolveEmail();
    const body = JSON.stringify({
      secret: logCfg.secret, action: "log", email: email || "(unknown)",
      page: (location.pathname.split("/").pop() || "index"), sid: LOG_SID,
      events: [{ t: Date.now(), type: "conn", tab: logCurrentTab(), op: "BREAKER", path: String(reason).slice(0, 100), caller: FS_COUNTER_VERSION }]
    });
    await fetch(logCfg.webAppUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body, keepalive: true });
  }catch(e){}
}
function breakerGuard(){
  if(breakerTripped) throw new Error("FS-BREAKER: 異常な読み書きの急増を検知したため、自動停止中です。画面を再読み込みしてください。");
}

// v3.1: 操作の回数（ルール内 exists()/get() の読み取り見積もり用）
const ops = {};   // label -> { getDoc, getDocCache, getDocs, getDocsCache, count, listen, set, update, add, delete }
function opNote(label, k){ try{ const o = ops[label] || (ops[label] = {}); o[k] = (o[k] || 0) + 1; }catch(e){} }
let opsPrev = {};
const estWarm = {};    // v3.2: 参考（30分以内の再読み込みでキャッシュから表示された分。課金には数えない）
const estFirst = {};   // v3.1: label -> 初回全件推定（累計）
let estFirstPrev = {};
let snapTotal = 0;

function addRead(label, n){ try{ bucket(label).reads += n; }catch(e){} breakerNote("r", n); }
function addLocal(label, n){ try{ bucket(label).local += n; }catch(e){} }
function addWrite(label, op, ref){
  breakerNote("w", 1);
  try{
    bucket(label).writes += 1;
    const now = Date.now();
    const arr = writeTimes[label] || (writeTimes[label] = []);
    arr.push(now);
    while(arr.length && now - arr[0] > 10000) arr.shift();
    if(arr.length >= 25 && (!lastWarnAt[label] || now - lastWarnAt[label] > 30000)){
      lastWarnAt[label] = now;
      console.warn(`[FS-BURST] "${label}" への書き込みが10秒で${arr.length}件。呼び出し元：`, new Error("burst-origin").stack);
    }
  }catch(e){}
  try{ opNote(label, op); }catch(e){}
  try{ logWrite(label, op, ref); }catch(e){}
}

/* ---------- 読み取り系 ---------- */
export async function getDoc(ref, ...rest){
  breakerGuard();
  const snap = await FS.getDoc(ref, ...rest);
  try{
    if(snap.metadata && snap.metadata.fromCache){ addLocal(labelOf(ref), 1); opNote(labelOf(ref), "getDocCache"); }
    else { addRead(labelOf(ref), 1); opNote(labelOf(ref), "getDoc"); }
  }catch(e){}
  return snap;
}
// v3.1: サーバー指定の取得・件数集計も数える
export async function getDocFromServer(ref, ...rest){
  breakerGuard();
  const snap = await FS.getDocFromServer(ref, ...rest);
  try{ addRead(labelOf(ref), 1); opNote(labelOf(ref), "getDoc"); }catch(e){}
  return snap;
}
export async function getDocsFromServer(q, ...rest){
  breakerGuard();
  const snap = await FS.getDocsFromServer(q, ...rest);
  try{ addRead(labelOf(q), Math.max(snap.size, 1)); opNote(labelOf(q), "getDocs"); }catch(e){}
  return snap;
}
// 件数集計：インデックス1000件ごとに1件分（最低1件）の課金
export async function getCountFromServer(q, ...rest){
  breakerGuard();
  const snap = await FS.getCountFromServer(q, ...rest);
  try{
    let n = 0; try{ n = Number(snap.data().count) || 0; }catch(e){}
    addRead(labelOf(q) + " [count]", Math.max(1, Math.ceil(n / 1000)));
    opNote(labelOf(q) + " [count]", "count");
  }catch(e){}
  return snap;
}
export async function getAggregateFromServer(q, spec, ...rest){
  breakerGuard();
  const snap = await FS.getAggregateFromServer(q, spec, ...rest);
  try{ addRead(labelOf(q) + " [aggregate]", 1); opNote(labelOf(q) + " [aggregate]", "count"); }catch(e){}
  return snap;
}
export async function getDocs(q, ...rest){
  breakerGuard();
  const snap = await FS.getDocs(q, ...rest);
  try{
    const label = labelOf(q);
    if(snap.metadata && snap.metadata.fromCache){ addLocal(label, snap.size); opNote(label, "getDocsCache"); }
    else { addRead(label, Math.max(snap.size, 1)); opNote(label, "getDocs"); } // 0件のクエリでも最低1件分の課金がある
  }catch(e){}
  return snap;
}
function countSnapshot(label, snap){
  let srv = 0; // このスナップショットで「サーバーから届いた」と数えた件数（ブレーカー用）
  let loc = 0; // v3.1: ローカル扱いにした件数
  try{
    const b = bucket(label);
    b.snapCalls += 1;
    if(typeof snap.docChanges === "function"){
      // クエリ／コレクションのスナップショット
      const fromCache = !!(snap.metadata && snap.metadata.fromCache);
      snap.docChanges().forEach(ch=>{
        if(ch.type === "removed"){ b.removed += 1; return; }   // v2: removed は読み取りに数えない
        const pending = !!(ch.doc && ch.doc.metadata && ch.doc.metadata.hasPendingWrites);
        if(fromCache || pending){ b.local += 1; loc += 1; } else { b.reads += 1; srv += 1; }
      });
      if(snap.empty && !fromCache && snap.docChanges().length === 0 && b.snapCalls === 1){ b.reads += 1; srv += 1; }
    } else {
      // ドキュメントのスナップショット
      const fromCache = !!(snap.metadata && snap.metadata.fromCache);
      const pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
      if(fromCache || pending){ b.local += 1; loc += 1; } else { b.reads += 1; srv += 1; }
    }
  }catch(e){}
  breakerNote("r", srv);
  return [srv, loc];
}
// v2: リスナーごとに「最初のサーバー配信」を記録する（課金される再送の上限の目安）
function makeCb(label, orig, ref, lid){
  let firstDone = false;
  return (snap, ...r)=>{
    try{
      const [srvN, locN] = countSnapshot(label, snap);
      snapTotal += 1;
      const ent0 = liveSizes.get(lid);
      if(ent0){ ent0.snaps += 1; ent0.srv += srvN; ent0.loc += locN; }
      // v3.3: 購読の最初の配信（キャッシュ由来でも）で、全件(size)−実測(srvN) を1回だけ推定する
      if(ent0 && !ent0.initDone){
        ent0.initDone = true;
        try{
          const size0 = (typeof snap.docChanges === "function") ? snap.size : (snap.exists() ? 1 : 0);
          const ex = Math.max(0, size0 - srvN);
          ent0.extra = ex;
          if(ex > 0){
            if(IS_COLD) estFirst[label] = (estFirst[label] || 0) + ex;   // 前回稼働から30分超：課金扱い
            else estWarm[label] = (estWarm[label] || 0) + ex;           // 30分以内：続きから再開＝課金は少ない（参考）
          }
        }catch(e){}
      }
      try{
        const ent = liveSizes.get(lid);
        if(ent && !(snap.metadata && snap.metadata.fromCache && ent.size)){
          ent.size = (typeof snap.docChanges === "function") ? snap.size : (snap.exists() ? 1 : 0);
        }
      }catch(e){}
      if(!firstDone){
        const fromCache = !!(snap.metadata && snap.metadata.fromCache);
        const pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
        if(!fromCache && !pending){
          firstDone = true;
          const extra = ent0 ? (ent0.extra || 0) : 0;
          logListen(label, snap, ent0, extra);
        }
      }
    }catch(e){}
    return orig(snap, ...r);
  };
}
// v3.6: 無操作時の購読停止の対象外にする購読のラベル（labelOf の結果）
const IDLE_KEEP_LABELS = ["calendar_days [query]"];
export function onSnapshot(ref, ...args){
  if(breakerTripped) return ()=>{};   // v2.1：自動停止中は新しい購読を開始しない
  const label = labelOf(ref);
  const lid = ++liveSeq;
  liveSizes.set(lid, { label, size: 0, start: Date.now(), caller: (function(){ try{ return logCaller(); }catch(e){ return ""; } })(), snaps: 0, srv: 0, loc: 0 });
  opNote(label, "listen");
  const a = args.slice();
  try{
    if(typeof a[0] === "function"){
      a[0] = makeCb(label, a[0], ref, lid);
    } else if(a[0] && typeof a[0].next === "function"){
      const obs = a[0]; const cb = makeCb(label, obs.next.bind(obs), ref, lid);
      a[0] = Object.assign({}, obs, { next: cb });
    } else if(typeof a[1] === "function"){
      // onSnapshot(ref, options, onNext, onError)
      a[1] = makeCb(label, a[1], ref, lid);
    } else if(a[1] && typeof a[1].next === "function"){
      const obs = a[1]; const cb = makeCb(label, obs.next.bind(obs), ref, lid);
      a[1] = Object.assign({}, obs, { next: cb });
    }
  }catch(e){ /* ラップに失敗したら、元の引数のまま本物を呼ぶ */ liveSizes.delete(lid); return FS.onSnapshot(ref, ...args); }
  // v3.5: 画面が長時間「裏」にある間は購読を解除し、表に戻ったら同じ引数で張り直す（下の「放置時の購読停止」）
  // v3.6: 件数が多く、変更が少ない購読（編集権限者のカレンダー編集中データ、約365件）は、停止の対象にしない。
  // 停止すると、再開は必ず「30分超の切断後」になり、365件が毎回丸ごと再課金されていた（10/26〜28のログで確認）。
  // つながったままなら、変更された日付の分しか課金されない。
  const handle = { suspended: false, dead: false, keep: IDLE_KEEP_LABELS.indexOf(label) !== -1 };
  let cur = null;
  if(idleSuspended && !handle.keep){
    // 停止中に新しく作られた購読は、表に戻るまで実際には開始しない
    handle.suspended = true;
    cur = ()=>{};
    try{ const e0 = liveSizes.get(lid); if(e0) e0.suspended = true; }catch(e){}
  } else {
    cur = FS.onSnapshot(ref, ...a);
  }
  const wrapped = ()=>{
    handle.dead = true;
    idleHandles.delete(handle);
    liveUnsubs.delete(wrapped);
    try{ const ent = liveSizes.get(lid); if(ent) logListenEnd(ent); }catch(e){}
    liveSizes.delete(lid);
    try{ cur(); }catch(e){}
  };
  handle.suspend = ()=>{
    if(handle.suspended || handle.dead || handle.keep) return;
    handle.suspended = true;
    try{ cur(); }catch(e){}
    try{ const ent = liveSizes.get(lid); if(ent) ent.suspended = true; }catch(e){}
  };
  handle.resume = ()=>{
    if(!handle.suspended || handle.dead || breakerTripped) return;
    handle.suspended = false;
    try{ const ent = liveSizes.get(lid); if(ent){ ent.suspended = false; ent.initDone = false; } }catch(e){}
    cur = FS.onSnapshot(ref, ...a);
  };
  idleHandles.add(handle);
  liveUnsubs.add(wrapped);
  return wrapped;
}

/* =========================================================
   v3.5  無操作時の購読停止（読み取り削減）
   画面を操作しない状態が IDLE 分（既定30分。システム管理「アクティブ表示維持の時間」で変更可）続いたら、
   全ての onSnapshot 購読を解除し、表に出ている場合は「一時停止中」の覆いを出す。
   クリック・キー操作・タッチ（または裏のタブが表に戻る）で、同じ引数で全て張り直す。
   理由：Firestoreは、30分を超えて切断された購読を再接続すると、購読中の結果を丸ごと再課金する。
         放置されたタブは約55分ごとに再接続しており、これが読み取りの大きな増加要因と見られる。
   対象外：共用アカウント、サイネージ表示（行き先 ?display=1、予約 ?reserveSignage=）。
           index.html が configureIdle({ exempt:true }) で知らせる。
   ========================================================= */
let idleKeepMin = 30;
let idleExempt = false;
const idleHandles = new Set();
let idleSuspended = false;
let idleSuspendedAt = 0;     // v3.7: 購読を解除した時刻（再開時に「何秒止めていたか」を出すため）
let lastInputAt = Date.now();
let idleOverlayEl = null;
export function configureIdle(opts){
  try{
    opts = opts || {};
    const m = Number(opts.minutes);
    if(isFinite(m) && m >= 1 && m <= 1440) idleKeepMin = Math.floor(m);
    if(typeof opts.exempt === "boolean" && opts.exempt !== idleExempt){
      idleExempt = opts.exempt;
      if(idleExempt) idleResumeAll("exempt");
      else lastInputAt = Date.now();
    }
  }catch(e){}
}
function idleNote(msg){
  try{ if(typeof console !== "undefined") console.info("[FS] " + msg); }catch(e){}
  try{ if(logCfg && logEnabled) logPush({ t: Date.now(), type: "env", tab: logCurrentTab(), coll: "無操作時の購読停止", path: msg, caller: "" }); }catch(e){}
}
function idleShowOverlay(){
  try{
    if(idleOverlayEl || !document.body) return;
    const d = document.createElement("div");
    d.id = "idle-suspend-overlay";
    d.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.88);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:inherit;text-align:center;cursor:pointer;";
    d.innerHTML = '<div style="font-size:22px;font-weight:700;">操作がないため一時停止しています</div><div style="font-size:14px;opacity:.85;">クリックまたはキー操作で再開します</div>';
    document.body.appendChild(d);
    idleOverlayEl = d;
  }catch(e){}
}
function idleHideOverlay(){
  try{ if(idleOverlayEl){ idleOverlayEl.remove(); idleOverlayEl = null; } }catch(e){}
}
function idleSuspendAll(){
  if(idleSuspended || breakerTripped || idleExempt) return;
  idleSuspended = true;
  idleSuspendedAt = Date.now();
  let n = 0;
  idleHandles.forEach(h=>{ if(!h.suspended && !h.dead && !h.keep){ h.suspend(); n++; } });
  if(document.visibilityState !== "hidden") idleShowOverlay();
  idleNote(`無操作${idleKeepMin}分：購読${n}件を解除`);
}
function idleResumeAll(reason){
  idleHideOverlay();
  if(!idleSuspended) return;
  idleSuspended = false;
  lastInputAt = Date.now();
  // v3.7: 再開で再課金される読み取りの見積もりと、事象の記録（再開する前に、解除中の購読の件数を集計する）
  try{
    const gapSec = idleSuspendedAt ? Math.round((Date.now() - idleSuspendedAt) / 1000) : 0;
    const cold = gapSec >= 1800;
    const rows = [];
    let total = 0, cnt = 0;
    liveSizes.forEach(ent=>{
      if(!ent.suspended) return;
      const n = Math.max(ent.size || 0, 1);
      rows.push([ent.label, n]); total += n; cnt++;
      if(cold) estStats["(再開)" + ent.label] = (estStats["(再開)" + ent.label] || 0) + n;
    });
    rows.sort((a, b)=> b[1] - a[1]);
    const top = rows.slice(0, 5).map(r=> r[0] + ":" + r[1]).join(" ");
    if(logCfg && logEnabled) logPush({ t: Date.now(), type: "env", tab: logCurrentTab(), coll: "復帰",
      path: `原因=${reason || "?"} 停止${gapSec}秒 購読${cnt}件 再課金上限${total} ${cold ? "冷(推定に加算)" : "温(推定に加算せず)"}`, caller: top });
    if(typeof console !== "undefined") console.info(`[FS] 復帰 原因=${reason || "?"} 停止${gapSec}秒 購読${cnt}件 再課金上限${total} ${cold ? "冷" : "温"}`);
  }catch(e){}
  let n = 0;
  Array.from(idleHandles).forEach(h=>{ if(h.suspended && !h.dead){ h.resume(); n++; } });
  idleNote(`再開：購読${n}件`);
}
try{
  const act = ()=>{ lastInputAt = Date.now(); };
  ["pointermove","scroll"].forEach(t=> window.addEventListener(t, act, { capture:true, passive:true }));
  ["pointerdown","keydown","wheel","touchstart"].forEach(t=> window.addEventListener(t, (ev)=>{
    lastInputAt = Date.now();
    if(idleSuspended && (!ev || ev.isTrusted !== false)){
      if(idleOverlayEl && ev && typeof ev.preventDefault === "function" && t !== "wheel" && t !== "touchstart") { try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){} }
      idleResumeAll("input:" + t);
    }
  }, { capture:true, passive:false }));
  document.addEventListener("visibilitychange", ()=>{
    if(document.visibilityState !== "hidden"){ lastInputAt = Date.now(); idleResumeAll("visible"); }
  });
  // 前面の別ウィンドウが閉じる・最小化されて、このウィンドウが繰り上がって前面になった場合
  // （ブラウザが「表のまま」と判定していて visibilitychange が出ないとき）も、フォーカスで再開する
  window.addEventListener("focus", ()=>{ if(idleSuspended){ lastInputAt = Date.now(); idleResumeAll("focus"); } });
  window.addEventListener("pageshow", ()=>{ if(idleSuspended){ lastInputAt = Date.now(); idleResumeAll("pageshow"); } });
  setInterval(()=>{
    if(idleExempt || idleSuspended) return;
    if(Date.now() - lastInputAt >= idleKeepMin * 60000) idleSuspendAll();
  }, 20000);
}catch(e){}

/* ---------- 書き込み系 ---------- */
export async function setDoc(ref, ...rest){ breakerGuard(); addWrite(labelOf(ref), "set", ref); return FS.setDoc(ref, ...rest); }
export async function updateDoc(ref, ...rest){ breakerGuard(); addWrite(labelOf(ref), "update", ref); return FS.updateDoc(ref, ...rest); }
export async function addDoc(ref, ...rest){ breakerGuard(); addWrite(labelOf(ref), "add", ref); return FS.addDoc(ref, ...rest); }
export async function deleteDoc(ref, ...rest){ breakerGuard(); addWrite(labelOf(ref), "delete", ref); return FS.deleteDoc(ref, ...rest); }

/* ---------- query()：結果にラベルを付けて、onSnapshot/getDocs側でコレクション名が分かるようにする ---------- */
export function query(ref, ...rest){
  const q = FS.query(ref, ...rest);
  try{ q.__fsLabel = labelOf(ref) + " [query]"; }catch(e){}
  return q;
}

/* ---------- 集計・表示 ---------- */
function rows(){
  return Object.entries(stats)
    .map(([label, s])=>({ collection: label, reads: s.reads, writes: s.writes, local: s.local, snapshots: s.snapCalls }))
    .sort((x,y)=> (y.reads + y.writes) - (x.reads + x.writes));
}
function totals(){
  return rows().reduce((t,r)=>({ reads: t.reads + r.reads, writes: t.writes + r.writes }), { reads:0, writes:0 });
}
const api = {
  top(n = 20){ const r = rows().slice(0, n); console.table(r); const t = totals(); console.log(`合計（推定）：読み取り ${t.reads} / 書き込み ${t.writes}`); return r; },
  report(){
    const t = totals();
    const mins = Math.round((Date.now() - startedAt) / 60000);
    const lines = [`ページ: ${location.pathname.split("/").pop() || "index"} / 計測 ${mins}分 / 読み取り(推定) ${t.reads} / 書き込み ${t.writes}`];
    rows().slice(0, 25).forEach(r=> lines.push(`${r.collection}: 読${r.reads} 書${r.writes} local${r.local} 配信${r.snapshots}回`));
    const text = lines.join("\n"); console.log(text); return text;
  },
  reset(){ Object.keys(stats).forEach(k=> delete stats[k]); Object.keys(writeTimes).forEach(k=> delete writeTimes[k]); logPrev = {}; Object.keys(estStats).forEach(k=> delete estStats[k]); Object.keys(estFirst).forEach(k=> delete estFirst[k]); opsPrev = {}; estFirstPrev = {}; logEstPrev = {}; }, // v2.1：logPrev も初期化（負の差分行を防ぐ）
  stats
};
try{ window.__fs = api; }catch(e){}

/* ---------- 画面右下のカウンタは v3 で廃止（ログに一本化）。以前に ?fscount=1 で保存された設定だけ消しておく ---------- */
try{ localStorage.removeItem("fscount"); }catch(e){}


/* =========================================================
   操作ログ送信（2026年10月8日追加）― トライアル期間の診断用
   ・firebase-config.js の ACTIVITY_LOG_CONFIG.webAppUrl が未設定なら何もしない。
   ・失敗しても握りつぶす。アプリの動作・Firestoreの読み書きには影響しない
     （送信先は Google Apps Script であり、Firestoreは使わない）。
   ========================================================= */
const LOG_FLUSH_MS = 2 * 60 * 1000;   // 通常の送信間隔（v3: 5分→2分。送るものが無ければ送信しない）
const LOG_MAX_WRITES_PER_FLUSH = 300; // 1回の送信に載せる「書き込み1件ごとの記録」の上限（超過分は件数のみ）
const LOG_MAX_BUFFER = 1000;          // 送信できないまま溜め込む上限（超えたら古いものから捨てる）
const LOG_SID = Math.random().toString(36).slice(2, 10); // このページ読み込み単位の識別子

let logCfg = null;            // { webAppUrl, secret }（有効なときだけ入る）
let logBuf = [];              // 送信待ちイベント
let logWriteOverflow = 0;     // 上限超過で個別記録を省いた書き込み件数
let logPrev = {};             // 前回送信時点の累計（差分計算用）
let logCurTab = "";
let logEmailCache = "";
let logTimer = null;
let logEnabled = false;       // 管理画面（app_settings/activity_log.enabled）のON/OFF。ドキュメントが無いときは OFF（明示的にONにするまで記録しない）
let logSettingSubscribed = false;
let logConnSince = Date.now();   // 直近の接続・表示状態変化の時刻
let logEnvSent = false;
let logSdkOffline = null;        // SDKが「キャッシュのみ＝サーバーに繋がっていない」状態か
let logWatchLast = null;
let logSeq = 0;                  // v3: 送信の通し番号（飛んでいれば、その送信は届いていない）
let logLastCum = "";             // v3: 前回送った累計行の内容（変化が無ければ送らない）
let lastVisibleAt = Date.now(), lastHiddenAt = 0;   // v3: 再接続の切断時間の推定用
let sdkOfflineAt = 0, sdkOfflineFromHidden = 0;
let logSettingKnown = false;     // v2.1：ログON/OFFの判定が届いたか（届くまで listen 行を保留する）
let logPendingListen = [];       // v2.1：判定が届く前に来た listen 行（最大60件）
const LOG_MAX_CONN_PER_FLUSH = 60;

function logCurrentTab(){
  try{
    const b = document.querySelector(".tab-btn.active");
    return (b && (b.dataset.view || b.textContent || "").trim()) || "";
  }catch(e){ return ""; }
}
async function logResolveEmail(){
  try{
    const A = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const u = A.getAuth().currentUser;
    if(u && u.email){ logEmailCache = u.email; return u.email; }
  }catch(e){}
  return "";
}
// 呼び出し元：スタックの先頭から fs-counter.js 以外の最初の行を、「関数名@ファイル:行」に整形
function logCaller(){
  try{
    const lines = String(new Error().stack || "").split("\n").slice(1);
    for(const ln of lines){
      if(ln.indexOf("fs-counter.js") >= 0) continue;
      let m = ln.match(/at\s+(?:async\s+)?([^\s(]+)\s+\(.*?([^\/\s]+):(\d+):\d+\)/);   // Chrome: at fn (url/file.html:12:3)
      if(m) return `${m[1]}@${m[2]}:${m[3]}`.slice(0, 80);
      m = ln.match(/^\s*([^@\s]*)@.*?([^\/\s]+):(\d+):\d+/);                              // Firefox/Safari: fn@url/file.html:12:3
      if(m) return `${m[1] || "(anon)"}@${m[2]}:${m[3]}`.slice(0, 80);
      m = ln.match(/at\s+.*?([^\/\s]+):(\d+):\d+/);                                        // Chrome: at url/file.html:12:3（無名）
      if(m) return `(anon)@${m[1]}:${m[2]}`.slice(0, 80);
    }
  }catch(e){}
  return "";
}
function logPush(ev){
  logBuf.push(ev);
  if(logBuf.length > LOG_MAX_BUFFER) logBuf.splice(0, logBuf.length - LOG_MAX_BUFFER);
}
function logWrite(label, op, ref){
  if(!logCfg || !logEnabled) return;
  let nWrites = 0;
  for(const e of logBuf) if(e.type === "write") nWrites++;
  if(nWrites >= LOG_MAX_WRITES_PER_FLUSH){ logWriteOverflow++; return; }
  let path = "";
  try{ path = (ref && typeof ref.path === "string") ? ref.path : label; }catch(e){ path = label; }
  logPush({ t: Date.now(), type: "write", tab: logCurrentTab(), coll: label, path: String(path).slice(0, 120), op, caller: logCaller() });
}
function logListen(label, snap, ent, extra){
  let size, changes;
  if(typeof snap.docChanges === "function"){ size = snap.size; changes = snap.docChanges().length; }
  else { size = snap.exists() ? 1 : 0; changes = size; }
  const sec = ent ? Math.round((Date.now() - ent.start) / 1000) : 0;
  const ev = { t: Date.now(), type: "listen", tab: logCurrentTab(), coll: label, reads: size, local: changes,
    caller: `size=${size} changes=${changes} 初回全件推定${IS_COLD ? "+" : "(参考・課金少)="}${extra || 0} 購読から${sec}秒 ${ent && ent.caller ? ent.caller : ""}`.trim() };
  if(!logSettingKnown){ if(logPendingListen.length < 60) logPendingListen.push(ev); return; } // v2.1：判定待ち（設定の読み込み前でも取りこぼさない）
  if(!logCfg || !logEnabled) return;
  logPush(ev);
}
// v3.1: 購読の終了（張り直しの検出用）
let logEndCount = 0;
function logListenEnd(ent){
  if(!logCfg || !logEnabled) return;
  if(logEndCount >= 200) return;
  logEndCount++;
  const sec = Math.round((Date.now() - ent.start) / 1000);
  logPush({ t: Date.now(), type: "env", tab: logCurrentTab(), coll: "購読終了 " + ent.label,
    path: `生存${sec}秒 配信${ent.snaps}回 読${ent.srv} local${ent.loc}`, caller: ent.caller || "" });
}
function logConn(op, extra){
  if(!logCfg || !logEnabled) return;
  const now = Date.now();
  const secs = Math.round((now - logConnSince) / 1000);
  logConnSince = now;
  let n = 0; for(const e of logBuf) if(e.type === "conn") n++;
  if(n >= LOG_MAX_CONN_PER_FLUSH) return;
  logPush({ t: now, type: "conn", tab: logCurrentTab(), op, path: `${secs}秒`, caller: extra || "" });
}
function logEnvInfo(){
  const ua = (navigator && navigator.userAgent) || "";
  const os = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "other";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /(Chrome|CriOS)\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "other";
  let standalone = false;
  try{ standalone = !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone); }catch(e){}
  let sw = false;
  try{ sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller); }catch(e){}
  return { t: Date.now(), type: "env", tab: logCurrentTab(), coll: FS_COUNTER_VERSION,
    path: `${os}/${br}/${standalone ? "standalone" : "browser"}/${sw ? "SW有" : "SW無"}`,
    caller: `w${window.innerWidth}x${window.innerHeight} online=${navigator.onLine} 前回稼働から${coldKnown ? coldGapSec + "秒" : "記録なし"}${logUaBrief(ua)}` };
}
// v3.4: 端末ごとの不具合の切り分け用に、ブラウザ/OSの版を短く添える（例: " chrome=120 android=10"）
function logUaBrief(ua){
  try{
    let out = "";
    let m = ua.match(/(?:Chrome|CriOS)\/(\d+)/); if(m) out += " chrome=" + m[1];
    m = ua.match(/Edg\/(\d+)/); if(m) out += " edge=" + m[1];
    m = ua.match(/Android (\d+)/); if(m) out += " android=" + m[1];
    m = ua.match(/OS (\d+)[_\d]* like Mac/); if(m) out += " ios=" + m[1];
    return out;
  }catch(e){ return ""; }
}
// v3.4: JSエラー（画面の初期化が途中で止まる不具合の原因特定用）。1ページ表示あたり最大10件。
//       ログ種別は既存の conn のまま（受け側 activity-log.gs の変更は不要）。
//       操作列=「JSエラー」、パス列=エラー文、呼び出し元列=発生場所（関数@ファイル:行）。
let logJsErrCount = 0;
function logStackBrief(stack){
  try{
    const out = [];
    String(stack || "").split("\n").forEach(ln=>{
      if(out.length >= 3) return;
      let fn = "", file = "", line = "";
      let m = ln.match(/at\s+(?:async\s+)?(\S+)\s+\(.*?([^\/\s)]+):(\d+):\d+\)/);   // Chrome: at fn (url/file.html:12:3)
      if(m){ fn = m[1]; file = m[2]; line = m[3]; }
      else{
        m = ln.match(/at\s+.*?([^\/\s)]+):(\d+):\d+/);                                // Chrome 無名
        if(m){ fn = "(anon)"; file = m[1]; line = m[2]; }
        else{
          m = ln.match(/^\s*([^@\s]*)@.*?([^\/\s]+):(\d+):\d+/);                      // Firefox/Safari
          if(m){ fn = m[1] || "(anon)"; file = m[2]; line = m[3]; }
        }
      }
      if(file) out.push(`${fn}@${file}:${line}`);
    });
    return out.join(" < ");
  }catch(e){ return ""; }
}
function logJsError(msg, where){
  try{
    if(logJsErrCount >= 10) return;
    logJsErrCount++;
    const ev = { t: Date.now(), type: "conn", tab: logCurrentTab(), op: "JSエラー", path: String(msg || "").slice(0, 100), caller: String(where || "").slice(0, 160) };
    if(!logSettingKnown){ if(logPendingListen.length < 60) logPendingListen.push(ev); return; }
    if(!logCfg || !logEnabled) return;
    logPush(ev);
  }catch(e){}
}
try{
  window.addEventListener("error", (ev)=>{
    try{
      const st = (ev && ev.error && ev.error.stack) ? logStackBrief(ev.error.stack) : "";
      const base = (ev && ev.filename ? String(ev.filename).split("/").pop() : "") + ":" + (ev ? ev.lineno : "") + ":" + (ev ? ev.colno : "");
      logJsError(ev && ev.message, st || base);
    }catch(e){}
  });
  window.addEventListener("unhandledrejection", (ev)=>{
    try{
      const r = ev && ev.reason;
      logJsError("未処理Promise: " + (r && r.message ? r.message : String(r)), (r && r.stack) ? logStackBrief(r.stack) : "");
    }catch(e){}
  });
}catch(e){}
// v3: 30分以上の切断のあとの再接続では、購読中の結果が丸ごと再課金される（公式の料金説明）。
//     ブラウザには差分しか届かないため、購読中の件数を「推定」として加える（実測ではない）。
function estimateReconnect(gapSec){
  try{
    let total = 0;
    liveSizes.forEach(ent=>{
      if(ent.suspended) return;   // v3.5: 解除中の購読は再接続しないので加算しない
      const n = Math.max(ent.size || 0, 1);
      estStats[ent.label] = (estStats[ent.label] || 0) + n;
      total += n;
    });
    try{ if(logCfg && logEnabled) logPush({ t: Date.now(), type: "env", tab: logCurrentTab(), coll: "再接続検知", path: `切断${Math.round(gapSec)}秒 購読${liveSizes.size}件 推定${total}`, caller: "" }); }catch(e){}
    if(typeof console !== "undefined") console.info(`[FS] 切断${Math.round(gapSec/60)}分後の再接続：再課金の推定 ${total}件`);
  }catch(e){}
}
let logEstPrev = {};
function logBuildPayload(reason){
  // コレクション別の差分（前回送信からの増分）
  const now = Date.now();
  if(!logEnabled){
    // OFFの間は何も送らない。ONにした時点から数え始めるよう、基準値だけ最新にしておく。
    for(const [label, s] of Object.entries(stats)) logPrev[label] = { reads: s.reads, writes: s.writes, local: s.local, removed: s.removed };
    for(const [label, n] of Object.entries(estStats)) logEstPrev[label] = n;
    for(const [label, n] of Object.entries(estFirst)) estFirstPrev[label] = n;
    for(const [label, o] of Object.entries(ops)) opsPrev[label] = Object.assign({}, o);
    logBuf = []; logWriteOverflow = 0;
    return [];
  }
  for(const [label, s] of Object.entries(stats)){
    const prev = logPrev[label] || { reads:0, writes:0, local:0, removed:0 };
    const d = { reads: s.reads - prev.reads, writes: s.writes - prev.writes, local: s.local - prev.local, removed: s.removed - (prev.removed || 0) };
    if(d.reads || d.writes || d.local){
      logPush({ t: now, type: "count", tab: logCurTab, coll: label, reads: d.reads, writes: d.writes, local: d.local });
    }
    if(d.removed){
      logPush({ t: now, type: "removed", tab: logCurTab, coll: label, reads: d.removed });
    }
    logPrev[label] = { reads: s.reads, writes: s.writes, local: s.local, removed: s.removed };
  }
  for(const [label, n] of Object.entries(estFirst)){
    const d = n - (estFirstPrev[label] || 0);
    if(d > 0) logPush({ t: now, type: "count", tab: logCurTab, coll: "★初回全件推定 " + label, reads: d, writes: 0, local: 0 });
    estFirstPrev[label] = n;
  }
  for(const [label, o] of Object.entries(ops)){
    const pv = opsPrev[label] || {};
    const parts = [];
    for(const k of ["getDoc","getDocCache","getDocs","getDocsCache","count","listen","set","update","add","delete"]){
      const d = (o[k] || 0) - (pv[k] || 0);
      if(d) parts.push(`${k}${d}`);
    }
    opsPrev[label] = Object.assign({}, o);
    if(parts.length) logPush({ t: now, type: "env", tab: logCurTab, coll: "操作数", path: label, caller: parts.join(" ") });
  }
  logEndCount = 0;
  for(const [label, n] of Object.entries(estStats)){
    const d = n - (logEstPrev[label] || 0);
    if(d > 0) logPush({ t: now, type: "count", tab: logCurTab, coll: "★再接続推定 " + label, reads: d, writes: 0, local: 0 });
    logEstPrev[label] = n;
  }
  if(logWriteOverflow){
    logPush({ t: now, type: "write-overflow", tab: logCurTab, writes: logWriteOverflow });
    logWriteOverflow = 0;
  }
  if(!logEnvSent){ logEnvSent = true; try{ logPush(logEnvInfo()); }catch(e){} }
  // v3: セッション累計（件数行の合計と突き合わせて、取りこぼしの有無を確認するための行）
  try{
    let R = 0, W = 0, L = 0, RM = 0, E = 0;
    for(const s of Object.values(stats)){ R += s.reads; W += s.writes; L += s.local; RM += s.removed; }
    for(const n of Object.values(estStats)) E += n;
    let EF = 0; for(const n of Object.values(estFirst)) EF += n;
    const cum = `読${R} 書${W} 推定${E} 初回全件推定${EF} local${L} 除${RM} 稼働${Math.round((Date.now() - startedAt) / 1000)}秒 購読中${liveSizes.size} 配信${snapTotal}回`;
    if(cum.replace(/稼働\d+秒/, "") !== logLastCum){
      logLastCum = cum.replace(/稼働\d+秒/, "");
      logPush({ t: now, type: "env", tab: logCurTab, coll: "累計", path: cum, caller: `seq=${logSeq + 1} ${(location.pathname.split("/").pop() || "index")} ${reason || ""}`.trim() });
    }
  }catch(e){}
  const events = logBuf; logBuf = [];
  return events;
}
async function logFlush(useBeacon){
  if(!logCfg) return;
  let events = null;
  try{
    events = logBuildPayload(useBeacon ? "hide" : "timer");
    if(!events.length) return;
    logSeq++;
    const email = await logResolveEmail();
    const page = (location.pathname.split("/").pop() || "index");
    // 1回の送信は150件ずつに分ける（sendBeacon / keepalive は約64KBまで）
    const CH = 150;
    for(let i = 0; i < events.length; i += CH){
      const body = JSON.stringify({
        secret: logCfg.secret, action: "log",
        email: email || "(unknown)", page, sid: LOG_SID, seq: logSeq, events: events.slice(i, i + CH)
      });
      if(useBeacon && navigator.sendBeacon){
        const ok = navigator.sendBeacon(logCfg.webAppUrl, new Blob([body], { type: "text/plain;charset=UTF-8" }));
        if(!ok){ logBuf = events.slice(i).concat(logBuf).slice(-LOG_MAX_BUFFER); return; }
      } else {
        // text/plain＋no-cors：Apps Scriptはプリフライトに応答できないため。レスポンスは読まない。
        await fetch(logCfg.webAppUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body, keepalive: true });
      }
    }
  }catch(e){
    // v3: 送れなかった分は捨てずに、次回の送信に回す（通信エラーのときのみ。送信先が受け取ってから失敗した場合は検知できない）
    if(events && events.length) logBuf = events.concat(logBuf).slice(-LOG_MAX_BUFFER);
  }
}
function logScheduleNext(first){
  const wait = first ? (Math.random() * 7000 + 5000) : LOG_FLUSH_MS;
  logTimer = setTimeout(async ()=>{ await logFlush(false); logScheduleNext(false); }, wait);
}
(async function logInit(){
  try{
    const cfgMod = await import("./firebase-config.js");
    const c = cfgMod && cfgMod.ACTIVITY_LOG_CONFIG;
    if(!c || !c.webAppUrl || String(c.webAppUrl).startsWith("YOUR_") || !c.secret || String(c.secret).startsWith("YOUR_")) return;
    logCfg = { webAppUrl: c.webAppUrl, secret: c.secret };
  }catch(e){ return; }
  try{
    // タブ切替の記録（現在の表示タブを2秒おきに見て、変わったときだけ記録する）
    setInterval(()=>{
      if(document.visibilityState === "hidden") return;
      const t = logCurrentTab();
      if(t && t !== logCurTab){
        if(logEnabled) logPush({ t: Date.now(), type: "tab", tab: t, from: logCurTab });
        logCurTab = t;
      }
    }, 2000);
    // ページを閉じる・隠すときに、残りをまとめて送る
    document.addEventListener("visibilitychange", ()=>{
      if(document.visibilityState === "hidden") lastHiddenAt = Date.now(); else lastVisibleAt = Date.now();
      try{ logConn(document.visibilityState === "hidden" ? "hidden" : "visible"); }catch(e){}
      if(document.visibilityState === "hidden") logFlush(true);
    });
    try{
      window.addEventListener("online",  ()=>logConn("online"));
      window.addEventListener("offline", ()=>logConn("offline"));
      document.addEventListener("freeze", ()=>logConn("freeze"));
      document.addEventListener("resume", ()=>logConn("resume"));
      window.addEventListener("pageshow", (e)=>{ if(e && e.persisted) logConn("pageshow-bfcache"); });
    }catch(e){}
    window.addEventListener("pagehide", ()=>{ logFlush(true); });
    logScheduleNext(true);
    logWatchSetting();
  }catch(e){}
})();

// 管理画面のON/OFF（app_settings/activity_log）を監視する。
// セキュリティルール上、ログイン後でないと読めないため、ログイン済みになるまで3秒おきに待ってから購読する。
// ※この購読は、カウンタ（stats）には含めない（本物のFS.onSnapshotを直接呼ぶ）。コストは「ログイン1回につき読み取り1件＋設定を切り替えるたびに在席人数分」。
function logWatchSetting(){
  let busy = false;
  const tryOnce = async ()=>{
    if(logSettingSubscribed || busy) return;
    busy = true;
    const email = await logResolveEmail();
    busy = false;
    if(!email || logSettingSubscribed) return;
    try{
      logSettingSubscribed = true;
      clearInterval(waitTimer);
      FS.onSnapshot(FS.doc(FS.getFirestore(), "app_settings", "activity_log"), { includeMetadataChanges: true }, (snap)=>{
        const off = !!(snap.metadata && snap.metadata.fromCache);
        // v3: SDKが切断→復帰した時、切断が30分以上なら再課金を推定する（画面が凍結されていた場合は、隠れた時刻から数える）
        try{
          if(off && !sdkOfflineAt){ sdkOfflineAt = Date.now(); sdkOfflineFromHidden = (lastHiddenAt && Date.now() - lastVisibleAt < 20000) ? lastHiddenAt : 0; }
          if(!off && sdkOfflineAt){
            let gap = (Date.now() - (sdkOfflineFromHidden || sdkOfflineAt)) / 1000;
            if(frozenAt && Date.now() - frozenAt < 60000) gap = Math.max(gap, frozenGapSec);   // v3.2: 画面休止の時間も使う
            sdkOfflineAt = 0; sdkOfflineFromHidden = 0;
            if(gap >= 1800) estimateReconnect(gap);
          }
        }catch(e){}
        // v3: このログ監視用の購読自体の読み取りも数える（サーバー配信で、内容が変わった時だけ）
        try{
          if(!off && !(snap.metadata && snap.metadata.hasPendingWrites)){
            const en = !!(snap.exists() && snap.data().enabled === true);
            if(logWatchLast === null || en !== logWatchLast){ bucket("app_settings/activity_log (ログ監視)").reads += 1; breakerNote("r", 1); }
            logWatchLast = en;
          }
        }catch(e){}
        if(logSdkOffline !== null && off !== logSdkOffline){ logConn(off ? "sdk-offline" : "sdk-online"); }
        logSdkOffline = off;
        const was = logEnabled;
        logEnabled = !!(snap.exists() && snap.data().enabled === true);
        if(!logSettingKnown){
          logSettingKnown = true;   // v2.1：判定が届いたので、保留していた listen 行を処理する（ONなら送信キューへ）
          if(logEnabled && logCfg){ logPendingListen.forEach(ev=> logPush(ev)); }
          logPendingListen = [];
        }
        if(logEnabled && !was) logCurTab = ""; // ONにした直後に、現在のタブも1回記録する
      }, (err)=>{
        // ログアウト等で権限エラーになったら、OFFにして、次のログインを待つ
        logEnabled = false; logSettingSubscribed = false;
        waitTimer = setInterval(tryOnce, 3000);
      });
    }catch(e){ logSettingSubscribed = false; }
  };
  let waitTimer = setInterval(tryOnce, 3000);
  tryOnce();
}
