# Chess & Cards · GM 桌面工具
# 双击根目录的「GM工具.bat」启动；本文件由 PowerShell WinForms 绘制，无需浏览器。
# 服务器密码只保存在本机 tools/.gm-config.json，不会进入仓库。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# 启动异常写入本地文件，避免窗口一闪而过没有任何提示
trap {
  $detail = ($_ | Out-String)
  $path = Join-Path $env:TEMP 'cc-gm-tool-error.txt'
  Set-Content -Path $path -Value $detail -Encoding UTF8
  [System.Windows.Forms.MessageBox]::Show("GM 工具启动失败：`r`n$($_.Exception.Message)`r`n`r`n详细信息：$path", 'Chess & Cards GM')
  break
}

$ErrorActionPreference = 'Stop'
$script:Root = Split-Path -Parent $PSScriptRoot
$script:ConfigPath = Join-Path $PSScriptRoot '.gm-config.json'
$script:LogFile = Join-Path $env:TEMP 'cc-gm-tool.log'
$script:LogOffset = 0
$script:Proc = $null
$script:Players = @()

# ---------- 配色 ----------
$C_BG = [System.Drawing.Color]::FromArgb(16, 20, 28)
$C_PANEL = [System.Drawing.Color]::FromArgb(24, 30, 40)
$C_TEXT = [System.Drawing.Color]::FromArgb(232, 236, 244)
$C_MUTED = [System.Drawing.Color]::FromArgb(150, 160, 178)
$C_GOLD = [System.Drawing.Color]::FromArgb(216, 162, 74)
$C_OK = [System.Drawing.Color]::FromArgb(127, 214, 174)
$C_ERR = [System.Drawing.Color]::FromArgb(255, 139, 128)

$FONT_UI = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$FONT_MONO = New-Object System.Drawing.Font('Consolas', 9)

# ---------- 窗体 ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Chess & Cards · GM 工具'
$form.Size = New-Object System.Drawing.Size(1080, 860)
$form.MinimumSize = New-Object System.Drawing.Size(980, 760)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_BG
$form.ForeColor = $C_TEXT
$form.Font = $FONT_UI

function New-Label($text, $x, $y, $w, $h = 20, $color = $C_MUTED, $size = 9) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, $h)
  $l.ForeColor = $color
  $l.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', $size)
  $l.BackColor = [System.Drawing.Color]::Transparent
  return $l
}

function New-Input($x, $y, $w, $text = '', $isPassword = $false) {
  $t = New-Object System.Windows.Forms.TextBox
  $t.Location = New-Object System.Drawing.Point($x, $y)
  $t.Size = New-Object System.Drawing.Size($w, 24)
  $t.Text = $text
  $t.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 20)
  $t.ForeColor = $C_TEXT
  $t.BorderStyle = 'FixedSingle'
  $t.Font = $FONT_UI
  if ($isPassword) { $t.UseSystemPasswordChar = $true }
  return $t
}

function New-Button($text, $x, $y, $w, $h = 32, $primary = $false) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text
  $b.Location = New-Object System.Drawing.Point($x, $y)
  $b.Size = New-Object System.Drawing.Size($w, $h)
  $b.FlatStyle = 'Flat'
  $b.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
  if ($primary) {
    $b.BackColor = $C_GOLD
    $b.ForeColor = [System.Drawing.Color]::FromArgb(36, 26, 8)
    $b.FlatAppearance.BorderSize = 0
  } else {
    $b.BackColor = [System.Drawing.Color]::FromArgb(32, 40, 52)
    $b.ForeColor = $C_TEXT
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 84, 104)
  }
  $b.FlatAppearance.BorderSize = 1
  return $b
}

function New-Group($title, $x, $y, $w, $h) {
  $g = New-Object System.Windows.Forms.GroupBox
  $g.Text = $title
  $g.Location = New-Object System.Drawing.Point($x, $y)
  $g.Size = New-Object System.Drawing.Size($w, $h)
  $g.ForeColor = $C_GOLD
  $g.BackColor = $C_PANEL
  return $g
}

# ---------- 服务器连接 ----------
$grpConn = New-Group '1. 服务器连接（SSH）' 16 12 1032 170
$form.Controls.Add($grpConn)

$grpConn.Controls.Add((New-Label '主机' 18 32 60))
$txtHost = New-Input 18 54 220
$grpConn.Controls.Add($txtHost)

$grpConn.Controls.Add((New-Label '端口' 254 32 60))
$txtPort = New-Input 254 54 80 '22'
$grpConn.Controls.Add($txtPort)

$grpConn.Controls.Add((New-Label '用户名' 350 32 80))
$txtUser = New-Input 350 54 130 'ubuntu'
$grpConn.Controls.Add($txtUser)

$grpConn.Controls.Add((New-Label '密码' 496 32 80))
$txtPass = New-Input 496 54 200 '' $true
$grpConn.Controls.Add($txtPass)

$grpConn.Controls.Add((New-Label '远程目录' 712 32 120))
$txtDir = New-Input 712 54 300 '/opt/chess-and-cards'
$grpConn.Controls.Add($txtDir)

$grpConn.Controls.Add((New-Label '站点地址（GM 接口用）' 18 90 200))
$txtSite = New-Input 18 112 420 'http://82.157.54.179/lobby'
$grpConn.Controls.Add($txtSite)

$grpConn.Controls.Add((New-Label '管理口令（ADMIN_TOKEN）' 452 90 220))
$txtToken = New-Input 452 112 260 '' $true
$grpConn.Controls.Add($txtToken)

$btnSave = New-Button '保存配置' 728 110 140
$grpConn.Controls.Add($btnSave)

$btnLoadCfg = New-Button '重新读取' 880 110 130
$grpConn.Controls.Add($btnLoadCfg)

# ---------- 部署与运维 ----------
$grpDeploy = New-Group '2. 一键部署与运维' 16 194 420 200
$form.Controls.Add($grpDeploy)

$btnDeploy = New-Button '一键部署到服务器' 20 34 380 46 $true
$grpDeploy.Controls.Add($btnDeploy)

$btnStatus = New-Button '检查服务状态' 20 92 180 34
$grpDeploy.Controls.Add($btnStatus)

$btnRestart = New-Button '重启服务' 220 92 180 34
$grpDeploy.Controls.Add($btnRestart)

$grpDeploy.Controls.Add((New-Label '部署 = 打包当前版本 → 上传 → 执行 deploy.sh' 20 140 380 40))

# ---------- GM 操作 ----------
$grpGm = New-Group '3. GM 操作（本地直连后端，不经浏览器）' 448 194 600 200
$form.Controls.Add($grpGm)

$grpGm.Controls.Add((New-Label '玩家搜索' 18 30 80))
$txtSearch = New-Input 18 52 240
$grpGm.Controls.Add($txtSearch)

$btnSearch = New-Button '搜索' 266 50 70 28
$grpGm.Controls.Add($btnSearch)

$lstPlayers = New-Object System.Windows.Forms.ListBox
$lstPlayers.Location = New-Object System.Drawing.Point(18, 88)
$lstPlayers.Size = New-Object System.Drawing.Size(318, 92)
$lstPlayers.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 20)
$lstPlayers.ForeColor = $C_TEXT
$lstPlayers.Font = $FONT_UI
$grpGm.Controls.Add($lstPlayers)

$grpGm.Controls.Add((New-Label '调整额度（正数发放 / 负数扣除）' 352 30 240))
$txtAmount = New-Input 352 52 110 '1000'
$grpGm.Controls.Add($txtAmount)

$txtReason = New-Input 472 52 110 'GM 补偿'
$grpGm.Controls.Add($txtReason)

$btnGrant = New-Button '发放' 352 88 100 30 $true
$grpGm.Controls.Add($btnGrant)

$btnRefreshBoard = New-Button '刷新今日榜' 462 88 110 30
$grpGm.Controls.Add($btnRefreshBoard)

$grpGm.Controls.Add((New-Label '公告标题' 352 126 90))
$txtNoticeTitle = New-Input 352 148 110
$grpGm.Controls.Add($txtNoticeTitle)

$grpGm.Controls.Add((New-Label '公告内容' 472 126 90))
$txtNoticeBody = New-Input 472 148 110
$grpGm.Controls.Add($txtNoticeBody)

$btnNotice = New-Button '发布' 352 176 100 26
$grpGm.Controls.Add($btnNotice)

$btnRoomList = New-Button '房间概览' 462 176 110 26
$grpGm.Controls.Add($btnRoomList)

# ---------- 日志 ----------
$grpLog = New-Group '4. 执行日志' 16 406 1032 380
$form.Controls.Add($grpLog)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Location = New-Object System.Drawing.Point(14, 26)
$logBox.Size = New-Object System.Drawing.Size(1004, 336)
$logBox.BackColor = [System.Drawing.Color]::FromArgb(7, 10, 14)
$logBox.ForeColor = $C_TEXT
$logBox.Font = $FONT_MONO
$logBox.ReadOnly = $true
$logBox.BorderStyle = 'None'
$logBox.WordWrap = $true
$grpLog.Controls.Add($logBox)

$statusBar = New-Label '就绪' 20 800 1000 22 $C_MUTED
$form.Controls.Add($statusBar)

# ---------- 日志输出 ----------
function Add-Log($text, $kind = 'info') {
  if (-not $text) { return }
  $color = switch ($kind) {
    'err' { $C_ERR }
    'ok' { $C_OK }
    'done' { $C_GOLD }
    'remote' { [System.Drawing.Color]::FromArgb(190, 198, 212) }
    default { $C_MUTED }
  }
  $logBox.SelectionStart = $logBox.TextLength
  $logBox.SelectionColor = $color
  $logBox.AppendText("$text`r`n")
  $logBox.SelectionStart = $logBox.TextLength
  $logBox.ScrollToCaret()
}

function Set-Status($text, $isError = $false) {
  $statusBar.Text = $text
  $statusBar.ForeColor = if ($isError) { $C_ERR } else { $C_MUTED }
}

# ---------- 配置读写 ----------
function Load-Config {
  if (Test-Path $script:ConfigPath) {
    try {
      $cfg = Get-Content $script:ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $txtHost.Text = $cfg.host
      $txtPort.Text = $cfg.port
      $txtUser.Text = $cfg.username
      $txtPass.Text = $cfg.password
      $txtDir.Text = $cfg.remoteDir
      $txtSite.Text = $cfg.site
      $txtToken.Text = $cfg.adminToken
    } catch {
      Add-Log '配置文件损坏，已忽略' 'err'
    }
  }
}

function Save-Config {
  $cfg = [ordered]@{
    host        = $txtHost.Text.Trim()
    port        = $txtPort.Text.Trim()
    username    = $txtUser.Text.Trim()
    password    = $txtPass.Text
    remoteDir   = $txtDir.Text.Trim()
    site        = $txtSite.Text.Trim()
    adminToken  = $txtToken.Text
  }
  ($cfg | ConvertTo-Json) | Set-Content -Path $script:ConfigPath -Encoding UTF8
  Add-Log '配置已保存到本机 tools/.gm-config.json' 'ok'
}

# ---------- 执行外部命令（node） ----------
$script:Timer = New-Object System.Windows.Forms.Timer
$script:Timer.Interval = 400

$script:Timer.add_Tick({
  if (-not (Test-Path $script:LogFile)) { return }
  try {
    $fs = [System.IO.File]::Open($script:LogFile, 'Open', 'Read', 'ReadWrite')
    $fs.Seek($script:LogOffset, 'Begin') | Out-Null
    $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    $chunk = $reader.ReadToEnd()
    $reader.Close()
    $script:LogOffset = $fs.Position
    $fs.Close()

    foreach ($line in ($chunk -split "`n")) {
      $trim = $line.Trim()
      if (-not $trim) { continue }
      try {
        $obj = $trim | ConvertFrom-Json
        Add-Log $obj.text $obj.kind
      } catch {
        Add-Log $trim 'remote'
      }
    }
  } catch {
    # 文件被占用时下次再读
  }

  if ($script:Proc -and $script:Proc.HasExited) {
    $script:Timer.Stop()
    $script:Proc = $null
    Set-Status '就绪'
    $btnDeploy.Enabled = $true
    $btnStatus.Enabled = $true
    $btnRestart.Enabled = $true
  }
})

function Invoke-Node {
  param([string]$Arguments)

  if ($script:Proc -and -not $script:Proc.HasExited) {
    Add-Log '已有任务在执行，请稍候' 'err'
    return
  }
  if (-not $txtHost.Text.Trim() -or -not $txtUser.Text.Trim() -or -not $txtPass.Text) {
    Add-Log '请先填写主机、用户名与密码' 'err'
    return
  }

  Save-Config

  if (Test-Path $script:LogFile) { Remove-Item $script:LogFile -Force }
  $script:LogOffset = 0

  $nodeArgs = @(
    (Join-Path $script:Root 'tools\gm-cli.mjs'),
    $Arguments,
    '--host', $txtHost.Text.Trim(),
    '--port', $txtPort.Text.Trim(),
    '--user', $txtUser.Text.Trim(),
    '--pass', $txtPass.Text,
    '--dir', $txtDir.Text.Trim()
  )

  $btnDeploy.Enabled = $false
  $btnStatus.Enabled = $false
  $btnRestart.Enabled = $false
  Set-Status '执行中…'

  $script:Proc = Start-Process -FilePath 'node' -ArgumentList $nodeArgs `
    -WorkingDirectory $script:Root -NoNewWindow -PassThru `
    -RedirectStandardOutput $script:LogFile `
    -RedirectStandardError "$script:LogFile.err"

  $script:Timer.Start()
}

# ---------- GM 接口调用 ----------
function Get-ApiBase {
  $base = $txtSite.Text.Trim().TrimEnd('/')
  if (-not $base) { throw '请先填写站点地址' }
  return $base
}

function Get-Token {
  $t = $txtToken.Text.Trim()
  if (-not $t) { throw '请先填写管理口令' }
  return $t
}

function Invoke-GmApi {
  param([string]$Path, [string]$Method = 'GET', $Body = $null)
  $base = Get-ApiBase
  $token = Get-Token
  $url = "$base$Path"
  if ($url.Contains('?')) { $url += "&token=$token" } else { $url += "?token=$token" }

  $params = @{
    Uri             = $url
    Method          = $Method
    TimeoutSec      = 20
    UseBasicParsing = $true
  }
  if ($Body) {
    $params.Body = ($Body | ConvertTo-Json -Compress)
    $params.ContentType = 'application/json'
  }
  return Invoke-RestMethod @params
}

# ---------- 按钮行为 ----------
$btnSave.add_Click({ Save-Config })
$btnLoadCfg.add_Click({
  Load-Config
  Add-Log '已重新读取本地配置' 'ok'
})

$btnDeploy.add_Click({
  $logBox.Clear()
  Add-Log '=== 开始一键部署 ===' 'done'
  Invoke-Node 'deploy'
})

$btnStatus.add_Click({
  $logBox.Clear()
  Invoke-Node 'status'
})

$btnRestart.add_Click({
  Add-Log '=== 重启服务 ===' 'done'
  Invoke-Node 'restart'
})

$btnSearch.add_Click({
  try {
    $q = $txtSearch.Text.Trim()
    $res = Invoke-GmApi "/api/admin/players?q=$([uri]::EscapeDataString($q))"
    $script:Players = @($res.players)
    $lstPlayers.Items.Clear()
    foreach ($p in $script:Players) {
      $nick = if ($p.nickname) { $p.nickname } else { '(无名)' }
      $bal = '{0:N0}' -f [double]$p.balance
      [void]$lstPlayers.Items.Add("$nick  ·  $bal  ·  $($p.userId.Substring(0,8))")
    }
    Add-Log "找到 $($script:Players.Count) 位玩家" 'ok'
  } catch {
    Add-Log "搜索失败：$($_.Exception.Message)" 'err'
  }
})

$btnGrant.add_Click({
  try {
    if ($lstPlayers.SelectedIndex -lt 0) { throw '请先在列表里选中一位玩家' }
    $player = $script:Players[$lstPlayers.SelectedIndex]
    $amount = [int]$txtAmount.Text
    if ($amount -eq 0) { throw '额度不能为 0' }
    $res = Invoke-GmApi '/api/admin/grant' 'POST' @{
      userId = $player.userId
      amount = $amount
      reason = $txtReason.Text
    }
    Add-Log "已为 $($res.nickname) 调整 $amount，当前余额 $($res.balance)" 'ok'
    $btnSearch.PerformClick()
  } catch {
    Add-Log "发放失败：$($_.Exception.Message)" 'err'
  }
})

$btnRefreshBoard.add_Click({
  try {
    $res = Invoke-GmApi '/api/admin/overview'
    $s = $res.summary
    Add-Log "在线 $($s.online) 人（真人 $($s.humans) / 机器人 $($s.bots)），房间 $($s.rooms) 个，游戏 $($s.games) 款" 'ok'
    foreach ($d in ($res.daily | Select-Object -First 8)) {
      Add-Log ("  {0}  净收益 {1}  ({2} 局)" -f $d.nickname, $d.net, $d.rounds) 'remote'
    }
  } catch {
    Add-Log "获取失败：$($_.Exception.Message)" 'err'
  }
})

$btnNotice.add_Click({
  try {
    $title = $txtNoticeTitle.Text.Trim()
    $content = $txtNoticeBody.Text.Trim()
    if (-not $title -or -not $content) { throw '标题和内容都要填' }
    Invoke-GmApi '/api/admin/announcements' 'POST' @{ title = $title; content = $content; kind = 'notice' } | Out-Null
    Add-Log "公告已发布：$title" 'ok'
    $txtNoticeTitle.Text = ''
    $txtNoticeBody.Text = ''
  } catch {
    Add-Log "发布失败：$($_.Exception.Message)" 'err'
  }
})

$btnRoomList.add_Click({
  try {
    $res = Invoke-GmApi '/api/admin/overview'
    Add-Log "当前房间 $($res.rooms.Count) 个：" 'ok'
    foreach ($r in $res.rooms) {
      Add-Log ("  {0} [{1}] {2}/{3} - {4}" -f $r.roomName, $r.gameId, $r.players, $r.maxPlayers, $r.status) 'remote'
    }
  } catch {
    Add-Log "获取失败：$($_.Exception.Message)" 'err'
  }
})

# ---------- 启动 ----------
Load-Config
Add-Log 'GM 工具已启动。填写服务器信息后即可一键部署，或直接执行 GM 操作。' 'done'
Add-Log '提示：密码仅保存在本机 tools/.gm-config.json，不会进入 Git 仓库。'

[void]$form.ShowDialog()
