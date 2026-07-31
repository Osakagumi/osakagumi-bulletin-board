// お知らせ添付ファイル用：Googleドライブ連携の共通処理
// index.html・admin.html の両方から読み込んで使う
import { GOOGLE_DRIVE_CONFIG } from "./firebase-config.js";

export function isGoogleDriveConfigured(){
  return !!(GOOGLE_DRIVE_CONFIG.clientId && !GOOGLE_DRIVE_CONFIG.clientId.startsWith("YOUR_") &&
            GOOGLE_DRIVE_CONFIG.folderId && !GOOGLE_DRIVE_CONFIG.folderId.startsWith("YOUR_"));
}

let gisTokenClient = null;
function ensureGisTokenClient(){
  if(gisTokenClient) return gisTokenClient;
  if(!window.google || !google.accounts || !google.accounts.oauth2){
    return null;
  }
  gisTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_DRIVE_CONFIG.clientId,
    scope: "https://www.googleapis.com/auth/drive.file",
    callback: ()=>{}
  });
  return gisTokenClient;
}

export function requestGoogleAccessToken(){
  return new Promise((resolve, reject)=>{
    const client = ensureGisTokenClient();
    if(!client){
      reject(new Error("Googleログイン機能の読み込みに失敗しました。時間をおいて再度お試しください。"));
      return;
    }
    client.callback = (resp)=>{
      if(resp && resp.access_token){ resolve(resp.access_token); }
      else{ reject(new Error("Googleへのログインに失敗しました。")); }
    };
    client.error_callback = ()=>{ reject(new Error("Googleへのログインがキャンセルされました。")); };
    client.requestAccessToken({ prompt: "" });
  });
}

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result.split(",")[1]);
    reader.onerror = ()=> reject(new Error("ファイルの読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

// ファイルをGoogleドライブへアップロードし、{fileId, webViewLink} を返す
export async function uploadFileToDrive(file, onStatus){
  if(!isGoogleDriveConfigured()){
    throw new Error("Googleドライブ連携が未設定です（firebase-config.jsのGOOGLE_DRIVE_CONFIGを設定してください）。");
  }
  onStatus && onStatus("Googleアカウントへのログインを確認しています…");
  const token = await requestGoogleAccessToken();

  onStatus && onStatus(`アップロード中… (${file.name})`);
  const base64Data = await fileToBase64(file);
  const metadata = { name: file.name, parents: [GOOGLE_DRIVE_CONFIG.folderId] };
  const boundary = "osakagumi_boundary_" + Date.now();
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const multipartBody =
    delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
    delimiter + `Content-Type: ${file.type || "application/octet-stream"}\r\nContent-Transfer-Encoding: base64\r\n\r\n` + base64Data +
    closeDelim;

  const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary="${boundary}"`
    },
    body: multipartBody
  });
  if(!uploadRes.ok){
    let reason = "";
    try{ reason = ((await uploadRes.json()).error?.errors?.[0]?.reason) || ""; }catch(e){ /* 無視 */ }
    if(reason === "storageQuotaExceeded"){
      throw new Error("Googleドライブの空き容量が不足しているため、アップロードに失敗しました。不要なファイルを削除するなどしてから、もう一度お試しください。");
    }
    throw new Error("アップロードに失敗しました（" + uploadRes.status + (reason ? "："+reason : "") + "）。");
  }
  const uploadJson = await uploadRes.json();
  const fileId = uploadJson.id;

  onStatus && onStatus("共有リンクを設定しています…");
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" })
  });

  const linkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const linkJson = await linkRes.json();

  return { fileId, webViewLink: linkJson.webViewLink || "" };
}

// Googleドライブ上のファイルを完全に削除する（ゴミ箱を経由しない）
export async function deleteDriveFile(fileId){
  if(!fileId || !isGoogleDriveConfigured()) return;
  const token = await requestGoogleAccessToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  });
}

// Googleドライブの空き容量を取得する（bytes単位）
export async function getDriveStorageQuota(){
  const token = await requestGoogleAccessToken();
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=storageQuota", {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if(!res.ok) throw new Error("容量情報の取得に失敗しました。");
  const json = await res.json();
  return json.storageQuota || {};
}

export function formatBytes(bytes){
  const n = Number(bytes);
  if(!n && n!==0) return "不明";
  if(n < 1024) return `${n}B`;
  const units = ["KB","MB","GB","TB"];
  let val = n / 1024, i = 0;
  while(val >= 1024 && i < units.length-1){ val /= 1024; i++; }
  return `${val.toFixed(1)}${units[i]}`;
}
