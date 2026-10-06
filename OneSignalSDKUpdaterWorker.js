/**
 * 大坂組社内ポータル：OneSignal用Service Workerのラッパーファイル
 *
 * 2026年9月：通知をタップするたびにPWA（インストール済みアプリ）のウィンドウが
 * 新規に増え続けてしまう問題への対策として、OneSignal標準の「通知クリック時の
 * 挙動」を横取りし、自前の挙動（既に開いている画面があればそれを前面に出すだけ、
 * 無ければ1つだけ新規に開く）に置き換えている。
 *
 * 仕組み：
 * 　OneSignalの標準スクリプト（下のimportScripts）は、読み込まれた時点で自分の
 * 　notificationclickハンドラを登録する。addEventListenerは複数回呼んでも
 * 　全て登録され、呼ばれた順番に実行されるため、このファイルの先頭で「自前の
 * 　ハンドラ」を先に登録し、その中でevent.stopImmediatePropagation()を呼ぶことで、
 * 　後から登録されるOneSignal標準のハンドラ（＝無条件で新規ウィンドウを開く動作）を
 * 　止めている。OneSignalダッシュボード側の設定（連携タイプ等）は一切変更していない。
 *
 * 2026年9月（追加）：どの相手からの通知かを、既に開いている画面にも伝えられるように、
 * 通知送信元（onesignal-notify-worker.js）がOneSignalのdataフィールドに
 * senderEmailを乗せて送ってくる。既に開いている画面が見つかった場合は、
 * それをfocus()するだけでなく、postMessage()でsenderEmailを送り届け、
 * index.html側でその相手とのチャット画面に自動で切り替えてもらう。
 * 新規にウィンドウを開く場合は、senderEmailが分かればそのまま
 * ?chat=<相手のメールアドレス> 付きのURLを開く（index.html既存の
 * openChatFromUrlIfNeeded()の仕組みで、ページ読み込み後に自動でそのチャットが開く）。
 *
 * 2026年10月（追加）：お知らせ新着通知にも対応した。通知のdataに type:"notice" が入っている
 * 場合は、チャットではなくお知らせタブを開く。既に画面が開いていれば前面に出して
 * postMessage({type:"OSAKAGUMI_OPEN_NOTICES"})で伝え（index.html側が受け取ってお知らせタブへ切り替える）、
 * 開いていなければ ?tab=notices 付きのURLを新規に開く。チャット通知の動作は変えていない。
 *
 * 補足：Service Workerは、既に画面を制御している古いバージョンが残っている間は
 * 新しいバージョンに自動で切り替わらない（アプリを閉じて再度開き直すまで待機状態の
 * まま、という仕様）。skipWaiting()とclients.claim()で、更新をダウンロードでき次第
 * すぐ切り替わるようにしている（今後、このファイルをまた更新する時のため）。
 */

const PORTAL_APP_PATH = "/osakagumi-bulletin-board/";
const PORTAL_APP_URL = "https://osakagumi.github.io/osakagumi-bulletin-board/";

self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(clients.claim());
});

// OneSignalのAPIで送った data フィールド（{ senderEmail: "..." }）は、SDKのバージョンや
// 状況によって event.notification.data に入る場所が微妙に異なることがあるため、
// 考えられる置き場所をいくつか順番に確認する（見つからなければ null のまま＝従来通りの動作）。
function extractSenderEmail(notification) {
  const data = notification && notification.data;
  if (!data) return null;
  const candidates = [
    data.senderEmail,
    data.data && data.data.senderEmail,
    data.custom && data.custom.a && data.custom.a.senderEmail,
    data.additionalData && data.additionalData.senderEmail,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return null;
}

// お知らせ新着通知かどうか（dataの type が "notice"）。置き場所のバリエーションは上と同じ理由で複数確認する。
function isNoticeNotification(notification) {
  const data = notification && notification.data;
  if (!data) return false;
  const candidates = [
    data.type,
    data.data && data.data.type,
    data.custom && data.custom.a && data.custom.a.type,
    data.additionalData && data.additionalData.type,
  ];
  return candidates.some(function (c) { return c === "notice"; });
}

self.addEventListener("notificationclick", function (event) {
  // OneSignal標準の「無条件で新規ウィンドウを開く」処理を止める
  event.stopImmediatePropagation();
  event.notification.close();

  const isNotice = isNoticeNotification(event.notification);
  const senderEmail = isNotice ? null : extractSenderEmail(event.notification);
  const openUrl = isNotice
    ? `${PORTAL_APP_URL}?tab=notices`
    : senderEmail
      ? `${PORTAL_APP_URL}?chat=${encodeURIComponent(senderEmail)}`
      : PORTAL_APP_URL;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // 既に社内ポータルの画面が開いていれば、新規に開かず前面に出すだけにする
        for (const client of clientList) {
          if (client.url && client.url.indexOf(PORTAL_APP_PATH) !== -1 && "focus" in client) {
            return client.focus().then(function (focusedClient) {
              // 送信者が分かっていれば、既に開いている画面にそのままチャット相手を伝える
              // （ページの再読み込みは起きないため、URLの?chatパラメータ方式では反応できない）
              if (isNotice && focusedClient && "postMessage" in focusedClient) {
                // お知らせ通知：既に開いている画面に、お知らせタブへ切り替えてもらう
                focusedClient.postMessage({ type: "OSAKAGUMI_OPEN_NOTICES" });
              } else if (senderEmail && focusedClient && "postMessage" in focusedClient) {
                focusedClient.postMessage({ type: "OSAKAGUMI_OPEN_CHAT", email: senderEmail });
              }
              return focusedClient;
            });
          }
        }
        // 開いている画面が無ければ、1つだけ新規に開く（分かっていれば該当チャット直行のURLで）
        if (clients.openWindow) {
          return clients.openWindow(openUrl);
        }
      })
  );
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
