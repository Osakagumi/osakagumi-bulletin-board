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
export const CATEGORIES = [
  { id: "survey",  label: "測量機器",     color: "#E8853F" },
  { id: "room",    label: "会議室",       color: "#2E9E8F" },
  { id: "vehicle", label: "業務共用車輌", color: "#4B5FA3" }
];

// 行き先ボードの「所属」「状態」は、管理画面（admin.html）から自由に追加・編集できます。
// 初回セットアップ時は admin.html の「行き先管理」タブから登録してください。

// 安否確認の回答ステータス定義
export const SAFETY_STATUSES = [
  { id: "safe",     label: "無事です",         color: "#2E9E8F" },
  { id: "damage",   label: "被害があります",   color: "#C0392B" },
  { id: "unknown",  label: "わからない・確認中", color: "#E8853F" }
];

// 安否確認メール通知（EmailJS）の設定
export const EMAILJS_CONFIG = {
  publicKey: "29JtZyFekWscWEfBU",
  serviceId: "service_10htgiq",
  templateId: "template_7pjv16s"
};

