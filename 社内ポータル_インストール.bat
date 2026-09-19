@echo off
REM ============================================================
REM 大坂組 社内ポータルサイト インストールスクリプト
REM
REM  必ず「管理者として実行」してください（右クリック→管理者として実行）。
REM  このスクリプトが行うこと：
REM   0. 既定のブラウザを判定する（Chrome以外の場合はEdgeを対象にする）
REM   1. 対象ブラウザで社内ポータルからの通知を自動的に「許可」にする
REM   2. 対象ブラウザに、社内ポータルをサイレントインストール
REM      （ユーザーのクリック操作なし・デスクトップショートカットも自動作成）する
REM   3. インストールされたWebアプリが、ログイン時に自動的に開くようにする
REM      （ユーザーが後から手動でOFFにすることはできません）。あわせて、
REM      ブラウザ本体（Chrome/Edge自体）がログイン時に自動起動しないようにする
REM   4. 対象ブラウザを一時的に起動し、デスクトップショートカットの作成を確認してから終了する
REM      （こうしないと、初回だけ再起動が2回必要になるため）
REM
REM  Edge・Chromeが両方入っている環境で、両方にアイコンや通知が二重に
REM  できてしまうのを避けるため、既定のブラウザ1つだけに設定します。
REM ============================================================

:: 管理者権限チェック（net sessionは管理者でないと失敗する、という性質を利用している）
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください。
    pause
    exit /b
)

set PORTAL_URL=https://osakagumi.github.io/osakagumi-bulletin-board/
set NOTICE_URL=https://osakagumi.github.io

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
echo [4/4] %TARGET_BROWSER% を一時的に起動し、インストールを完了させます...
REM ポリシー登録直後は、実際のインストール処理がまだ完了していない。
REM 一度ブラウザを起動し、デスクトップに実際にショートカットが作成されるまで
REM 2秒おきに確認する（最大60秒）。固定時間の待機ではなく、完了し次第すぐ次に進む。
if /i "%TARGET_BROWSER%"=="Chrome" (
  start "" chrome
) else (
  start "" msedge
)
set "SHORTCUT_PATTERN=%USERPROFILE%\Desktop\大坂組社内ポータルサイト*.lnk"
set /a WAITED=0
:WaitForInstall
if exist "%SHORTCUT_PATTERN%" (
  echo   インストールを確認しました（約%WAITED%秒）。
  goto :CloseBrowser
)
if %WAITED% GEQ 60 (
  echo   ※60秒待ちましたが確認できませんでした。時間をおいて手動でご確認ください。
  goto :CloseBrowser
)
timeout /t 2 /nobreak >nul
set /a WAITED+=2
goto :WaitForInstall

:CloseBrowser
echo   %TARGET_BROWSER% を閉じます...
if /i "%TARGET_BROWSER%"=="Chrome" (
  taskkill /IM chrome.exe /F >nul 2>&1
) else (
  taskkill /IM msedge.exe /F >nul 2>&1
)

echo.
echo 設定が完了しました。
echo PCを再起動すると、デスクトップのアイコンから開くのと同様に、
echo 次回のログイン時から自動的にアプリ（社内ポータル）が開くようになります。
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
