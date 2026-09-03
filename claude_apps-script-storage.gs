/**
 * お知らせ添付ファイル用：Google Apps Script Webアプリ
 *
 * このスクリプトは osakagumi.sys@gmail.com 名義で「Webアプリ」として公開する。
 * 「実行するユーザー：自分（Me）」「アクセスできるユーザー：全員」で公開すると、
 * 呼び出す側（社員のブラウザ）はGoogleへのログインなしに、
 * このスクリプト経由で osakagumi.sys@gmail.com のドライブへ
 * ファイルの保存・削除ができるようになる。
 *
 * ■ 事前準備
 * 1. https://script.google.com を osakagumi.sys@gmail.com でログインして開く
 * 2. 「新しいプロジェクト」を作成し、このファイルの中身を丸ごと貼り付ける
 * 3. 下の SECRET を、他人に推測されない長いランダムな文字列に書き換える
 *    （半角英数字20文字以上を推奨。例：パスワード生成ツールなどで作成）
 * 4. 下の FOLDER_ID を、お知らせ添付ファイル保存用に作成したGoogleドライブの
 *    フォルダID（フォルダを開いたときのURLの .../folders/ の後ろの部分）に書き換える
 * 5. 画面右上「デプロイ」→「新しいデプロイ」→ 種類の選択で「ウェブアプリ」を選択
 *    - 説明：任意（例：「お知らせ添付用」）
 *    - 実行するユーザー：自分（osakagumi.sys@gmail.com）
 *    - アクセスできるユーザー：全員
 *    →「デプロイ」をクリックし、発行された「ウェブアプリのURL」を控える
 * 6. 控えたURLと、上で決めたSECRETを、firebase-config.js の
 *    GAS_STORAGE_CONFIG.webAppUrl / GAS_STORAGE_CONFIG.secret に貼り付ける
 *
 * ■ コードを後から書き換えた場合
 * 「デプロイ」→「デプロイを管理」→ 該当のデプロイの鉛筆アイコン→
 * バージョンで「新バージョン」を選んで「デプロイ」しないと、変更が反映されない点に注意。
 *
 * ■ 空き容量表示機能を使う場合の追加設定（システム管理画面の「保存先の空き容量」用）
 * 1. Apps Scriptエディタ左側の「サービス」の「＋」をクリック
 * 2. 「Drive API」を選んで「追加」（これで DriveApp とは別の「Drive」という
 *    高度なサービスが使えるようになる。標準の DriveApp だけでは容量の情報が取得できないため）
 * 3. 追加後、上記の手順5と同様に「新しいデプロイ」（またはバージョンを上げて再デプロイ）が必要
 */

var SECRET = "ここに長いランダムな文字列を設定してください";
var FOLDER_ID = "ここにGoogleドライブの保存先フォルダIDを設定してください";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (!SECRET || body.secret !== SECRET) {
      return jsonResponse({ error: "unauthorized" });
    }

    if (body.action === "upload") {
      return handleUpload(body);
    } else if (body.action === "delete") {
      return handleDelete(body);
    } else if (body.action === "storageInfo") {
      return handleStorageInfo();
    } else {
      return jsonResponse({ error: "unknown action" });
    }
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

function handleUpload(body) {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var bytes = Utilities.base64Decode(body.base64Data);
  var blob = Utilities.newBlob(bytes, body.mimeType || "application/octet-stream", body.fileName || "file");
  var file = folder.createFile(blob);
  // リンクを知っている全員が閲覧できるようにする
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // 「uc?id=」形式に変更していたが、ファイルの種類によっては開けなくなることが
  // あったため、確実に動く標準の共有リンク形式に戻す。
  return jsonResponse({ fileId: file.getId(), webViewLink: file.getUrl() });
}

function handleDelete(body) {
  var file = DriveApp.getFileById(body.fileId);
  // ゴミ箱に移動する（Googleドライブの仕様上、30日後に自動で完全削除される）
  file.setTrashed(true);
  return jsonResponse({ success: true });
}

function handleStorageInfo() {
  // 容量情報の取得には、標準のDriveAppではなく「Drive」高度なサービスが必要
  // （ファイル冒頭のコメント「■ 空き容量表示機能を使う場合の追加設定」を参照）
  var about = Drive.About.get({ fields: "storageQuota" });
  var quota = (about && about.storageQuota) || {};
  return jsonResponse({
    limit: quota.limit ? Number(quota.limit) : null, // Google Workspaceの無制限プラン等ではlimitが無い場合がある
    usage: quota.usage ? Number(quota.usage) : 0,
    usageInDrive: quota.usageInDrive ? Number(quota.usageInDrive) : 0
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
