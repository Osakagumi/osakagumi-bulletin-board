@echo off
if "%~1"=="/phase2" goto :Phase2

REM ============================================================
REM 大坂組 社内ポータルサイト 自動セットアップ 取り消し（アンインストール）
REM
REM  必ず「管理者として実行」してください（右クリック→管理者として実行）。
REM
REM  【重要】既定のブラウザがEdgeの場合、このスクリプトはPCを自動で
REM  「2回」再起動します（1回目の再起動後、自動的に2回目がかかります）。
REM  Chromeの場合は1回のみです。
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
REM   5. 既定のブラウザを一時的に起動し、デスクトップショートカットが実際に
REM     削除されるのを確認してから閉じます（Chromeはその場で完了、Edgeは
REM     完了しないことが多いため短時間だけ待ちます）。
REM   6. 再起動します（Edgeの場合のみ、1回目の再起動後に自動で2回目も行います）。
REM
REM  Microsoftの仕様上、1.の設定を削除すると、該当のアプリ（社内ポータル）は
REM  Edge / Chromeによって自動的にアンインストールされます
REM　（利用者が手動でアンインストールする必要はありません）。
REM ============================================================

echo ============================================================
echo  大坂組 社内ポータルサイト アンインストール
echo ============================================================
echo.
echo 開始する前に、保存していない作業を済ませ、他のアプリケーションは
echo 全て終了しておいてください（既定のブラウザがEdgeの場合、PCが自動で
echo 2回再起動します。1回目のあとは確認なしで自動的に2回目が行われます）。
echo.
choice /c YN /m "準備ができたら y を、中止する場合は n を"
if errorlevel 2 (
  echo 中止しました。
  pause
  exit /b
)

:: 管理者権限チェック（net sessionは管理者でないと失敗する、という性質を利用している）
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください。
    pause
    exit /b
)

set TARGET_URL=https://osakagumi.github.io

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
echo [5/5] 既定のブラウザを起動し、アンインストールを進めます...

set "DEFAULT_PROGID="
for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" /v ProgId 2^>nul ^| findstr /i "ProgId"') do set "DEFAULT_PROGID=%%B"

REM 既定はEdge。ProgIdが「ChromeHTML」で始まる場合だけChromeに切り替える。
set "TARGET_BROWSER=Edge"
echo %DEFAULT_PROGID% | findstr /i "^ChromeHTML" >nul
if not errorlevel 1 set "TARGET_BROWSER=Chrome"
echo   既定のブラウザ（ProgId）：%DEFAULT_PROGID%
echo   → 今回の対象：%TARGET_BROWSER%

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

if /i "%TARGET_BROWSER%"=="Chrome" goto :UninstallChrome
goto :UninstallEdge

:UninstallChrome
REM Chromeは、起動してショートカットが消えるまで待つと、その場で
REM アンインストールが完了することを確認済み。
start "" chrome
echo   デスクトップのショートカットが消えるまで待ちます...
set /a WAITED=0
:WaitChromeUninstall
if not exist "%SHORTCUT_PATTERN1%" if not exist "%SHORTCUT_PATTERN2%" goto :CloseChromeUninstall
if %WAITED% GEQ 60 (
  echo   ※60秒待ちましたが確認できませんでした。このまま次に進みます。
  goto :CloseChromeUninstall
)
timeout /t 2 /nobreak >nul
set /a WAITED+=2
goto :WaitChromeUninstall
:CloseChromeUninstall
taskkill /IM chrome.exe /F >nul 2>&1
goto :UninstallBrowserDone

:UninstallEdge
REM Edgeは、起動して待ってもその場で完了しないことが多いため、
REM 長く待たせず、コンソールのメッセージを確認できる程度だけ待つ。
start "" msedge
echo   3秒ほど待ちます...
timeout /t 3 /nobreak >nul
taskkill /IM msedge.exe /F >nul 2>&1

:UninstallBrowserDone

if /i "%TARGET_BROWSER%"=="Chrome" goto :FinishChrome
goto :FinishEdge

:FinishChrome
echo.
echo 設定を解除しました。
echo PCを再起動すると、アプリが完全に削除され、通知の強制許可・
echo ログイン時の自動起動も解除された状態になります。
shutdown /r /t 0
exit /b

:FinishEdge
echo.
echo 次回ログイン時に、このバッチ自身を「/phase2」付きで自動実行するよう登録します...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalUninstallPhase2 /t REG_SZ /d "\"%~f0\" /phase2" /f
echo.
echo 1回目の再起動を行います。ログイン後、自動的に続きが実行されます。
shutdown /r /t 0
exit /b


REM ============================================================
REM Phase2：Edgeの場合のみ、1回目の再起動後にRunOnceで自動的に
REM 実行される部分。デスクトップのショートカットが消えるのを
REM 確認してから、2回目（最後）の再起動を行う。
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
shutdown /r /t 0
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
