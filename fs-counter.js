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
   ・画面右下にカウンタを出す：URLの末尾に ?fscount=1 を付けて開く
     （一度付ければ、そのブラウザでは以降も表示。消す時は ?fscount=0）
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
   ========================================================= */
import * as FS from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const stats = {};            // label -> { reads, writes, local, snapCalls }
const writeTimes = {};       // label -> [timestamps]
const lastWarnAt = {};       // label -> timestamp
const startedAt = Date.now();

function bucket(label){
  return stats[label] || (stats[label] = { reads:0, writes:0, local:0, snapCalls:0 });
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
function addRead(label, n){ try{ bucket(label).reads += n; }catch(e){} }
function addLocal(label, n){ try{ bucket(label).local += n; }catch(e){} }
function addWrite(label, op, ref){
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
  try{ logWrite(label, op, ref); }catch(e){}
}

/* ---------- 読み取り系 ---------- */
export async function getDoc(ref, ...rest){
  const snap = await FS.getDoc(ref, ...rest);
  try{
    if(snap.metadata && snap.metadata.fromCache) addLocal(labelOf(ref), 1);
    else addRead(labelOf(ref), 1);
  }catch(e){}
  return snap;
}
export async function getDocs(q, ...rest){
  const snap = await FS.getDocs(q, ...rest);
  try{
    const label = labelOf(q);
    if(snap.metadata && snap.metadata.fromCache) addLocal(label, snap.size);
    else addRead(label, Math.max(snap.size, 1)); // 0件のクエリでも最低1件分の課金がある
  }catch(e){}
  return snap;
}
function countSnapshot(label, snap){
  try{
    const b = bucket(label);
    b.snapCalls += 1;
    if(typeof snap.docChanges === "function"){
      // クエリ／コレクションのスナップショット
      const fromCache = !!(snap.metadata && snap.metadata.fromCache);
      snap.docChanges().forEach(ch=>{
        const pending = !!(ch.doc && ch.doc.metadata && ch.doc.metadata.hasPendingWrites);
        if(fromCache || pending) b.local += 1; else b.reads += 1;
      });
      if(snap.empty && !fromCache && snap.docChanges().length === 0 && b.snapCalls === 1) b.reads += 1;
    } else {
      // ドキュメントのスナップショット
      const fromCache = !!(snap.metadata && snap.metadata.fromCache);
      const pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
      if(fromCache || pending) b.local += 1; else b.reads += 1;
    }
  }catch(e){}
}
export function onSnapshot(ref, ...args){
  const label = labelOf(ref);
  const a = args.slice();
  try{
    if(typeof a[0] === "function"){
      const orig = a[0]; a[0] = (snap, ...r)=>{ countSnapshot(label, snap); return orig(snap, ...r); };
    } else if(a[0] && typeof a[0].next === "function"){
      const obs = a[0]; const origNext = obs.next.bind(obs);
      a[0] = Object.assign({}, obs, { next: (snap, ...r)=>{ countSnapshot(label, snap); return origNext(snap, ...r); } });
    } else if(typeof a[1] === "function"){
      // onSnapshot(ref, options, onNext, onError)
      const orig = a[1]; a[1] = (snap, ...r)=>{ countSnapshot(label, snap); return orig(snap, ...r); };
    } else if(a[1] && typeof a[1].next === "function"){
      const obs = a[1]; const origNext = obs.next.bind(obs);
      a[1] = Object.assign({}, obs, { next: (snap, ...r)=>{ countSnapshot(label, snap); return origNext(snap, ...r); } });
    }
  }catch(e){ /* ラップに失敗したら、元の引数のまま本物を呼ぶ */ return FS.onSnapshot(ref, ...args); }
  return FS.onSnapshot(ref, ...a);
}

/* ---------- 書き込み系 ---------- */
export async function setDoc(ref, ...rest){ addWrite(labelOf(ref), "set", ref); return FS.setDoc(ref, ...rest); }
export async function updateDoc(ref, ...rest){ addWrite(labelOf(ref), "update", ref); return FS.updateDoc(ref, ...rest); }
export async function addDoc(ref, ...rest){ addWrite(labelOf(ref), "add", ref); return FS.addDoc(ref, ...rest); }
export async function deleteDoc(ref, ...rest){ addWrite(labelOf(ref), "delete", ref); return FS.deleteDoc(ref, ...rest); }

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
  reset(){ Object.keys(stats).forEach(k=> delete stats[k]); Object.keys(writeTimes).forEach(k=> delete writeTimes[k]); },
  stats
};
try{ window.__fs = api; }catch(e){}

/* ---------- 画面右下の小さなカウンタ（?fscount=1 のときだけ表示） ---------- */
try{
  const qp = new URLSearchParams(location.search).get("fscount");
  if(qp === "1") localStorage.setItem("fscount", "1");
  if(qp === "0") localStorage.removeItem("fscount");
  if(localStorage.getItem("fscount") === "1"){
    const mount = ()=>{
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:2147483647;background:rgba(0,0,0,.78);color:#fff;font:11px/1.35 monospace;padding:6px 8px;border-radius:6px;pointer-events:none;max-width:320px;white-space:pre";
      document.body.appendChild(el);
      setInterval(()=>{
        const t = totals();
        el.textContent = `FS 読${t.reads} 書${t.writes}\n` + rows().slice(0,5).map(r=>`${r.collection.slice(0,24)} 読${r.reads} 書${r.writes}`).join("\n");
      }, 2000);
    };
    if(document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  }
}catch(e){}


/* =========================================================
   操作ログ送信（2026年10月8日追加）― トライアル期間の診断用
   ・firebase-config.js の ACTIVITY_LOG_CONFIG.webAppUrl が未設定なら何もしない。
   ・失敗しても握りつぶす。アプリの動作・Firestoreの読み書きには影響しない
     （送信先は Google Apps Script であり、Firestoreは使わない）。
   ========================================================= */
const LOG_FLUSH_MS = 5 * 60 * 1000;   // 通常の送信間隔（初回のみ0〜60秒のばらつきを足す）
const LOG_MAX_WRITES_PER_FLUSH = 100; // 1回の送信に載せる「書き込み1件ごとの記録」の上限（超過分は件数のみ）
const LOG_MAX_BUFFER = 300;           // 送信できないまま溜め込む上限（超えたら古いものから捨てる）
const LOG_SID = Math.random().toString(36).slice(2, 10); // このページ読み込み単位の識別子

let logCfg = null;            // { webAppUrl, secret }（有効なときだけ入る）
let logBuf = [];              // 送信待ちイベント
let logWriteOverflow = 0;     // 上限超過で個別記録を省いた書き込み件数
let logPrev = {};             // 前回送信時点の累計（差分計算用）
let logCurTab = "";
let logEmailCache = "";
let logTimer = null;

function logCurrentTab(){
  try{
    const b = document.querySelector(".tab-btn.active");
    return (b && (b.dataset.view || b.textContent || "").trim()) || "";
  }catch(e){ return ""; }
}
async function logResolveEmail(){
  if(logEmailCache) return logEmailCache;
  try{
    const A = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const u = A.getAuth().currentUser;
    if(u && u.email) logEmailCache = u.email;
  }catch(e){}
  return logEmailCache;
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
  if(!logCfg) return;
  let nWrites = 0;
  for(const e of logBuf) if(e.type === "write") nWrites++;
  if(nWrites >= LOG_MAX_WRITES_PER_FLUSH){ logWriteOverflow++; return; }
  let path = "";
  try{ path = (ref && typeof ref.path === "string") ? ref.path : label; }catch(e){ path = label; }
  logPush({ t: Date.now(), type: "write", tab: logCurrentTab(), coll: label, path: String(path).slice(0, 120), op, caller: logCaller() });
}
function logBuildPayload(){
  // コレクション別の差分（前回送信からの増分）
  const now = Date.now();
  for(const [label, s] of Object.entries(stats)){
    const prev = logPrev[label] || { reads:0, writes:0, local:0 };
    const d = { reads: s.reads - prev.reads, writes: s.writes - prev.writes, local: s.local - prev.local };
    if(d.reads || d.writes || d.local){
      logPush({ t: now, type: "count", tab: logCurTab, coll: label, reads: d.reads, writes: d.writes, local: d.local });
    }
    logPrev[label] = { reads: s.reads, writes: s.writes, local: s.local };
  }
  if(logWriteOverflow){
    logPush({ t: now, type: "write-overflow", tab: logCurTab, writes: logWriteOverflow });
    logWriteOverflow = 0;
  }
  const events = logBuf; logBuf = [];
  return events;
}
async function logFlush(useBeacon){
  if(!logCfg) return;
  try{
    const events = logBuildPayload();
    if(!events.length) return;
    const email = await logResolveEmail();
    const body = JSON.stringify({
      secret: logCfg.secret, action: "log",
      email: email || "(unknown)",
      page: (location.pathname.split("/").pop() || "index"),
      sid: LOG_SID, events
    });
    if(useBeacon && navigator.sendBeacon){
      const ok = navigator.sendBeacon(logCfg.webAppUrl, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      if(!ok){ logBuf = events.concat(logBuf).slice(-LOG_MAX_BUFFER); }
      return;
    }
    // text/plain＋no-cors：Apps Scriptはプリフライトに応答できないため。レスポンスは読まない。
    await fetch(logCfg.webAppUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body, keepalive: true });
  }catch(e){
    // 失敗しても何もしない（次回の送信で、溜まった分は再送されない＝取りこぼしを許容）
  }
}
function logScheduleNext(first){
  const wait = first ? (Math.random() * 60000 + 30000) : LOG_FLUSH_MS;
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
        logPush({ t: Date.now(), type: "tab", tab: t, from: logCurTab });
        logCurTab = t;
      }
    }, 2000);
    // ページを閉じる・隠すときに、残りをまとめて送る
    document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "hidden") logFlush(true); });
    window.addEventListener("pagehide", ()=>{ logFlush(true); });
    logScheduleNext(true);
  }catch(e){}
})();
