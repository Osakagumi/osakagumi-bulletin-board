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
// "*" の場合は今まで通り、社員名簿に登録されている全員（お知らせの場合は発信先に連動）に送信します。
// "#" の場合は、今まさに送信操作をしている本人（投稿者）にのみ送信します（テスト用）。
// それ以外の場合は、ここに書いたメールアドレスにのみ送信します（複数指定はセミコロン区切り）。
// 例）テスト時: "h.ishikawa@osakagumi.co.jp"
// 例）複数人でテスト: "h.ishikawa@osakagumi.co.jp;n.kasai@osakagumi.co.jp"
// 本番で全社員に送る場合は必ず "*" に戻してください。
export const MAIL_SEND_TARGET = "#";

// お知らせ添付ファイル用：Google Apps Script（Webアプリ）連携の設定。
// apps-script-storage.gs の手順に沿ってWebアプリを公開し、発行されたURLと、
// 自分で決めたSECRETをここに設定する。
export const GAS_STORAGE_CONFIG = {
  webAppUrl: "https://script.google.com/macros/s/AKfycbxN_VDxzHRkVYOPx-06v1aYPRV4uAPfLYBdSyhh9Vop9p57mIxoSRqQ6Uu5VDzJ6iMa5w/exec",   // 例）https://script.google.com/macros/s/xxxxx/exec
  secret: "pIJHkljhwfeohdskksdglkj9887sgdlksssss"                  // apps-script-storage.gs の SECRET と同じ値にする
};

// MAIL_SEND_TARGET の設定内容に応じて、実際の送信先リストを返すヘルパー関数。
// admin.html・index.html の両方から共通で呼び出します。
// posterEmail：MAIL_SEND_TARGETが"#"（投稿者本人にのみ送信・テスト用）の場合に使う、
// 今まさに送信操作をしている本人のメールアドレス。
export function resolveMailRecipients(employeesAll, posterEmail){
  const override = (MAIL_SEND_TARGET || "").trim();
  if(override === "" || override === "*"){
    return (employeesAll || [])
      .filter(e => !!e.email)
      .map(e => ({ email: e.email, name: e.name || e.email }));
  }
  if(override === "#"){
    if(!posterEmail) return [];
    const match = (employeesAll || []).find(e=>e.email===posterEmail);
    return [{ email: posterEmail, name: (match && match.name) || posterEmail }];
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

