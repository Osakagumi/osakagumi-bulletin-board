@echo off
:: このバッチは、社内ポータルサイト（GitHub Pages上）からの通知を、
:: Chrome・Edgeで自動的に「許可」した状態にするための管理者向けツールです。
::
:: 動作：NotificationsAllowedForUrls というポリシーに、対象URLが
:: まだ登録されていなければ追加登録します。既に登録済みの場合は何もしません
:: （他のURLが既に登録されていても、それを消したり上書きしたりしません）。

:: 管理者権限チェック（net sessionは管理者でないと失敗する、という性質を利用している）
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください。
    pause
    exit /b
)

:: 許可したいサイトのURL
:: 注意：NotificationsAllowedForUrls は「コンテンツ設定」カテゴリのポリシーのため、
:: パス（末尾の/や/以降の部分）を含めることができません。ドメインのみを指定してください。
set TARGET_URL=https://osakagumi.github.io

call :EnsureUrlAllowed "HKLM\SOFTWARE\Policies\Google\Chrome\NotificationsAllowedForUrls" "Chrome"
call :EnsureUrlAllowed "HKLM\SOFTWARE\Policies\Microsoft\Edge\NotificationsAllowedForUrls" "Edge"

echo.
echo 処理が完了しました。ブラウザを再起動してください。
echo （反映されているか確認したい場合は、chrome://policy または edge://policy を開き、
echo 　「再読み込み」を押してから NotificationsAllowedForUrls を確認してください）
pause
exit /b


:: ============================================================
:: サブルーチン：指定したレジストリキーに、TARGET_URLがまだ
:: 登録されていなければ、次の空き番号で追加登録する。
:: 引数1：レジストリキーのパス　引数2：表示用のブラウザ名
:: ============================================================
:EnsureUrlAllowed
setlocal enabledelayedexpansion
set "REGKEY=%~1"
set "BROWSERNAME=%~2"
set "FOUND=0"
set "MAXINDEX=0"

:: 既存の登録内容を1件ずつ確認する（キーが存在しない場合はこのforループは何も処理しない）
for /f "tokens=1,3*" %%A in ('reg query "%REGKEY%" 2^>nul ^| findstr /i "REG_SZ"') do (
    if /i "%%B"=="%TARGET_URL%" set "FOUND=1"
    set /a "CUR=%%A" 2>nul
    if !CUR! GTR !MAXINDEX! set "MAXINDEX=!CUR!"
)

if "%FOUND%"=="1" (
    echo [%BROWSERNAME%] 既に登録済みのため、何もしません。
) else (
    set /a "NEWINDEX=%MAXINDEX%+1"
    echo [%BROWSERNAME%] 未登録のため、値 !NEWINDEX! として追加登録します...
    reg add "%REGKEY%" /v !NEWINDEX! /t REG_SZ /d "%TARGET_URL%" /f
)
endlocal
exit /b
