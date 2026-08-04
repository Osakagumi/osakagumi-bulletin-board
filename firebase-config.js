// ここに新規Firebaseプロジェクトの設定値を貼り付けてください。
// Firebaseコンソール > プロジェクトの設定 > 全般 > マイアプリ（ウェブアプリを追加）で取得できます。
export const firebaseConfig = {
  apiKey: "AIzaSyDMI0o5Sg6BT4fbCKCMbOg7PVCFqkigsmk",
  authDomain: "osakagumi-bulletin-board.firebaseapp.com",
  projectId: "osakagumi-bulletin-board",
  storageBucket: "osakagumi-bulletin-board.firebasestorage.app",
  messagingSenderId: "416929871112",
  appId: "1:416929871112:web:8a322a28a0323ccab168bd",
};

// 予約可能時間帯・時間単位の設定（必要に応じて変更してください）
export const BUSINESS_HOURS = {
  startHour: 6,   // 6:00から
  endHour: 20,    // 20:00まで
  slotMinutes: 30 // 30分単位
};

// 設備カテゴリの定義
// mode: "timeline" = 時間枠を予約する形式（会議室・車輌など）
//       "checkout" = 貸出管理（在庫中・貸出中・点検中・故障中）形式（測量機器・ドローンなど）
export const CATEGORIES = [
  { id: "room",    label: "会議室",       color: "#2E9E8F", mode: "timeline" },
  { id: "vehicle", label: "業務共用車輌", color: "#4B5FA3", mode: "timeline" },
  { id: "survey",  label: "測量機器",     color: "#E8853F", mode: "checkout" },
  { id: "drone",   label: "ドローン",     color: "#6B5B95", mode: "checkout" }
];

// 貸出管理（checkoutモード）の状態定義
export const EQUIPMENT_STATUSES = [
  { id: "in_stock",    label: "在庫中", color: "#2E9E8F" },
  { id: "checked_out", label: "貸出中", color: "#4B5FA3" },
  { id: "inspecting",  label: "点検中", color: "#8A5FBF" },
  { id: "broken",      label: "故障中", color: "#C0392B" }
];

// 行き先ボードの「所属」「状態」は、管理画面（admin.html）から自由に追加・編集できます。
// 初回セットアップ時は admin.html の「行き先管理」タブから登録してください。

// 安否確認の回答ステータス定義
export const SAFETY_STATUSES = [
  { id: "safe",     label: "無事です",         color: "#2E9E8F" },
  { id: "damage",   label: "被害があります",   color: "#C0392B" },
  { id: "unknown",  label: "わからない・確認中", color: "#E8853F" }
];

// 安否確認・お知らせメール通知（EmailJS）の設定
// https://www.emailjs.com/ で無料アカウントを作成し、以下の値を貼り付けてください。
// 未設定（YOUR_で始まる値のまま）の場合は、メール送信をスキップしてシステム内表示のみになります。
// EmailJSの無料プランはテンプレートを2つまで作成できるので、安否確認用・お知らせ用を分けて登録してください。
export const EMAILJS_CONFIG = {
  publicKey: "29JtZyFekWscWEfBU",
  serviceId: "service_10htgiq",
  safetyTemplateId: "template_7pjv16s",
  noticeTemplateId: "template_41c80qr"
};

// メール送信先の上書き設定（テスト・誤送信防止用）
// "*" の場合は今まで通り、社員名簿に登録されている全員に送信します。
// "*" 以外の場合は、ここに書いたメールアドレスにのみ送信します（複数指定はセミコロン区切り）。
// 例）テスト時: "h.ishikawa@osakagumi.co.jp"
// 例）複数人でテスト: "h.ishikawa@osakagumi.co.jp;n.kasai@osakagumi.co.jp"
// 本番で全社員に送る場合は必ず "*" に戻してください。
export const MAIL_SEND_TARGET = "h.ishikawa@osakagumi.co.jp";

// お知らせ添付ファイル用：Googleドライブ連携の設定
// 1. https://console.cloud.google.com で新しいプロジェクトを作成（osakagumi.sys@gmail.comでログインして作成すると管理が楽です）
// 2. 「APIとサービス」→「ライブラリ」→「Google Drive API」を有効化
// 3. 「APIとサービス」→「OAuth同意画面」を設定（User Type: External、アプリ名・メールアドレスなどを入力。
//    drive.fileという権限のみ使うため、Googleの厳しい審査は基本的に不要です）
// 4. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」→アプリケーションの種類「ウェブアプリケーション」
//    「承認済みのJavaScript生成元」に、このサイトのURL（例：https://osakagumi.github.io）を追加して作成
// 5. 発行された「クライアントID」を下のGOOGLE_OAUTH_CLIENT_IDに貼り付け
// 6. osakagumi.sys@gmail.comのGoogleドライブに「お知らせ添付」などのフォルダを作成し、
//    フォルダを開いたときのURL（.../folders/フォルダID）からフォルダIDを取得して、下のGDRIVE_UPLOAD_FOLDER_IDに貼り付け
export const GOOGLE_DRIVE_CONFIG = {
  clientId: "416929871112-ts7g3b38idqt4dmc7nsso7ankk1qfa84.apps.googleusercontent.com",
  folderId: "17CbbKVmhGDCohqg88VRmFcSEvDoq68Ju"          // 例）1a2B3c4D5e6F7g8H9iJ0kLmNoPQRstuv
};

// MAIL_SEND_TARGET の設定内容に応じて、実際の送信先リストを返すヘルパー関数。
// admin.html・index.html の両方から共通で呼び出します。
export function resolveMailRecipients(employeesAll){
  const override = (MAIL_SEND_TARGET || "").trim();
  if(override === "" || override === "*"){
    return (employeesAll || [])
      .filter(e => !!e.email)
      .map(e => ({ email: e.email, name: e.name || e.email }));
  }
  const overrideEmails = override.split(";").map(s=>s.trim()).filter(Boolean);
  return overrideEmails.map(email=>{
    const match = (employeesAll || []).find(e=>e.email===email);
    return { email, name: (match && match.name) || email };
  });
}

// MAIL_SEND_TARGET が「全員向け」ではなく、テスト用に上書きされているかどうか
export function isMailOverrideActive(){
  const override = (MAIL_SEND_TARGET || "").trim();
  return override !== "" && override !== "*";
}

