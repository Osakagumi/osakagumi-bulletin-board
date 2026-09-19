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
REM      （ユーザーが後から手動でOFFにすることはできません）
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

echo [0/3] 既定のブラウザを判定します...

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
echo [1/3] %TARGET_BROWSER% で社内ポータルからの通知を許可にします...
call :EnsureUrlAllowed "%NOTIFY_REGKEY%" "%TARGET_BROWSER%"

echo.
echo [2/3] %TARGET_BROWSER% に社内ポータルを強制インストールする設定をします...
reg add "%INSTALL_REGKEY%" /v 1 /t REG_SZ /d "{\"url\":\"%PORTAL_URL%\",\"default_launch_container\":\"window\",\"create_desktop_shortcut\":true}" /f

echo.
echo [3/3] インストールしたアプリが、ログイン時に自動的に開くようにします...
REM WebAppSettings: manifest_idを社内ポータル自身のID（manifest.jsonにidの明示指定が
REM 無いため、その場合の既定値であるstart_urlの解決後URL）にすることで、
REM 他のWebアプリには一切影響を与えないようにする。
REM run_on_os_login を run_windowed にすると、ユーザーが後からOFFにすることはできない。
set "PORTAL_MANIFEST_ID=https://osakagumi.github.io/osakagumi-bulletin-board/index.html"
reg add "%POLICY_REGKEY%" /v WebAppSettings /t REG_SZ /d "[{\"manifest_id\":\"%PORTAL_MANIFEST_ID%\",\"run_on_os_login\":\"run_windowed\"}]" /f

echo.
echo 設定が完了しました。
echo PCを再起動すると、Chrome/Edgeへのインストールが完了し、
echo デスクトップにアイコンが作成され、次回以降のログイン時から自動的にアプリが開くようになります。
echo.
choice /c YN /m "今すぐPCを再起動しますか"
if errorlevel 2 goto :SkipRestart
echo 15秒後に再起動します。取り消したい場合は、コマンドプロンプトで shutdown /a と入力してください。
shutdown /r /t 15
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
