# 業務情報の自動更新（社内ノートPC用）
# 15分ごとにタスクスケジューラから起動される。
#  1) Apps Script から設定（対象ファイルのパス・スケジュール）を取得
#  2) 実行時刻になった対象の O:\... のファイルを読み、変更があればドライブ上の同じファイルに上書き
#  3) 結果を Apps Script に報告（失敗時はメール通知される）
# 設定は同じフォルダの config.json に書く（config.sample.json をコピーして作成）。

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $here "autoupload.log"
$statePath = Join-Path $here "state.json"

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}
function Trim-Log {
  if (Test-Path $logPath) {
    $lines = Get-Content $logPath -Encoding UTF8
    if ($lines.Count -gt 2000) { $lines | Select-Object -Last 1000 | Set-Content $logPath -Encoding UTF8 }
  }
}

function Call-Gas($payload) {
  $json = $payload | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $res = Invoke-RestMethod -Uri $config.webAppUrl -Method Post -Body $bytes -ContentType "text/plain; charset=utf-8" -TimeoutSec 180
  if ($res -is [string]) { $res = $res | ConvertFrom-Json }
  if ($res.error) { throw ("Apps Script: " + $res.error) }
  return $res
}

try {
  $config = Get-Content (Join-Path $here "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Write-Log ("config.json を読めません: " + $_.Exception.Message); exit 1
}

# 状態（前回の実行結果）。PowerShell 5.1 でも扱えるよう、ハッシュテーブルに変換して持つ
$state = @{}
if (Test-Path $statePath) {
  try {
    $o = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $o.PSObject.Properties) {
      $state[$p.Name] = @{ lastOkDate = $p.Value.lastOkDate; lastOkAt = $p.Value.lastOkAt; lastSig = $p.Value.lastSig; handledRunNow = $p.Value.handledRunNow }
    }
  } catch { Write-Log "state.json が壊れていたため初期化します" }
}

# 1) 設定を取得（同時に「生きている」連絡にもなる）
try {
  $poll = Call-Gas @{ action = "autoPoll"; autoSecret = $config.autoSecret; host = $env:COMPUTERNAME; reports = @() }
} catch {
  Write-Log ("設定の取得に失敗: " + $_.Exception.Message); exit 1
}

$now = Get-Date
$today = "D" + $now.ToString("yyyyMMdd")   # 日付文字列がJSON読込時に日時へ自動変換されないよう接頭辞を付ける
$reports = @()

foreach ($p in $poll.cfg.targets.PSObject.Properties) {
  $id = $p.Name
  $t = $p.Value
  if ($t.enabled -eq $false) { continue }
  if (-not $state.ContainsKey($id)) { $state[$id] = @{ lastOkDate = ""; lastOkAt = ""; lastSig = ""; handledRunNow = "" } }
  $st = $state[$id]

  $runNow = ($t.runNowToken -and $t.runNowToken -ne $st.handledRunNow)
  $due = $false
  if ($runNow) { $due = $true }
  elseif ($t.mode -eq "interval") {
    if (-not $st.lastOkAt) { $due = $true }
    else { $due = (($now - [DateTimeOffset]::FromUnixTimeSeconds([long]$st.lastOkAt).LocalDateTime).TotalHours -ge [double]$t.hours) }
  } else {
    $parts = ([string]$t.time).Split(":")
    $at = $now.Date.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
    $due = ($now -ge $at -and $st.lastOkDate -ne $today)
  }
  if (-not $due) { continue }

  $result = "ok"; $message = ""
  try {
    $full = [IO.Path]::GetFullPath([string]$t.path)
    $okPrefix = $false
    foreach ($pre in $config.allowedPrefixes) { if ($full.StartsWith([string]$pre, [StringComparison]::OrdinalIgnoreCase)) { $okPrefix = $true } }
    if (-not $okPrefix) { throw "許可されていないパスです（config.json の allowedPrefixes 外）: $full" }
    $ext = [IO.Path]::GetExtension($full).ToLower()
    if ($config.allowedExtensions -notcontains $ext) { throw "許可されていない拡張子です: $ext" }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "ファイルが見つかりません（O:ドライブに接続できていない可能性）: $full" }

    $fi = Get-Item -LiteralPath $full
    if ($fi.Length -gt [long]$config.maxBytes) { throw ("ファイルが大きすぎます（{0} バイト）" -f $fi.Length) }
    $sig = "{0}|{1}" -f $fi.LastWriteTimeUtc.Ticks, $fi.Length
    if (-not $runNow -and $sig -eq $st.lastSig) {
      $result = "unchanged"; $message = "更新なし"
    } else {
      # Excelなどで開かれていても読めるよう、共有を許可して読む
      $fs = [IO.File]::Open($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try { $ms = New-Object IO.MemoryStream; $fs.CopyTo($ms); $data = $ms.ToArray() } finally { $fs.Dispose() }
      $mime = switch ($ext) {
        ".xlsx" { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
        ".xlsm" { "application/vnd.ms-excel.sheet.macroEnabled.12" }
        ".xls"  { "application/vnd.ms-excel" }
        ".pdf"  { "application/pdf" }
        ".docx" { "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
        ".csv"  { "text/csv" }
        default { "application/octet-stream" }
      }
      $null = Call-Gas @{ action = "autoReplace"; autoSecret = $config.autoSecret; itemId = $id; fileId = $t.fileId; fileName = $fi.Name; mimeType = $mime; base64Data = [Convert]::ToBase64String($data) }
      $st.lastSig = $sig
      $message = "アップロードしました（{0} バイト）" -f $fi.Length
    }
    $st.lastOkDate = $today
    $st.lastOkAt = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  } catch {
    $result = "error"; $message = $_.Exception.Message
  }
  if ($runNow) { $st.handledRunNow = [string]$t.runNowToken }
  $state[$id] = $st
  Write-Log ("[{0}] {1} : {2}" -f $t.name, $result, $message)
  $reports += @{ itemId = $id; result = $result; message = $message }
}

# 状態を保存
($state | ConvertTo-Json -Depth 4) | Set-Content $statePath -Encoding UTF8

# 2) 結果を報告
if ($reports.Count -gt 0) {
  try {
    $null = Call-Gas @{ action = "autoPoll"; autoSecret = $config.autoSecret; host = $env:COMPUTERNAME; reports = $reports }
  } catch { Write-Log ("結果の報告に失敗: " + $_.Exception.Message) }
}
Trim-Log
