// お知らせ添付ファイル用：Cloud Storage for Firebase 連携の共通処理
// index.html・admin.html の両方から読み込んで使う
//
// Googleドライブ連携（gdrive-helper.js）と違い、こちらはこのシステム自体の
// Firebaseログイン（Firebase Auth）をそのまま使うため、添付・削除のたびに
// 別サービスへ改めてログインする必要がない。共有アカウントの管理も不要。
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let storageInstance = null;

export function initStorageHelper(app){
  storageInstance = getStorage(app);
  return storageInstance;
}

export function isStorageReady(){
  return !!storageInstance;
}

// ファイル名の衝突・扱いにくい文字を避けるため、保存パスは
// notice-attachments/{タイムスタンプ}_{元のファイル名} という形にする
function buildStoragePath(file){
  const safeName = file.name.replace(/[^\w.\-ぁ-んァ-ヶ一-龠々ー]/g, "_");
  return `notice-attachments/${Date.now()}_${safeName}`;
}

// ファイルをCloud Storageへアップロードし、{path, webViewLink} を返す
export async function uploadFileToStorage(file, onStatus){
  if(!storageInstance){
    throw new Error("Cloud Storageが初期化されていません。");
  }
  onStatus && onStatus(`アップロード中… (${file.name})`);
  const path = buildStoragePath(file);
  const fileRef = ref(storageInstance, path);
  await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
  const webViewLink = await getDownloadURL(fileRef);
  return { path, webViewLink };
}

// Cloud Storage上のファイルを削除する
export async function deleteFileFromStorage(path){
  if(!path || !storageInstance) return;
  try{
    const fileRef = ref(storageInstance, path);
    await deleteObject(fileRef);
  }catch(e){
    // 既に削除済み（object-not-found）などは無視してよい
    if(e && e.code !== "storage/object-not-found") throw e;
  }
}
