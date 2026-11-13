# Chess & Cards · GM 桌面工具
# 双击根目录的「GM工具.bat」启动。原生 Windows 窗口，不经过浏览器。
# 服务器密码只保存在本机 tools/.gm-config.json，不会进入仓库。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

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
$script:ProcLog = Join-Path $env:TEMP 'cc-gm-proc.log'
$script:LogOffset = 0
$script:Proc = $null
$script:Players = @()
$script:Rooms = @()
$script:Notices = @()

# ---------- 配色 ----------
$C_BG = [System.Drawing.Color]::FromArgb(14, 18, 26)
$C_PANEL = [System.Drawing.Color]::FromArgb(22, 28, 38)
$C_INPUT = [System.Drawing.Color]::FromArgb(9, 13, 19)
$C_TEXT = [System.Drawing.Color]::FromArgb(232, 236, 244)
$C_MUTED = [System.Drawing.Color]::FromArgb(146, 156, 174)
$C_GOLD = [System.Drawing.Color]::FromArgb(216, 162, 74)
$C_OK = [System.Drawing.Color]::FromArgb(126, 214, 174)
$C_ERR = [System.Drawing.Color]::FromArgb(255, 138, 128)
$C_LINE = [System.Drawing.Color]::FromArgb(48, 58, 74)

$FONT_UI = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$FONT_TITLE = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
$FONT_MONO = New-Object System.Drawing.Font('Consolas', 9)

# ---------- 窗体 ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Chess & Cards · GM 控制台'
$form.Size = New-Object System.Drawing.Size(1120, 820)
$form.MinimumSize = New-Object System.Drawing.Size(1000, 720)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_BG
$form.ForeColor = $C_TEXT
$form.Font = $FONT_UI

function New-Label($text, $x, $y, $w, $h = 18, $color = $C_MUTED, $font = $FONT_UI) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, $h)
  $l.ForeColor = $color
  $l.Font = $font
  $l.BackColor = [System.Drawing.Color]::Transparent
  return $l
}

function New-Input($x, $y, $w, $text = '', $isPassword = $false, $h = 24) {
  $t = New-Object System.Windows.Forms.TextBox
  $t.Location = New-Object System.Drawing.Point($x, $y)
  $t.Size = New-Object System.Drawing.Size($w, $h)
  $t.Text = $text
  $t.BackColor = $C_INPUT
  $t.ForeColor = $C_TEXT
  $t.BorderStyle = 'FixedSingle'
  $t.Font = $FONT_UI
  if ($isPassword) { $t.UseSystemPasswordChar = $true }
  return $t
}

function New-Button($text, $x, $y, $w, $h = 30, $primary = $false) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text
  $b.Location = New-Object System.Drawing.Point($x, $y)
  $b.Size = New-Object System.Drawing.Size($w, $h)
  $b.FlatStyle = 'Flat'
  $b.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
  $b.Cursor = 'Hand'
  if ($primary) {
    $b.BackColor = $C_GOLD
    $b.ForeColor = [System.Drawing.Color]::FromArgb(34, 24, 8)
    $b.FlatAppearance.BorderSize = 0
  } else {
    $b.BackColor = [System.Drawing.Color]::FromArgb(32, 40, 54)
    $b.ForeColor = $C_TEXT
    $b.FlatAppearance.BorderColor = $C_LINE
    $b.FlatAppearance.BorderSize = 1
  }
  return $b
}

function New-Combo($x, $y, $w, $items = @()) {
  $c = New-Object System.Windows.Forms.ComboBox
  $c.Location = New-Object System.Drawing.Point($x, $y)
  $c.Size = New-Object System.Drawing.Size($w, 24)
  $c.DropDownStyle = 'DropDownList'
  $c.BackColor = $C_INPUT
  $c.ForeColor = $C_TEXT
  $c.FlatStyle = 'Flat'
  foreach ($i in $items) { [void]$c.Items.Add($i) }
  if ($c.Items.Count -gt 0) { $c.SelectedIndex = 0 }
  return $c
}

function New-ListView($x, $y, $w, $h, $columns) {
  $lv = New-Object System.Windows.Forms.ListView
  $lv.Location = New-Object System.Drawing.Point($x, $y)
  $lv.Size = New-Object System.Drawing.Size($w, $h)
  $lv.View = 'Details'
  $lv.FullRowSelect = $true
  $lv.GridLines = $false
  $lv.MultiSelect = $false
  $lv.HideSelection = $false
  $lv.BackColor = $C_INPUT
  $lv.ForeColor = $C_TEXT
  $lv.BorderStyle = 'FixedSingle'
  $lv.Font = $FONT_UI
  foreach ($col in $columns) {
    [void]$lv.Columns.Add($col.name, $col.width)
  }
  return $lv
}

function New-Panel($x, $y, $w, $h) {
  $p = New-Object System.Windows.Forms.Panel
  $p.Location = New-Object System.Drawing.Point($x, $y)
  $p.Size = New-Object System.Drawing.Size($w, $h)
  $p.BackColor = $C_PANEL
  return $p
}

# ---------- 顶部连接区 ----------
$panelConn = New-Panel 12 10 1080 108
$form.Controls.Add($panelConn)

$panelConn.Controls.Add((New-Label 'SSH 主机' 14 10 80))
$txtHost = New-Input 14 30 170
$panelConn.Controls.Add($txtHost)

$panelConn.Controls.Add((New-Label '端口' 194 10 50))
$txtPort = New-Input 194 30 60 '22'
$panelConn.Controls.Add($txtPort)

$panelConn.Controls.Add((New-Label '用户名' 264 10 70))
$txtUser = New-Input 264 30 110 'ubuntu'
$panelConn.Controls.Add($txtUser)

$panelConn.Controls.Add((New-Label '密码' 384 10 60))
$txtPass = New-Input 384 30 140 '' $true
$panelConn.Controls.Add($txtPass)

$panelConn.Controls.Add((New-Label '站点地址' 534 10 80))
$txtSite = New-Input 534 30 230 'http://82.157.54.179/lobby'
$panelConn.Controls.Add($txtSite)

$panelConn.Controls.Add((New-Label 'GM 口令（ADMIN_TOKEN）' 774 10 200))
$txtToken = New-Input 774 30 180 '' $true
$panelConn.Controls.Add($txtToken)

$btnSave = New-Button '保存配置' 964 28 100 28
$panelConn.Controls.Add($btnSave)

$lblConn = New-Label '未连接' 14 66 500 18 $C_MUTED
$panelConn.Controls.Add($lblConn)

$btnPing = New-Button '测试连接' 14 74 100 26
$panelConn.Controls.Add($btnPing)

$btnLoadCfg = New-Button '重新读取配置' 120 74 120 26
$panelConn.Controls.Add($btnLoadCfg)

# ---------- 选项卡 ----------
$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Location = New-Object System.Drawing.Point(12, 126)
$tabs.Size = New-Object System.Drawing.Size(1080, 606)
$tabs.Font = $FONT_TITLE
$tabs.ItemSize = New-Object System.Drawing.Size(112, 30)
$tabs.Padding = New-Object System.Drawing.Point(12, 6)
$form.Controls.Add($tabs)

function New-TabPage($text) {
  $page = New-Object System.Windows.Forms.TabPage
  $page.Text = $text
  $page.BackColor = $C_BG
  $page.ForeColor = $C_TEXT
  return $page
}

# ================= 房间 =================
$pageRooms = New-TabPage '  房间  '
$tabs.TabPages.Add($pageRooms)

$panelCreate = New-Panel 12 12 330 560
$pageRooms.Controls.Add($panelCreate)
$panelCreate.Controls.Add((New-Label '新建平台坐庄房间' 14 12 260 22 $C_GOLD $FONT_TITLE))
$panelCreate.Controls.Add((New-Label '平台庄玩法无人也持续开局，玩家可随时入座' 14 36 300 34))

$panelCreate.Controls.Add((New-Label '游戏' 14 78 60))
$cboGame = New-Combo 14 98 296
$panelCreate.Controls.Add($cboGame)

$panelCreate.Controls.Add((New-Label '开几间（1-10）' 14 134 140))
$numCount = New-Object System.Windows.Forms.NumericUpDown
$numCount.Location = New-Object System.Drawing.Point(14, 154)
$numCount.Size = New-Object System.Drawing.Size(90, 24)
$numCount.Minimum = 1
$numCount.Maximum = 10
$numCount.Value = 1
$numCount.BackColor = $C_INPUT
$numCount.ForeColor = $C_TEXT
$panelCreate.Controls.Add($numCount)

$btnCreateRoom = New-Button '创建房间' 116 152 194 30 $true
$panelCreate.Controls.Add($btnCreateRoom)

$lblRoomHint = New-Label '提示：非平台庄玩法也可开台，但不会自动续局' 14 196 300 34 $C_MUTED
$panelCreate.Controls.Add($lblRoomHint)

$btnRefreshRooms = New-Button '刷新房间列表' 14 248 140 30
$panelCreate.Controls.Add($btnRefreshRooms)

$btnDestroyRoom = New-Button '销毁选中房间' 164 248 146 30
$panelCreate.Controls.Add($btnDestroyRoom)

$lblRoomStat = New-Label '尚未加载' 14 292 300 40 $C_MUTED
$panelCreate.Controls.Add($lblRoomStat)

$lvRooms = New-ListView 354 12 700 560 @(
  @{ name = '房间'; width = 150 },
  @{ name = '游戏'; width = 110 },
  @{ name = '人数'; width = 70 },
  @{ name = '状态'; width = 80 },
  @{ name = '类型'; width = 80 },
  @{ name = '可加入'; width = 70 },
  @{ name = '房号'; width = 120 }
)
$pageRooms.Controls.Add($lvRooms)

# ================= 玩家 =================
$pagePlayers = New-TabPage '  玩家  '
$tabs.TabPages.Add($pagePlayers)

$panelPFind = New-Panel 12 12 330 560
$pagePlayers.Controls.Add($panelPFind)
$panelPFind.Controls.Add((New-Label '玩家查询与调整' 14 12 240 22 $C_GOLD $FONT_TITLE))

$panelPFind.Controls.Add((New-Label '昵称或账号关键字（留空列出最近玩家）' 14 40 300 20))
$txtSearch = New-Input 14 62 296
$panelPFind.Controls.Add($txtSearch)

$btnSearch = New-Button '搜索' 14 94 140 28
$panelPFind.Controls.Add($btnSearch)

$btnPlayerAll = New-Button '全部玩家' 164 94 146 28
$panelPFind.Controls.Add($btnPlayerAll)

$panelPFind.Controls.Add((New-Label '调整额度（正数发放 / 负数扣除）' 14 136 300 20))
$txtAmount = New-Input 14 158 140 '1000'
$panelPFind.Controls.Add($txtAmount)

$txtReason = New-Input 164 158 146 'GM 补偿'
$panelPFind.Controls.Add($txtReason)

$btnGrant = New-Button '执行调整' 14 192 296 32 $true
$panelPFind.Controls.Add($btnGrant)

$lblPlayerDetail = New-Label '选中玩家后显示详情' 14 238 300 300 $C_MUTED
$panelPFind.Controls.Add($lblPlayerDetail)

$lvPlayers = New-ListView 354 12 700 560 @(
  @{ name = '昵称'; width = 170 },
  @{ name = '余额'; width = 110 },
  @{ name = '账号'; width = 140 },
  @{ name = '签名'; width = 200 },
  @{ name = '玩家 ID'; width = 70 }
)
$pagePlayers.Controls.Add($lvPlayers)

# ================= 公告 =================
$pageNotices = New-TabPage '  公告  '
$tabs.TabPages.Add($pageNotices)

$panelNEdit = New-Panel 12 12 330 560
$pageNotices.Controls.Add($panelNEdit)
$panelNEdit.Controls.Add((New-Label '发布公告' 14 12 200 22 $C_GOLD $FONT_TITLE))

$panelNEdit.Controls.Add((New-Label '标题' 14 42 60))
$txtNoticeTitle = New-Input 14 62 296
$panelNEdit.Controls.Add($txtNoticeTitle)

$panelNEdit.Controls.Add((New-Label '内容' 14 96 60))
$txtNoticeBody = New-Object System.Windows.Forms.TextBox
$txtNoticeBody.Location = New-Object System.Drawing.Point(14, 116)
$txtNoticeBody.Size = New-Object System.Drawing.Size(296, 120)
$txtNoticeBody.Multiline = $true
$txtNoticeBody.BackColor = $C_INPUT
$txtNoticeBody.ForeColor = $C_TEXT
$txtNoticeBody.BorderStyle = 'FixedSingle'
$panelNEdit.Controls.Add($txtNoticeBody)

$panelNEdit.Controls.Add((New-Label '类型' 14 250 60))
$cboKind = New-Combo 14 270 150 @('notice', 'event', 'maintenance')
$panelNEdit.Controls.Add($cboKind)

$btnNoticePublish = New-Button '发布' 14 306 296 32 $true
$panelNEdit.Controls.Add($btnNoticePublish)

$btnNoticeRefresh = New-Button '刷新列表' 14 350 140 28
$panelNEdit.Controls.Add($btnNoticeRefresh)

$btnNoticeDelete = New-Button '删除选中' 164 350 146 28
$panelNEdit.Controls.Add($btnNoticeDelete)

$lvNotices = New-ListView 354 12 700 560 @(
  @{ name = '标题'; width = 240 },
  @{ name = '类型'; width = 100 },
  @{ name = '内容'; width = 240 },
  @{ name = '时间'; width = 110 }
)
$pageNotices.Controls.Add($lvNotices)

# ================= 部署运维 =================
$pageOps = New-TabPage '  部署运维  '
$tabs.TabPages.Add($pageOps)

$panelOps = New-Panel 12 12 1056 96
$pageOps.Controls.Add($panelOps)

$btnDeploy = New-Button '一键部署到服务器' 16 16 240 56 $true
$panelOps.Controls.Add($btnDeploy)

$btnStatus = New-Button '检查服务状态' 268 16 160 56
$panelOps.Controls.Add($btnStatus)

$btnRestart = New-Button '重启服务' 440 16 160 56
$panelOps.Controls.Add($btnRestart)

$lblOpsHint = New-Label '部署流程：打包当前版本 → SFTP 上传 → 远程执行 deploy.sh → 轮询健康检查' 616 30 420 40 $C_MUTED
$panelOps.Controls.Add($lblOpsHint)

$txtDeployLog = New-Object System.Windows.Forms.RichTextBox
$txtDeployLog.Location = New-Object System.Drawing.Point(12, 118)
$txtDeployLog.Size = New-Object System.Drawing.Size(1056, 454)
$txtDeployLog.BackColor = [System.Drawing.Color]::FromArgb(6, 9, 13)
$txtDeployLog.ForeColor = $C_TEXT
$txtDeployLog.Font = $FONT_MONO
$txtDeployLog.ReadOnly = $true
$txtDeployLog.BorderStyle = 'None'
$pageOps.Controls.Add($txtDeployLog)

# ================= 操作日志 =================
$pageLog = New-TabPage '  操作日志  '
$tabs.TabPages.Add($pageLog)

$txtLog = New-Object System.Windows.Forms.RichTextBox
$txtLog.Location = New-Object System.Drawing.Point(12, 12)
$txtLog.Size = New-Object System.Drawing.Size(1056, 560)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(6, 9, 13)
$txtLog.ForeColor = $C_TEXT
$txtLog.Font = $FONT_MONO
$txtLog.ReadOnly = $true
$txtLog.BorderStyle = 'None'
$pageLog.Controls.Add($txtLog)

# ---------- 状态条 ----------
$statusBar = New-Object System.Windows.Forms.StatusStrip
$statusBar.BackColor = $C_PANEL
$statusBar.ForeColor = $C_MUTED
$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Text = '就绪'
$statusBar.Items.Add($statusLabel) | Out-Null
$form.Controls.Add($statusBar)

# ---------- 日志 ----------
function Add-Log($text, $kind = 'info') {
  if (-not $text) { return }
  $color = switch ($kind) {
    'err' { $C_ERR }
    'ok' { $C_OK }
    'done' { $C_GOLD }
    'remote' { [System.Drawing.Color]::FromArgb(186, 196, 212) }
    default { $C_MUTED }
  }
  $stamp = (Get-Date).ToString('HH:mm:ss')
  $txtLog.SelectionStart = $txtLog.TextLength
  $txtLog.SelectionColor = $color
  $txtLog.AppendText("[$stamp] $text`r`n")
  $txtLog.SelectionStart = $txtLog.TextLength
  $txtLog.ScrollToCaret()
}

function Set-Status($text, $isError = $false) {
  $statusLabel.Text = $text
  $statusLabel.ForeColor = if ($isError) { $C_ERR } else { $C_MUTED }
}

# ---------- 配置 ----------
function Load-Config {
  if (-not (Test-Path $script:ConfigPath)) { return }
  try {
    $cfg = Get-Content $script:ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.host) { $txtHost.Text = $cfg.host }
    if ($cfg.port) { $txtPort.Text = $cfg.port }
    if ($cfg.username) { $txtUser.Text = $cfg.username }
    if ($cfg.password) { $txtPass.Text = $cfg.password }
    if ($cfg.site) { $txtSite.Text = $cfg.site }
    if ($cfg.adminToken) { $txtToken.Text = $cfg.adminToken }
  } catch {
    Add-Log '配置文件损坏，已忽略' 'err'
  }
}

function Save-Config {
  $cfg = [ordered]@{
    host       = $txtHost.Text.Trim()
    port       = $txtPort.Text.Trim()
    username   = $txtUser.Text.Trim()
    password   = $txtPass.Text
    site       = $txtSite.Text.Trim()
    adminToken = $txtToken.Text
  }
  ($cfg | ConvertTo-Json) | Set-Content -Path $script:ConfigPath -Encoding UTF8
  Add-Log '配置已保存到本机 tools/.gm-config.json' 'ok'
}

# ---------- GM 接口 ----------
function Invoke-GmApi {
  param([string]$Path, [string]$Method = 'GET', $Body = $null)

  $base = $txtSite.Text.Trim().TrimEnd('/')
  if (-not $base) { throw '请先填写站点地址' }
  $token = $txtToken.Text.Trim()
  if (-not $token) { throw '请先填写 GM 口令' }

  $headers = @{ Authorization = "Bearer $token" }
  $params = @{
    Uri             = "$base$Path"
    Method          = $Method
    Headers         = $headers
    TimeoutSec      = 20
    UseBasicParsing = $true
  }
  if ($Body) {
    $params.Body = ($Body | ConvertTo-Json -Compress)
    $params.ContentType = 'application/json'
  }
  return Invoke-RestMethod @params
}

function Get-GameList {
  try {
    $base = $txtSite.Text.Trim().TrimEnd('/')
    if (-not $base) { return }
    $res = Invoke-RestMethod -Uri "$base/api/games" -TimeoutSec 15 -UseBasicParsing
    $cboGame.Items.Clear()
    foreach ($g in $res.games) {
      $tag = if ($g.persistent) { '（平台庄）' } else { '' }
      [void]$cboGame.Items.Add("$($g.gameId) - $($g.title)$tag")
    }
    if ($cboGame.Items.Count -gt 0) { $cboGame.SelectedIndex = 0 }
    Add-Log "已加载 $($res.games.Count) 款游戏" 'ok'
  } catch {
    Add-Log "加载游戏列表失败：$($_.Exception.Message)" 'err'
  }
}

function Refresh-Rooms {
  try {
    $res = Invoke-GmApi '/api/admin/rooms'
    $script:Rooms = @($res.rooms)
    $lvRooms.Items.Clear()
    foreach ($r in $script:Rooms) {
      $item = New-Object System.Windows.Forms.ListViewItem([string]$r.roomName)
      [void]$item.SubItems.Add([string]$r.gameId)
      [void]$item.SubItems.Add("$($r.players)/$($r.maxPlayers)")
      [void]$item.SubItems.Add([string]$r.status)
      [void]$item.SubItems.Add($(if ($r.persistent) { '平台庄' } else { '玩家房' }))
      [void]$item.SubItems.Add($(if ($r.joinable) { '可' } else { '否' }))
      [void]$item.SubItems.Add([string]$r.roomId)
      $item.Tag = $r
      [void]$lvRooms.Items.Add($item)
    }
    $platform = ($script:Rooms | Where-Object { $_.persistent }).Count
    $lblRoomStat.Text = "共 $($script:Rooms.Count) 间房，其中平台庄 $platform 间"
    Add-Log "房间列表已刷新：$($script:Rooms.Count) 间" 'ok'
  } catch {
    Add-Log "刷新房间失败：$($_.Exception.Message)" 'err'
  }
}

function Refresh-Players {
  param([string]$Keyword = '')
  try {
    $res = Invoke-GmApi "/api/admin/players?q=$([uri]::EscapeDataString($Keyword))"
    $script:Players = @($res.players)
    $lvPlayers.Items.Clear()
    foreach ($p in $script:Players) {
      $item = New-Object System.Windows.Forms.ListViewItem([string]$p.nickname)
      [void]$item.SubItems.Add(('{0:N0}' -f [double]$p.balance))
      [void]$item.SubItems.Add([string]$p.username)
      [void]$item.SubItems.Add([string]$p.bio)
      [void]$item.SubItems.Add($p.userId.Substring(0, 8))
      $item.Tag = $p
      [void]$lvPlayers.Items.Add($item)
    }
    Add-Log "查询到 $($script:Players.Count) 位玩家" 'ok'
  } catch {
    Add-Log "查询玩家失败：$($_.Exception.Message)" 'err'
  }
}

function Refresh-Notices {
  try {
    $res = Invoke-GmApi '/api/admin/announcements'
    $script:Notices = @($res.announcements)
    $lvNotices.Items.Clear()
    foreach ($n in $script:Notices) {
      $item = New-Object System.Windows.Forms.ListViewItem([string]$n.title)
      [void]$item.SubItems.Add([string]$n.kind)
      [void]$item.SubItems.Add([string]$n.content)
      [void]$item.SubItems.Add(([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$n.createdAt)).LocalDateTime.ToString('MM-dd HH:mm'))
      $item.Tag = $n
      [void]$lvNotices.Items.Add($item)
    }
    Add-Log "公告列表已刷新：$($script:Notices.Count) 条" 'ok'
  } catch {
    Add-Log "刷新公告失败：$($_.Exception.Message)" 'err'
  }
}

# ---------- 外部进程（部署） ----------
$script:Timer = New-Object System.Windows.Forms.Timer
$script:Timer.Interval = 400

$script:Timer.add_Tick({
  if (Test-Path $script:ProcLog) {
    try {
      $fs = [System.IO.File]::Open($script:ProcLog, 'Open', 'Read', 'ReadWrite')
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
          $color = switch ($obj.kind) { 'err' { $C_ERR } 'ok' { $C_OK } 'done' { $C_GOLD } default { $C_TEXT } }
          $txtDeployLog.SelectionStart = $txtDeployLog.TextLength
          $txtDeployLog.SelectionColor = $color
          $txtDeployLog.AppendText("$($obj.text)`r`n")
          $txtDeployLog.SelectionStart = $txtDeployLog.TextLength
          $txtDeployLog.ScrollToCaret()
          if ($obj.kind -eq 'err') { Add-Log $obj.text 'err' }
        } catch {
          $txtDeployLog.AppendText("$trim`r`n")
        }
      }
    } catch { }
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
  param([string]$Action)

  if ($script:Proc -and -not $script:Proc.HasExited) {
    Add-Log '已有任务在执行，请稍候' 'err'
    return
  }
  if (-not $txtHost.Text.Trim() -or -not $txtUser.Text.Trim() -or -not $txtPass.Text) {
    Add-Log '请先填写 SSH 主机、用户名与密码' 'err'
    return
  }

  Save-Config
  if (Test-Path $script:ProcLog) { Remove-Item $script:ProcLog -Force -ErrorAction SilentlyContinue }
  $script:LogOffset = 0
  $txtDeployLog.Clear()

  $nodeArgs = @(
    (Join-Path $script:Root 'tools\gm-cli.mjs'),
    $Action,
    '--host', $txtHost.Text.Trim(),
    '--port', $txtPort.Text.Trim(),
    '--user', $txtUser.Text.Trim(),
    '--pass', $txtPass.Text,
    '--dir', '/opt/chess-and-cards'
  )

  $btnDeploy.Enabled = $false
  $btnStatus.Enabled = $false
  $btnRestart.Enabled = $false
  Set-Status "执行中：$Action"

  $script:Proc = Start-Process -FilePath 'node' -ArgumentList $nodeArgs `
    -WorkingDirectory $script:Root -NoNewWindow -PassThru `
    -RedirectStandardOutput $script:ProcLog `
    -RedirectStandardError "$script:ProcLog.err"

  $tabs.SelectedTab = $pageOps
  $script:Timer.Start()
}

# ---------- 事件 ----------
$btnSave.add_Click({ Save-Config })
$btnLoadCfg.add_Click({ Load-Config; Add-Log '已重新读取本地配置' 'ok' })

$btnPing.add_Click({
  try {
    $base = $txtSite.Text.Trim().TrimEnd('/')
    $res = Invoke-RestMethod -Uri "$base/api/games" -TimeoutSec 15 -UseBasicParsing
    $lblConn.Text = "已连通：$base，共 $($res.games.Count) 款游戏"
    $lblConn.ForeColor = $C_OK
    Add-Log "站点连通：$base" 'ok'
    Get-GameList
    Refresh-Rooms
  } catch {
    $lblConn.Text = "连接失败：$($_.Exception.Message)"
    $lblConn.ForeColor = $C_ERR
    Add-Log "站点连接失败：$($_.Exception.Message)" 'err'
  }
})

$btnCreateRoom.add_Click({
  try {
    $sel = [string]$cboGame.SelectedItem
    if (-not $sel) { throw '请先选择游戏' }
    $gameId = ($sel -split ' - ')[0].Trim()
    $count = [int]$numCount.Value
    $res = Invoke-GmApi '/api/admin/rooms' 'POST' @{ gameId = $gameId; count = $count }
    Add-Log "已创建 $($res.created.Count) 间 $gameId 平台庄房间" 'ok'
    Refresh-Rooms
  } catch {
    Add-Log "创建房间失败：$($_.Exception.Message)" 'err'
  }
})

$btnRefreshRooms.add_Click({ Refresh-Rooms })

$btnDestroyRoom.add_Click({
  try {
    if ($lvRooms.SelectedItems.Count -eq 0) { throw '请先选中一间房' }
    $room = $lvRooms.SelectedItems[0].Tag
    $confirm = [System.Windows.Forms.MessageBox]::Show(
      "确认销毁房间 $($room.roomName)（$($room.roomId)）？`r`n房内玩家会被移出。",
      '确认销毁', 'YesNo', 'Warning')
    if ($confirm -ne 'Yes') { return }
    Invoke-GmApi "/api/admin/rooms/$($room.roomId)" 'DELETE' | Out-Null
    Add-Log "已销毁房间 $($room.roomId)" 'ok'
    Refresh-Rooms
  } catch {
    Add-Log "销毁失败：$($_.Exception.Message)" 'err'
  }
})

$lvRooms.add_SelectedIndexChanged({
  if ($lvRooms.SelectedItems.Count -eq 0) { return }
  $r = $lvRooms.SelectedItems[0].Tag
  $lblRoomStat.Text = "房间 $($r.roomId)`r`n游戏 $($r.gameId)　状态 $($r.status)`r`n人数 $($r.players)/$($r.maxPlayers)　庄家 $($r.hostName)"
})

$btnSearch.add_Click({ Refresh-Players $txtSearch.Text.Trim() })
$btnPlayerAll.add_Click({ $txtSearch.Text = ''; Refresh-Players '' })

$lvPlayers.add_SelectedIndexChanged({
  if ($lvPlayers.SelectedItems.Count -eq 0) { return }
  $p = $lvPlayers.SelectedItems[0].Tag
  $lblPlayerDetail.Text = "昵称：$($p.nickname)`r`n账号：$($p.username)`r`n余额：$('{0:N0}' -f [double]$p.balance)`r`n签名：$($p.bio)`r`n`r`n玩家 ID：`r`n$($p.userId)"
})

$btnGrant.add_Click({
  try {
    if ($lvPlayers.SelectedItems.Count -eq 0) { throw '请先选中一位玩家' }
    $p = $lvPlayers.SelectedItems[0].Tag
    $amount = [int]$txtAmount.Text
    if ($amount -eq 0) { throw '额度不能为 0' }
    $res = Invoke-GmApi '/api/admin/grant' 'POST' @{
      userId = $p.userId
      amount = $amount
      reason = $txtReason.Text
    }
    Add-Log "已为 $($res.nickname) 调整 $amount，当前余额 $($res.balance)" 'ok'
    Refresh-Players $txtSearch.Text.Trim()
  } catch {
    Add-Log "调整失败：$($_.Exception.Message)" 'err'
  }
})

$btnNoticePublish.add_Click({
  try {
    $title = $txtNoticeTitle.Text.Trim()
    $content = $txtNoticeBody.Text.Trim()
    if (-not $title -or -not $content) { throw '标题和内容都要填写' }
    Invoke-GmApi '/api/admin/announcements' 'POST' @{
      title = $title
      content = $content
      kind = [string]$cboKind.SelectedItem
    } | Out-Null
    Add-Log "公告已发布：$title" 'ok'
    $txtNoticeTitle.Text = ''
    $txtNoticeBody.Text = ''
    Refresh-Notices
  } catch {
    Add-Log "发布失败：$($_.Exception.Message)" 'err'
  }
})

$btnNoticeRefresh.add_Click({ Refresh-Notices })

$btnNoticeDelete.add_Click({
  try {
    if ($lvNotices.SelectedItems.Count -eq 0) { throw '请先选中一条公告' }
    $n = $lvNotices.SelectedItems[0].Tag
    Invoke-GmApi "/api/admin/announcements/$($n.id)" 'DELETE' | Out-Null
    Add-Log "已删除公告：$($n.title)" 'ok'
    Refresh-Notices
  } catch {
    Add-Log "删除失败：$($_.Exception.Message)" 'err'
  }
})

$btnDeploy.add_Click({ Invoke-Node 'deploy' })
$btnStatus.add_Click({ Invoke-Node 'status' })
$btnRestart.add_Click({ Invoke-Node 'restart' })

# ---------- 启动 ----------
Load-Config
Add-Log 'GM 控制台上线。填写连接信息后可管理房间、玩家、公告，并一键部署。' 'done'
Add-Log '密码仅存于本机 tools/.gm-config.json；GM 口令在服务器 .env 的 ADMIN_TOKEN。'

[void]$form.ShowDialog()
