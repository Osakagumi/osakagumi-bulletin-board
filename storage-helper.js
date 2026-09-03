// お知らせ添付ファイル用：Google Apps Script（Webアプリ）経由でのGoogleドライブ連携
// index.html・admin.html の両方から読み込んで使う
//
// osakagumi.sys@gmail.com 名義で動作するApps ScriptのWebアプリを、
// ただのHTTP通信として呼び出すだけなので、Googleへのログインは一切発生しない。
// 実際のファイルの持ち主は引き続きosakagumi.sys@gmail.comのドライブ。
import { GAS_STORAGE_CONFIG } from "./firebase-config.js";

export function isStorageConfigured(){
  return !!(GAS_STORAGE_CONFIG.webAppUrl && !GAS_STORAGE_CONFIG.webAppUrl.startsWith("YOUR_") &&
            GAS_STORAGE_CONFIG.secret && !GAS_STORAGE_CONFIG.secret.startsWith("YOUR_"));
}

// この関数はFirebase Storage版との呼び出し互換のために残しているだけで、何もしない
export function initStorageHelper(){ /* no-op */ }

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result.split(",")[1]);
    reader.onerror = ()=> reject(new Error("ファイルの読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

// Apps ScriptのWebアプリを呼び出す。
// Content-Type を text/plain にしているのは、application/json だとブラウザが
// CORSのプリフライト（OPTIONS）リクエストを先に送ろうとし、Apps Script側が
// それにうまく応答できずエラーになることがあるための回避策。
async function callGasEndpoint(payload){
  const res = await fetch(GAS_STORAGE_CONFIG.webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  if(!res.ok){
    throw new Error(`通信に失敗しました（${res.status}）。`);
  }
  const json = await res.json();
  if(json.error){
    throw new Error(`処理に失敗しました：${json.error}`);
  }
  return json;
}

// ファイルをアップロードし、{path, webViewLink} を返す
// path には（削除時に使う）GoogleドライブのファイルIDを入れている
export async function uploadFileToStorage(file, onStatus){
  if(!isStorageConfigured()){
    throw new Error("添付ファイル機能が未設定です（firebase-config.jsのGAS_STORAGE_CONFIGを設定してください）。");
  }
  onStatus && onStatus(`アップロード中… (${file.name})`);
  const base64Data = await fileToBase64(file);
  const json = await callGasEndpoint({
    action: "upload",
    secret: GAS_STORAGE_CONFIG.secret,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    base64Data
  });
  return { path: json.fileId, webViewLink: json.webViewLink };
}

// ファイルを削除する（Googleドライブのゴミ箱に移動。30日後に自動で完全削除される）
export async function deleteFileFromStorage(path){
  if(!path || !isStorageConfigured()) return;
  try{
    await callGasEndpoint({
      action: "delete",
      secret: GAS_STORAGE_CONFIG.secret,
      fileId: path
    });
  }catch(e){
    // 削除に失敗しても、お知らせ自体の削除は続行してよいので握りつぶす
    console.error("[添付ファイル削除エラー]", e);
  }
}

// 保存先（osakagumi.sys@gmail.comのGoogleドライブ）の空き容量情報を取得する。
// { limit, usage, usageInDrive } を返す（limitは無制限プラン等でnullになることがある）。
// GAS側で「Drive」高度なサービスの追加が必要（claude_apps-script-storage.gsのコメント参照）。
export async function fetchStorageInfo(){
  if(!isStorageConfigured()){
    throw new Error("添付ファイル機能が未設定です（firebase-config.jsのGAS_STORAGE_CONFIGを設定してください）。");
  }
  return await callGasEndpoint({
    action: "storageInfo",
    secret: GAS_STORAGE_CONFIG.secret
  });
}
