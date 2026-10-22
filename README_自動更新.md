# 業務情報の自動更新（社内ノートPC）セットアップ手順

仕組み：ノートPCが15分ごとに Apps Script から設定を取得し、実行時刻になった対象の `O:\…` のファイルを、業務情報の既存ドライブファイルに上書きします（ファイルID・リンクは変わりません）。設定は管理画面「業務情報管理」の「自動更新（社内ノートPC）」で行います。Firestoreの読み取り・書き込みは使いません。

> このスクリプトは Claude の作業環境では実機テストできていません（PowerShell・Apps Script・コワークストレージが無いため）。下の「動作確認」を必ず行ってください。

## A. Apps Script（osakagumi.sys@gmail.com で1回だけ）
1. 既存プロジェクトに、新しいスクリプトファイルを追加し、`apps-script-autoupload.gs` の中身を貼り付ける。
2. 冒頭の `AUTO_SECRET` を、ノートPC専用の長いランダム文字列（20文字以上）に変更する。`firebase-config.js` の SECRET とは別の値にする（この値はブラウザ側のファイルに書かない）。
3. 既存 `apps-script-storage.gs` の `doPost` 内、`var body = JSON.parse(e.postData.contents);` の直後に2行を追加する。
   ```
   var autoRes = autoDispatch(body);
   if (autoRes) return autoRes;
   ```
4. 関数選択で `autoSetupTrigger` を選んで実行（1回だけ。権限の承認が出る）。
5. 「デプロイを管理」→ 新バージョンで再デプロイ。

## B. ノートPC
1. フォルダを作る（例：`C:\portal-autoupload`）。`bizinfo-autoupload.ps1` と `config.sample.json` を置き、`config.sample.json` を `config.json` に名前変更して編集する。
   - `webAppUrl`：Apps Script のウェブアプリURL（`firebase-config.js` の `GAS_STORAGE_CONFIG.webAppUrl` と同じ）
   - `autoSecret`：手順Aの `AUTO_SECRET` と同じ値
   - `allowedPrefixes`：読んでよいフォルダ（既定は `O:\全社共有\`）。**ここに無いパスは、管理画面で指定されても読みません。**
2. コワークストレージを `O:` に接続する。
3. タスクスケジューラに登録する（PowerShell で、ユーザーがログオンしている状態で実行）。
   ```
   $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\portal-autoupload\bizinfo-autoupload.ps1"'
   $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   Register-ScheduledTask -TaskName "PortalAutoUpload" -Action $action -Trigger $trigger -Settings $settings
   ```
   「ユーザーがログオンしている時のみ実行」になります（`O:` はログオンしたユーザーにだけ見えるため、これが必要）。
4. 電源設定（常時給電・スリープ無効・蓋を閉じても止めない）。
   ```
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
   powercfg /setactive SCHEME_CURRENT
   ```
5. Windows Update の「アクティブ時間」を設定し、再起動が日中に重ならないようにする。再起動後にログオンされないと動かないため、自動ログオン（`netplwiz`）の設定を検討する（セキュリティとの兼ね合いは要判断）。

## C. 管理画面
1. admin.html、storage-helper.js を GitHub に反映する。
2. 「業務情報管理」で対象の業務情報の「編集」を開き、「自動更新」欄に元ファイルのパスとスケジュールを入れて「保存」。
   失敗・停止の通知先は設定不要です（その業務情報の管理者＋システム管理者に自動で届きます。管理画面が保存時と管理画面を開いた時に宛先を同期します）。

## D. 動作確認
1. ノートPCで `powershell -NoProfile -ExecutionPolicy Bypass -File C:\portal-autoupload\bizinfo-autoupload.ps1` を手で実行し、`autoupload.log` を見る。
2. 編集モーダルの「予定前実行」を押し（保存も同時に行われます）、15分以内にログに「ok」が出て、業務情報のファイルが更新されることを確認する。
3. 失敗通知の確認：パスをわざと間違えて「予定前実行」→ 管理者とシステム管理者にメールが届くか。
4. 停止検知の確認：ノートPCを止めて1〜2時間後にメールが届くか（Apps Script のトリガーは1時間ごと）。
5. 再起動テスト：再起動後、ログオンして `O:` に自動で繋がり、次の15分以内にログに記録が出るか。

## 注意
- 管理画面（ブラウザ）用の SECRET は公開ファイルに書かれているため、誰でも管理画面と同じ設定を送れる理屈です。そのため、ノートPC側で「許可フォルダ（allowedPrefixes）・拡張子・サイズ」を固定し、Apps Script 側でも「保存先フォルダ内のファイルだけ」を上書き対象にしています。`allowedPrefixes` は必要最小限の範囲にしてください。
- 通知メールは Apps Script の MailApp から送られます。宛先が増えるほど1日の送信数（宛先の数で数えられます）を消費します（無料の個人アカウントは1日の送信数に上限あり）。同じ失敗の通知は1日1回までです。ノートPCの停止・復旧のメールはシステム管理者のみに届きます。宛先が1件も取得できないときは、Apps Script の所有者に送ります。
- 更新の有無は「最終更新日時＋サイズ」で判定します。変更がなければアップロードしません（「更新なし」と記録）。
- スケジュールが「毎日 08:30」の場合、08:30以降の最初の確認（15分ごと）で実行し、その日に成功するまで15分ごとに再試行します。
