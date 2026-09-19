@echo off
if "%~1"=="/phase2" goto :Phase2
if "%~1"=="/final" goto :FinalPhase

REM ============================================================
REM 大坂組 社内ポータルサイト 自動セットアップ 取り消し（アンインストール）
REM
REM  必ず「管理者として実行」してください（右クリック→管理者として実行）。
REM
REM  【重要】既定のブラウザがChromeで、その場でアンインストール完了を
REM  確認できれば、PCの再起動は1回で済みます。それ以外（Edge、または
REM  Chromeで確認できなかった場合）は、PCを自動で「2回」再起動します
REM  （1回目の再起動後、自動的に2回目がかかります）。
REM  最後の再起動のあと、ポップアップで完了をお知らせします。
REM
REM  このスクリプトが行うこと：
REM   ・インストールされていなければ、その時点で処理を中止する
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
REM   5. 既定のブラウザを判定する。Chromeであれば、アプリ自身を起動する
REM     コマンドを使って、デスクトップショートカットが消えるのを確認する
REM     （ブラウザ本体を起動しただけでは消えないことを確認済み）。
REM     Edgeの場合、この監視をしても消えることが確認できていないため、
REM     監視はせずそのまま次に進む。
REM   6. 再起動する（Chromeでその場の確認ができなければ、1回目の
REM     再起動後に自動で2回目も行う）。
REM   7. 最後の再起動のあと、自動的に実行される。少し待ってから、
REM     ポップアップで完了をお知らせする。
REM
REM  Microsoftの仕様上、1.の設定を削除すると、該当のアプリ（社内ポータル）は
REM  Edge / Chromeによって自動的にアンインストールされます
REM　（利用者が手動でアンインストールする必要はありません）。
REM ============================================================

echo ============================================================
echo  大坂組 社内ポータルサイト アンインストール
echo ============================================================

:: 管理者権限チェック（net sessionは管理者でないと失敗する、という性質を利用している）
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください。
    pause
    exit /b
)

set PORTAL_URL=https://osakagumi.github.io/osakagumi-bulletin-board/
set TARGET_URL=https://osakagumi.github.io

echo インストールされているか確認します...
set "IS_INSTALLED=0"
reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebAppInstallForceList" /v 1 2>nul | findstr /i "%PORTAL_URL%" >nul
if not errorlevel 1 set "IS_INSTALLED=1"
reg query "HKLM\SOFTWARE\Policies\Google\Chrome\WebAppInstallForceList" /v 1 2>nul | findstr /i "%PORTAL_URL%" >nul
if not errorlevel 1 set "IS_INSTALLED=1"

if "%IS_INSTALLED%"=="0" (
  echo   インストールされていないようです（既にアンインストール済みか、未インストールです）。
  echo   処理を中止します。
  pause
  exit /b
)

echo.
echo 開始する前に、保存していない作業を済ませ、他のアプリケーションは
echo 全て終了しておいてください。
echo.
choice /c YN /m "準備ができたら y を、中止する場合は n を押してください。"
if errorlevel 2 (
  echo 中止しました。
  pause
  exit /b
)

echo.
echo [1/5] Edge / Chrome の強制インストール設定を解除します...

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
echo [2/5] 通知の強制許可設定を解除します...

call :RemoveUrlIfPresent "HKLM\SOFTWARE\Policies\Google\Chrome\NotificationsAllowedForUrls" "Chrome"
call :RemoveUrlIfPresent "HKLM\SOFTWARE\Policies\Microsoft\Edge\NotificationsAllowedForUrls" "Edge"

echo.
echo [3/5] ログイン時の自動起動設定を解除します...

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
echo [4/5] ブラウザ本体のログイン時自動起動の抑制設定を解除します...

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
echo [5/5] 既定のブラウザを判定します...

set "DEFAULT_PROGID="
for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" /v ProgId 2^>nul ^| findstr /i "ProgId"') do set "DEFAULT_PROGID=%%B"

set "TARGET_BROWSER=Edge"
echo %DEFAULT_PROGID% | findstr /i "^ChromeHTML" >nul
if not errorlevel 1 set "TARGET_BROWSER=Chrome"
echo   既定のブラウザ（ProgId）：%DEFAULT_PROGID%
echo   → 今回の対象：%TARGET_BROWSER%

if /i "%TARGET_BROWSER%"=="Chrome" goto :UninstallChrome
goto :SkipMonitor

:UninstallChrome
REM デスクトップの場所がフォルダリダイレクト等で標準以外（例：Dドライブ）に
REM 変更されている場合があるため、%USERPROFILE%決め打ちではなく、実際の場所を
REM レジストリから取得する。ブラウザによっては「パブリックデスクトップ」に
REM ある場合もあるため、両方を確認する。
set "DESKTOP_DIR="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" /v Desktop 2^>nul ^| findstr /i "REG_SZ"') do set "DESKTOP_DIR=%%B"
if not defined DESKTOP_DIR set "DESKTOP_DIR=%USERPROFILE%\Desktop"

set "PUBLIC_DESKTOP_DIR="
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" /v "Common Desktop" 2^>nul ^| findstr /i "REG_SZ"') do set "PUBLIC_DESKTOP_DIR=%%B"
if not defined PUBLIC_DESKTOP_DIR set "PUBLIC_DESKTOP_DIR=%PUBLIC%\Desktop"

set "SHORTCUT_NAME=大坂組社内ポータルサイト*.lnk"
set "SHORTCUT_PATTERN1=%DESKTOP_DIR%\%SHORTCUT_NAME%"
set "SHORTCUT_PATTERN2=%PUBLIC_DESKTOP_DIR%\%SHORTCUT_NAME%"

REM ブラウザ本体を起動しただけではショートカットが消えないことを確認済み。
REM ログイン時自動起動用にHKCU\...\Runへ登録されている「アプリ自身の起動コマンド」
REM （--app-id=...を含むコマンド）を探し、それを直接実行する。
set "APP_LAUNCH_CMD="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" 2^>nul ^| findstr /i "REG_SZ"') do (
  echo %%B | findstr /i "app-id=" >nul
  if not errorlevel 1 set "APP_LAUNCH_CMD=%%B"
)

if defined APP_LAUNCH_CMD (
  echo   アプリ起動コマンドが見つかりました。起動します...
  start "" %APP_LAUNCH_CMD%
) else (
  echo   ※アプリ起動コマンドが見つからなかったため、念のためChromeを起動します。
  start "" chrome
)

echo   デスクトップのショートカットが消えるまで待ちます...
set "UNINSTALL_CONFIRMED=0"
set /a WAITED=0
:WaitUninstall
if not exist "%SHORTCUT_PATTERN1%" if not exist "%SHORTCUT_PATTERN2%" (
  set "UNINSTALL_CONFIRMED=1"
  goto :CloseApp
)
if %WAITED% GEQ 60 (
  echo   ※60秒待ちましたが確認できませんでした。このまま次に進みます。
  goto :CloseApp
)
timeout /t 2 /nobreak >nul
set /a WAITED+=2
goto :WaitUninstall

:CloseApp
taskkill /IM chrome.exe /F >nul 2>&1
goto :MonitorDone

:SkipMonitor
REM Edgeは、アプリを起動して待ってもショートカットが消えることを
REM 確認できていないため、監視はせずそのまま次に進む。
set "UNINSTALL_CONFIRMED=0"

:MonitorDone

if "%UNINSTALL_CONFIRMED%"=="1" (
  echo.
  echo アンインストールを確認できました。再起動は1回だけで済みます。
  reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalUninstallFinal /t REG_SZ /d "\"%~f0\" /final" /f
  echo 再起動します...
  shutdown /r /t 0
  exit /b
)

echo.
echo 次回ログイン時に、このバッチ自身を「/phase2」付きで自動実行するよう登録します...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalUninstallPhase2 /t REG_SZ /d "\"%~f0\" /phase2" /f

echo.
echo 1回目の再起動を行います。ログイン後、自動的に続きが実行されます。
shutdown /r /t 0
exit /b


REM ============================================================
REM Phase2：1回目の再起動後、RunOnceにより自動的に実行される部分。
REM ユーザーの操作は不要。デスクトップショートカットが消えるのを
REM 確認してから、2回目（最後）の再起動を予約する。
REM ============================================================
:Phase2
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalUninstallPhase2 /f >nul 2>&1

set "DESKTOP_DIR="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" /v Desktop 2^>nul ^| findstr /i "REG_SZ"') do set "DESKTOP_DIR=%%B"
if not defined DESKTOP_DIR set "DESKTOP_DIR=%USERPROFILE%\Desktop"

set "PUBLIC_DESKTOP_DIR="
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" /v "Common Desktop" 2^>nul ^| findstr /i "REG_SZ"') do set "PUBLIC_DESKTOP_DIR=%%B"
if not defined PUBLIC_DESKTOP_DIR set "PUBLIC_DESKTOP_DIR=%PUBLIC%\Desktop"

set "SHORTCUT_NAME=大坂組社内ポータルサイト*.lnk"
set "SHORTCUT_PATTERN1=%DESKTOP_DIR%\%SHORTCUT_NAME%"
set "SHORTCUT_PATTERN2=%PUBLIC_DESKTOP_DIR%\%SHORTCUT_NAME%"

set /a WAITED=0
:WaitPhase2
if not exist "%SHORTCUT_PATTERN1%" if not exist "%SHORTCUT_PATTERN2%" goto :Phase2Reboot
if %WAITED% GEQ 90 goto :Phase2Reboot
timeout /t 5 /nobreak >nul
set /a WAITED+=5
goto :WaitPhase2

:Phase2Reboot
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalUninstallFinal /t REG_SZ /d "\"%~f0\" /final" /f
shutdown /r /t 0
exit /b


REM ============================================================
REM FinalPhase：最後の再起動後、RunOnceにより自動的に実行される部分。
REM ユーザーの操作は不要。少し待ってから、ポップアップで完了をお知らせする
REM （再起動はもう行わない）。
REM ============================================================
:FinalPhase
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalUninstallFinal /f >nul 2>&1
timeout /t 5 /nobreak >nul
powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('大坂組社内ポータルサイトのアンインストールが完了しました。', '社内ポータル アンインストール完了') | Out-Null"
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
