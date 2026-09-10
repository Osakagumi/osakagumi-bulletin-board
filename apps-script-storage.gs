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
 *
 * ■ 2026年9月：共有権限の方針について（重要・変更履歴あり）
 * 【現在の方針】保存先フォルダ（FOLDER_ID）自体を、Googleドライブ側で手動で
 * 「リンクを知っている全員：編集者」に設定してある。このフォルダ内で新規作成される
 * ファイルは全て、その設定をそのまま引き継ぐため、業務情報・お知らせ添付・チャット画像の
 * 区別なく、全てのアップロードファイルが「リンクを知っている全員が編集可」になる。
 *
 * 【なぜこうなっているか】もともとは、業務情報の「ファイル修正」機能のためだけに
 * フォルダを編集者にし、それ以外（お知らせ添付・チャット画像）は本関数内で明示的に
 * setSharing(閲覧のみ)を呼んで「編集者→閲覧のみ」に格下げしていた。しかし、
 * Google側が「プログラムからの編集可への格上げ」だけでなく「編集可からの格下げ」も
 * ブロックすること（Exception: Access denied: DriveApp.）が判明し、お知らせ添付・
 * チャット画像のアップロードが軒並み失敗する重大な不具合を引き起こした。
 * このため、格下げ処理自体をやめ、全てのファイルを編集可のまま統一する方針に変更した
 * （2026年9月）。
 *
 * 【リスクの説明・ひねさんへの確認済み事項】この変更により、お知らせ添付・チャット画像も
 * 含めて、リンク（fileId）を知っている人なら誰でも中身を書き換えられる状態になる。
 * 社内ツールとしての「性善説」の設計方針（設備管理・業務情報等でも採用）に照らして
 * 許容する、という判断のもとで実施している。
 *
 * 【元に戻したい場合】下記 handleUpload 関数内の permission の行を、
 * コメントアウトしている「元のコード」に戻せば、以前の「editableがtrueのときだけ
 * 編集可、それ以外は閲覧のみ」という格下げありの動作に戻る。ただしその場合、
 * お知らせ添付・チャット画像アップロードが失敗する問題が再発するため、フォルダ自体の
 * 共有設定を「閲覧者」に戻すか、業務情報専用の別フォルダに分離する対応が別途必要になる
 * （このコメント作成時点でClaudeと相談済みの内容）。
 */

var SECRET = "pIJHkljhwfeohdskksdglkj9887sgdlksssss";
var FOLDER_ID = "17CbbKVmhGDCohqg88VRmFcSEvDoq68Ju";

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

  // 2026年9月〜：格下げ処理をやめ、全てのファイルを「リンクを知っている全員が編集可」に統一。
  // 保存先フォルダ（FOLDER_ID）自体が手動で「編集者」に設定されているため、
  // 明示的にsetSharingを呼ばなくてもフォルダの設定を引き継いで編集可になるが、
  // 意図を明確にするため、ここでも明示的にEDITを指定している。
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

  // ▼元のコード（editableがtrueのときだけ編集可、それ以外は閲覧のみに格下げ）。
  //   元に戻す場合は上のsetSharing行を消し、下の2行のコメントを外す。
  //   ただしその場合、フォルダ側の共有設定も「閲覧者」に戻すか、業務情報専用の
  //   別フォルダに分離する対応が別途必要（ファイル冒頭のコメント参照）。
  // var permission = body.editable ? DriveApp.Permission.EDIT : DriveApp.Permission.VIEW;
  // file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, permission);

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
