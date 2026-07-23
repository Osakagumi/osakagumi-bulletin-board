// ここに新規Firebaseプロジェクトの設定値を貼り付けてください。
// Firebaseコンソール > プロジェクトの設定 > 全般 > マイアプリ（ウェブアプリを追加）で取得できます。
export const firebaseConfig = {
  apiKey: "AIzaSyDMI0oSSg6BT4FbCKCMbOg7PVCFqkigmk",
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
