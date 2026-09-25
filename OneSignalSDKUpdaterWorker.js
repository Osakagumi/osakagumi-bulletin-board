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
 * トレードオフ：
 * 　「通知をタップすると、送ってきた相手とのチャット画面に直接ジャンプする」という
 * 　挙動は失われる（どの通知でもアプリのトップ画面が開く／前面に出るだけになる）。
 */

const PORTAL_APP_PATH = "/osakagumi-bulletin-board/";
const PORTAL_APP_URL = "https://osakagumi.github.io/osakagumi-bulletin-board/";

self.addEventListener("notificationclick", function (event) {
  // OneSignal標準の「無条件で新規ウィンドウを開く」処理を止める
  event.stopImmediatePropagation();
  event.notification.close();

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // 既に社内ポータルの画面が開いていれば、新規に開かず前面に出すだけにする
        for (const client of clientList) {
          if (client.url && client.url.indexOf(PORTAL_APP_PATH) !== -1 && "focus" in client) {
            return client.focus();
          }
        }
        // 開いている画面が無ければ、1つだけ新規に開く
        if (clients.openWindow) {
          return clients.openWindow(PORTAL_APP_URL);
        }
      })
  );
});

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
