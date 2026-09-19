@echo off
if "%~1"=="/phase2" goto :Phase2

REM ============================================================
REM 大坂組 社内ポータルサイト インストールスクリプト
REM
REM  必ず「管理者として実行」してください（右クリック→管理者として実行）。
REM
REM  【重要】このスクリプトは、PCを自動で「2回」再起動します。
REM  1回目の再起動後、ユーザーの操作なしで自動的に2回目の再起動が
REM  かかります（Windowsの RunOnce の仕組みを利用）。
REM
REM  このスクリプトが行うこと：
REM   0. 既定のブラウザを判定する（Chrome以外の場合はEdgeを対象にする）
REM   1. 対象ブラウザで社内ポータルからの通知を自動的に「許可」にする
REM   2. 対象ブラウザに、社内ポータルをサイレントインストール
REM      （ユーザーのクリック操作なし・デスクトップショートカットも自動作成）する
REM   3. インストールされたWebアプリが、ログイン時に自動的に開くようにする
REM      （ユーザーが後から手動でOFFにすることはできません）。あわせて、
REM      ブラウザ本体（Chrome/Edge自体）がログイン時に自動起動しないようにする
REM   4. 1回目の再起動を行う（確認は最初の1回のみ。以降は自動）
REM   5.（1回目の再起動後、自動的に実行される）デスクトップにショートカットが
REM      作成されるのを確認してから、2回目（最後）の再起動を行う
REM
REM  Edge・Chromeが両方入っている環境で、両方にアイコンや通知が二重に
REM  できてしまうのを避けるため、既定のブラウザ1つだけに設定します。
REM ============================================================

echo ============================================================
echo  大坂組 社内ポータルサイト インストール
echo ============================================================
echo.
echo このセットアップでは、PCを自動で「2回」再起動します。
echo 1回目の再起動のあとは、確認なしで自動的に2回目の再起動が行われます。
echo.
echo 開始する前に、保存していない作業を済ませ、他のアプリケーションは
echo 全て終了しておいてください。
echo.
choice /c YN /m "準備ができたら続行しますか"
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

set PORTAL_URL=https://osakagumi.github.io/osakagumi-bulletin-board/
set NOTICE_URL=https://osakagumi.github.io

echo.
echo [0/4] 既定のブラウザを判定します...

set "DEFAULT_PROGID="
for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" /v ProgId 2^>nul ^| findstr /i "ProgId"') do set "DEFAULT_PROGID=%%B"

REM 既定はEdge。ProgIdが「ChromeHTML」で始まる場合だけChromeに切り替える。
REM Firefoxなどそれ以外だった場合・判定できなかった場合はEdgeのままにする。
set "TARGET_BROWSER=Edge"
echo %DEFAULT_PROGID% | findstr /i "^ChromeHTML" >nul
if not errorlevel 1 set "TARGET_BROWSER=Chrome"

echo   既定のブラウザ（ProgId）：%DEFAULT_PROGID%
echo   → 今回の設定対象：%TARGET_BROWSER%

if /i "%TARGET_BROWSER%"=="Chrome" (
  set "POLICY_REGKEY=HKLM\SOFTWARE\Policies\Google\Chrome"
) else (
  set "POLICY_REGKEY=HKLM\SOFTWARE\Policies\Microsoft\Edge"
)
set "NOTIFY_REGKEY=%POLICY_REGKEY%\NotificationsAllowedForUrls"
set "INSTALL_REGKEY=%POLICY_REGKEY%\WebAppInstallForceList"

echo.
echo [1/4] %TARGET_BROWSER% で社内ポータルからの通知を許可にします...
call :EnsureUrlAllowed "%NOTIFY_REGKEY%" "%TARGET_BROWSER%"

echo.
echo [2/4] %TARGET_BROWSER% に社内ポータルを強制インストールする設定をします...
reg add "%INSTALL_REGKEY%" /v 1 /t REG_SZ /d "{\"url\":\"%PORTAL_URL%\",\"default_launch_container\":\"window\",\"create_desktop_shortcut\":true}" /f

echo.
echo [3/4] インストールしたアプリが、ログイン時に自動的に開くようにします...
REM WebAppSettings: manifest_idを社内ポータル自身のID（manifest.jsonにidの明示指定が
REM 無いため、その場合の既定値であるstart_urlの解決後URL）にすることで、
REM 他のWebアプリには一切影響を与えないようにする。
REM run_on_os_login を run_windowed にすると、ユーザーが後からOFFにすることはできない。
set "PORTAL_MANIFEST_ID=https://osakagumi.github.io/osakagumi-bulletin-board/index.html"
reg add "%POLICY_REGKEY%" /v WebAppSettings /t REG_SZ /d "[{\"manifest_id\":\"%PORTAL_MANIFEST_ID%\",\"run_on_os_login\":\"run_windowed\"}]" /f

REM Chrome本体・Edge本体そのものがログイン時に自動起動してしまう現象を防ぐ
REM （アプリ自体の自動起動とは別に、ブラウザ本体側の設定が独立してONになることがあるため）。
if /i "%TARGET_BROWSER%"=="Chrome" (
  reg add "%POLICY_REGKEY%" /v StartupBrowserWindowLaunchSuppressed /t REG_DWORD /d 1 /f
) else (
  reg add "%POLICY_REGKEY%" /v LaunchEdgeOnWindowsStartupEnabled /t REG_DWORD /d 0 /f
)

echo.
echo [4/4] 1回目の再起動を準備します...
REM 次回ログイン時に、このバッチ自身を「/phase2」付きで自動実行するよう登録する。
REM RunOnceは実行されると自動的に消えるが、念のためPhase2側でも明示的に削除する。
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalSetupPhase2 /t REG_SZ /d "\"%~f0\" /phase2" /f

echo.
echo 1回目の再起動を行います。ログイン後、自動的に続きが実行されます。
shutdown /r /t 0
exit /b


REM ============================================================
REM Phase2：1回目の再起動後、RunOnceにより自動的に実行される部分。
REM ユーザーの操作は不要。デスクトップにショートカットが作成されるのを
REM 確認してから、2回目（最後）の再起動を行う。
REM ============================================================
:Phase2
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v OsakagumiPortalSetupPhase2 /f >nul 2>&1

REM デスクトップの場所がフォルダリダイレクト等で標準以外（例：Dドライブ）に
REM 変更されている場合があるため、%USERPROFILE%決め打ちではなく、実際の場所を
REM レジストリから取得する。ブラウザによっては「パブリックデスクトップ」に
REM 作られる場合もあるため、両方を確認する。
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
if exist "%SHORTCUT_PATTERN1%" goto :Phase2Reboot
if exist "%SHORTCUT_PATTERN2%" goto :Phase2Reboot
if %WAITED% GEQ 90 goto :Phase2Reboot
timeout /t 5 /nobreak >nul
set /a WAITED+=5
goto :WaitPhase2

:Phase2Reboot
shutdown /r /t 0
exit /b


:: ============================================================
:: サブルーチン：指定したレジストリキーに、NOTICE_URLがまだ
:: 登録されていなければ、次の空き番号で追加登録する。
:: 引数1：レジストリキーのパス　引数2：表示用のブラウザ名
:: ============================================================
:EnsureUrlAllowed
setlocal enabledelayedexpansion
set "REGKEY=%~1"
set "BROWSERNAME=%~2"
set "FOUND=0"
set "MAXINDEX=0"

for /f "tokens=1,3*" %%A in ('reg query "%REGKEY%" 2^>nul ^| findstr /i "REG_SZ"') do (
    if /i "%%B"=="%NOTICE_URL%" set "FOUND=1"
    set /a "CUR=%%A" 2>nul
    if !CUR! GTR !MAXINDEX! set "MAXINDEX=!CUR!"
)

if "%FOUND%"=="1" (
    echo   [%BROWSERNAME%] 既に登録済みのため、何もしません。
) else (
    set /a "NEWINDEX=%MAXINDEX%+1"
    echo   [%BROWSERNAME%] 未登録のため、値 !NEWINDEX! として追加登録します...
    reg add "%REGKEY%" /v !NEWINDEX! /t REG_SZ /d "%NOTICE_URL%" /f
)
endlocal
exit /b
