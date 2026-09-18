@echo off
:: このバッチは、社内ポータルサイト（GitHub Pages上）からの通知の、
:: Chrome・Edgeでの自動許可設定（NotificationsAllowedForUrls）を
:: 取り消すための管理者向けツールです。「社内ポータル通知有効化.bat」の対になるものです。
::
:: 動作：NotificationsAllowedForUrls というポリシーから、対象URLが
:: 登録されていれば、その値だけを探して削除します。他のURLが登録されている
:: 値には一切触れません（登録されていない場合は何もしません）。

:: 管理者権限チェック（net sessionは管理者でないと失敗する、という性質を利用している）
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください。
    pause
    exit /b
)

:: 取り消したいサイトのURL（有効化バッチと同じ値にしてください）
set TARGET_URL=https://osakagumi.github.io

call :RemoveUrlIfPresent "HKLM\SOFTWARE\Policies\Google\Chrome\NotificationsAllowedForUrls" "Chrome"
call :RemoveUrlIfPresent "HKLM\SOFTWARE\Policies\Microsoft\Edge\NotificationsAllowedForUrls" "Edge"

echo.
echo 処理が完了しました。ブラウザを再起動してください。
echo （反映されているか確認したい場合は、chrome://policy または edge://policy を開き、
echo 　「再読み込み」を押してから NotificationsAllowedForUrls を確認してください）
pause
exit /b


:: ============================================================
:: サブルーチン：指定したレジストリキーの中から、TARGET_URLが
:: 登録されている値を探し、見つかればその番号だけを削除する。
:: 他のURLが登録されている値には一切触れない。
:: 引数1：レジストリキーのパス　引数2：表示用のブラウザ名
:: ============================================================
:RemoveUrlIfPresent
setlocal enabledelayedexpansion
set "REGKEY=%~1"
set "BROWSERNAME=%~2"
set "FOUNDINDEX="

:: 既存の登録内容を1件ずつ確認する（キーが存在しない場合はこのforループは何も処理しない）
for /f "tokens=1,3*" %%A in ('reg query "%REGKEY%" 2^>nul ^| findstr /i "REG_SZ"') do (
    if /i "%%B"=="%TARGET_URL%" set "FOUNDINDEX=%%A"
)

if defined FOUNDINDEX (
    echo [%BROWSERNAME%] 値 !FOUNDINDEX! として登録されていたため削除します...
    reg delete "%REGKEY%" /v !FOUNDINDEX! /f
) else (
    echo [%BROWSERNAME%] 登録されていなかったため、何もしません。
)
endlocal
exit /b
