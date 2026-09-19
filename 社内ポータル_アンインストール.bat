@echo off
REM ============================================================
REM 大坂組 社内ポータルサイト 自動セットアップ 取り消し（アンインストール）
REM
REM  必ず「管理者として実行」してください（右クリック→管理者として実行）。
REM
REM  このスクリプトが行うこと：
REM   1.「社内ポータル_インストール.bat」で設定した、Edge / Chrome への
REM     強制インストール設定（レジストリの値 "1"）だけを削除します。
REM     他のアプリの強制インストール設定（値 "2" 以降など）が別途あっても、
REM     それらには影響しません。
REM   2.「社内ポータル通知有効化.bat」で NotificationsAllowedForUrls に
REM     追加登録された、社内ポータルのURL（https://osakagumi.github.io）だけを
REM     探して削除します。他に登録されている別サイトのURLには影響しません。
REM   3.「社内ポータル_インストール.bat」で設定した、ログイン時の自動起動設定
REM     （WebAppSettings）を削除します。
REM     ※この値は社内ポータル専用のmanifest_idを指定して作成しているため、
REM       他のWebアプリには影響しません。ただし今のところ、この値には
REM       社内ポータルの設定しか入っていない前提で、値ごと削除しています。
REM       もし今後、他のWebアプリの設定も同じ値に追加した場合は、
REM       このスクリプトは使わず、該当箇所だけを手動で調整してください。
REM   4.「社内ポータル_インストール.bat」で設定した、ブラウザ本体（Chrome/Edge自体）の
REM     ログイン時自動起動を抑制する設定を削除します。
REM
REM  Microsoftの仕様上、1.の設定を削除すると、該当のアプリ（社内ポータル）は
REM  Edge / Chromeによって自動的にアンインストールされます
REM　（利用者が手動でアンインストールする必要はありません）。
REM ============================================================

:: 管理者権限チェック（net sessionは管理者でないと失敗する、という性質を利用している）
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください。
    pause
    exit /b
)

set TARGET_URL=https://osakagumi.github.io

echo [1/4] Edge / Chrome の強制インストール設定を解除します...

REM --- Microsoft Edge 用（強制インストール） ---
reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebAppInstallForceList" /v 1 >nul 2>&1
if %errorlevel%==0 (
  reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebAppInstallForceList" /v 1 /f
) else (
  echo   ※Edge側の設定（値 "1"）は見つかりませんでした。すでに解除済みか、未設定です。
)

REM --- Google Chrome 用（強制インストール） ---
reg query "HKLM\SOFTWARE\Policies\Google\Chrome\WebAppInstallForceList" /v 1 >nul 2>&1
if %errorlevel%==0 (
  reg delete "HKLM\SOFTWARE\Policies\Google\Chrome\WebAppInstallForceList" /v 1 /f
) else (
  echo   ※Chrome側の設定（値 "1"）は見つかりませんでした。すでに解除済みか、未設定です。
)

echo.
echo [2/4] 通知の強制許可設定を解除します...

call :RemoveUrlIfPresent "HKLM\SOFTWARE\Policies\Google\Chrome\NotificationsAllowedForUrls" "Chrome"
call :RemoveUrlIfPresent "HKLM\SOFTWARE\Policies\Microsoft\Edge\NotificationsAllowedForUrls" "Edge"

echo.
echo [3/4] ログイン時の自動起動設定を解除します...

reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v WebAppSettings >nul 2>&1
if %errorlevel%==0 (
  reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v WebAppSettings /f
) else (
  echo   ※Edge側の設定は見つかりませんでした。すでに解除済みか、未設定です。
)

reg query "HKLM\SOFTWARE\Policies\Google\Chrome" /v WebAppSettings >nul 2>&1
if %errorlevel%==0 (
  reg delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v WebAppSettings /f
) else (
  echo   ※Chrome側の設定は見つかりませんでした。すでに解除済みか、未設定です。
)

echo.
echo [4/4] ブラウザ本体のログイン時自動起動の抑制設定を解除します...

reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v LaunchEdgeOnWindowsStartupEnabled >nul 2>&1
if %errorlevel%==0 (
  reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v LaunchEdgeOnWindowsStartupEnabled /f
) else (
  echo   ※Edge側の設定は見つかりませんでした。すでに解除済みか、未設定です。
)

reg query "HKLM\SOFTWARE\Policies\Google\Chrome" /v StartupBrowserWindowLaunchSuppressed >nul 2>&1
if %errorlevel%==0 (
  reg delete "HKLM\SOFTWARE\Policies\Google\Chrome" /v StartupBrowserWindowLaunchSuppressed /f
) else (
  echo   ※Chrome側の設定は見つかりませんでした。すでに解除済みか、未設定です。
)

echo.
echo 設定を解除しました。
echo PCを再起動すると、社内ポータルのアプリが自動的に削除され、
echo デスクトップアイコンも消え、通知の強制許可・ログイン時の自動起動も解除された状態になります。
echo.
choice /c YN /m "今すぐPCを再起動しますか"
if errorlevel 2 goto :SkipRestart
shutdown /r /t 0
goto :End

:SkipRestart
echo あとで手動でPCを再起動してください。
pause

:End
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

for /f "tokens=1,3*" %%A in ('reg query "%REGKEY%" 2^>nul ^| findstr /i "REG_SZ"') do (
    if /i "%%B"=="%TARGET_URL%" set "FOUNDINDEX=%%A"
)

if defined FOUNDINDEX (
    echo   [%BROWSERNAME%] 値 !FOUNDINDEX! として登録されていたため削除します...
    reg delete "%REGKEY%" /v !FOUNDINDEX! /f
) else (
    echo   [%BROWSERNAME%] 登録されていませんでした。何もしません。
)
endlocal
exit /b
