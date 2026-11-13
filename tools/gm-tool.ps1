# Chess & Cards · GM 运营管理中台
# 双击根目录的「GM工具.bat」启动。原生 Windows 桌面客户端，不依赖第三方组件。
# 服务器密码只保存在本机 tools/.gm-config.json，不会进入仓库。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

trap {
  $detail = ($_ | Out-String)
  $path = Join-Path $env:TEMP 'cc-gm-tool-error.txt'
  Set-Content -Path $path -Value $detail -Encoding UTF8
  [System.Windows.Forms.MessageBox]::Show("GM 工具启动失败：`r`n$($_.Exception.Message)`r`n`r`n详细错误已保存至：$path", 'Chess & Cards GM', 'OK', 'Error')
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
$script:ActiveNav = 'dashboard'

# ---------- 极致奢华暗黑鎏金主题色板 ----------
$C_CANVAS   = [System.Drawing.Color]::FromArgb(11, 14, 20)      # 主背景
$C_SURFACE  = [System.Drawing.Color]::FromArgb(18, 24, 34)     # 面板底色
$C_CARD     = [System.Drawing.Color]::FromArgb(24, 32, 46)     # 卡片底色
$C_INPUT    = [System.Drawing.Color]::FromArgb(13, 17, 24)     # 输入框底色
$C_HOVER    = [System.Drawing.Color]::FromArgb(32, 43, 62)     # 悬停色
$C_LINE     = [System.Drawing.Color]::FromArgb(36, 48, 68)     # 边框线
$C_LINE_HI  = [System.Drawing.Color]::FromArgb(60, 80, 110)    # 高亮边框线
$C_TEXT     = [System.Drawing.Color]::FromArgb(240, 244, 248)  # 主文字
$C_MUTED    = [System.Drawing.Color]::FromArgb(142, 157, 181)  # 次要文字
$C_GOLD     = [System.Drawing.Color]::FromArgb(245, 197, 66)   # 鎏金高光
$C_GOLD_DARK= [System.Drawing.Color]::FromArgb(216, 162, 40)   # 鎏金深调
$C_GREEN    = [System.Drawing.Color]::FromArgb(56, 211, 159)   # 成功/在线绿
$C_RED      = [System.Drawing.Color]::FromArgb(255, 94, 98)    # 危险/封禁红
$C_BLUE     = [System.Drawing.Color]::FromArgb(59, 130, 246)   # 科技蓝

# ---------- 字体 ----------
$FONT_UI    = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$FONT_BOLD  = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [System.Drawing.FontStyle]::Bold)
$FONT_TITLE = New-Object System.Drawing.Font('Microsoft YaHei UI', 11, [System.Drawing.FontStyle]::Bold)
$FONT_BIG   = New-Object System.Drawing.Font('Microsoft YaHei UI', 16, [System.Drawing.FontStyle]::Bold)
$FONT_MONO  = New-Object System.Drawing.Font('Consolas', 9)

# ---------- 主窗体 ----------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Chess & Cards · GM 运营管理中台 (Obsidian Gold Edition)'
$form.Size = New-Object System.Drawing.Size(1260, 860)
$form.MinimumSize = New-Object System.Drawing.Size(1100, 740)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_CANVAS
$form.ForeColor = $C_TEXT
$form.Font = $FONT_UI

# ---------- 常用组件构造函数 ----------
function New-CustomLabel($text, $x, $y, $w, $h = 20, $color = $C_MUTED, $font = $FONT_UI) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, $h)
  $l.ForeColor = $color
  $l.Font = $font
  $l.BackColor = [System.Drawing.Color]::Transparent
  return $l
}

function New-CustomInput($x, $y, $w, $text = '', $isPassword = $false, $h = 24) {
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

function New-CustomButton($text, $x, $y, $w, $h = 30, $style = 'normal') {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text
  $b.Location = New-Object System.Drawing.Point($x, $y)
  $b.Size = New-Object System.Drawing.Size($w, $h)
  $b.FlatStyle = 'Flat'
  $b.Font = $FONT_BOLD
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  if ($style -eq 'gold') {
    $b.BackColor = $C_GOLD
    $b.ForeColor = [System.Drawing.Color]::FromArgb(26, 18, 0)
    $b.FlatAppearance.BorderSize = 0
  } elseif ($style -eq 'danger') {
    $b.BackColor = [System.Drawing.Color]::FromArgb(44, 22, 26)
    $b.ForeColor = $C_RED
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(120, 40, 48)
    $b.FlatAppearance.BorderSize = 1
  } elseif ($style -eq 'nav') {
    $b.BackColor = [System.Drawing.Color]::Transparent
    $b.ForeColor = $C_MUTED
    $b.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $b.FlatAppearance.BorderSize = 0
    $b.Padding = New-Object System.Windows.Forms.Padding(12, 0, 0, 0)
  } else {
    $b.BackColor = $C_CARD
    $b.ForeColor = $C_TEXT
    $b.FlatAppearance.BorderColor = $C_LINE
    $b.FlatAppearance.BorderSize = 1
  }
  return $b
}

function New-CustomListView($x, $y, $w, $h, $columns) {
  $lv = New-Object System.Windows.Forms.ListView
  $lv.Location = New-Object System.Drawing.Point($x, $y)
  $lv.Size = New-Object System.Drawing.Size($w, $h)
  $lv.View = 'Details'
  $lv.FullRowSelect = $true
  $lv.GridLines = $true
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

# ---------- 顶部导航与快捷连接栏 ----------
$topBar = New-Object System.Windows.Forms.Panel
$topBar.Location = New-Object System.Drawing.Point(0, 0)
$topBar.Size = New-Object System.Drawing.Size(1260, 92)
$topBar.Dock = [System.Windows.Forms.DockStyle]::Top
$topBar.BackColor = $C_SURFACE
$form.Controls.Add($topBar)

$topBar.Controls.Add((New-CustomLabel '👑 CHESS & CARDS · GM 运营管理中台' 16 12 340 24 $C_GOLD $FONT_TITLE))
$topBar.Controls.Add((New-CustomLabel '实时桌况透视 · 玩家账本审计 · 宏观调控中心' 16 34 320 18 $C_MUTED))

# 连接参数
$topBar.Controls.Add((New-CustomLabel 'SSH 主机' 360 8 70 16 $C_MUTED))
$txtHost = New-CustomInput 360 26 130
$topBar.Controls.Add($txtHost)

$topBar.Controls.Add((New-CustomLabel '端口' 498 8 40 16 $C_MUTED))
$txtPort = New-CustomInput 498 26 46 '22'
$topBar.Controls.Add($txtPort)

$topBar.Controls.Add((New-CustomLabel '用户名' 552 8 60 16 $C_MUTED))
$txtUser = New-CustomInput 552 26 80 'ubuntu'
$topBar.Controls.Add($txtUser)

$topBar.Controls.Add((New-CustomLabel 'SSH 密码' 640 8 70 16 $C_MUTED))
$txtPass = New-CustomInput 640 26 100 '' $true
$topBar.Controls.Add($txtPass)

$topBar.Controls.Add((New-CustomLabel '站点地址' 748 8 80 16 $C_MUTED))
$txtSite = New-CustomInput 748 26 180 'http://82.157.54.179/lobby'
$topBar.Controls.Add($txtSite)

$topBar.Controls.Add((New-CustomLabel 'GM 口令 (ADMIN_TOKEN)' 936 8 160 16 $C_MUTED))
$txtToken = New-CustomInput 936 26 140 '' $true
$topBar.Controls.Add($txtToken)

# 顶部操作按钮
$btnSaveCfg = New-CustomButton '保存配置' 1084 24 74 26 'normal'
$topBar.Controls.Add($btnSaveCfg)

$btnTestConn = New-CustomButton '⚡ 测试连接' 1164 24 80 26 'gold'
$topBar.Controls.Add($btnTestConn)

$lblConnStatus = New-CustomLabel '● 准备就绪' 360 62 400 18 $C_MUTED
$topBar.Controls.Add($lblConnStatus)

$btnOpenWebGM = New-CustomButton '🌐 打开 Web GM 后台' 860 58 150 26 'gold'
$topBar.Controls.Add($btnOpenWebGM)

$btnOpenLobby = New-CustomButton '🎮 浏览器打开大厅' 1020 58 130 26 'normal'
$topBar.Controls.Add($btnOpenLobby)

$btnRefreshAll = New-CustomButton '🔄 全局刷新' 1160 58 84 26 'normal'
$topBar.Controls.Add($btnRefreshAll)

# ---------- 左侧导航栏 ----------
$leftBar = New-Object System.Windows.Forms.Panel
$leftBar.Location = New-Object System.Drawing.Point(0, 92)
$leftBar.Size = New-Object System.Drawing.Size(200, 720)
$leftBar.Dock = [System.Windows.Forms.DockStyle]::Left
$leftBar.BackColor = $C_SURFACE
$form.Controls.Add($leftBar)

$navButtons = @{}
$navItems = @(
  @{ id = 'dashboard'; text = '📊  大盘总览' },
  @{ id = 'players';   text = '👥  玩家管控与流水' },
  @{ id = 'rooms';     text = '🎲  房间实时透视' },
  @{ id = 'broadcast'; text = '📢  全服广播与公告' },
  @{ id = 'security';  text = '🛡️  安全风控与解限' },
  @{ id = 'ops';       text = '🚀  运维与部署控制' }
)

$btnY = 16
foreach ($item in $navItems) {
  $nb = New-CustomButton $item.text 10 $btnY 180 44 'nav'
  $nb.Font = $FONT_BOLD
  $navButtons[$item.id] = $nb
  $leftBar.Controls.Add($nb)
  $btnY += 50
}

# ---------- 主视口面板 (Card Deck) ----------
$mainDeck = New-Object System.Windows.Forms.Panel
$mainDeck.Location = New-Object System.Drawing.Point(200, 92)
$mainDeck.Size = New-Object System.Drawing.Size(1060, 720)
$mainDeck.Dock = [System.Windows.Forms.DockStyle]::Fill
$mainDeck.BackColor = $C_CANVAS
$form.Controls.Add($mainDeck)

$views = @{}
foreach ($item in $navItems) {
  $v = New-Object System.Windows.Forms.Panel
  $v.Dock = [System.Windows.Forms.DockStyle]::Fill
  $v.BackColor = $C_CANVAS
  $v.Visible = ($item.id -eq 'dashboard')
  $views[$item.id] = $v
  $mainDeck.Controls.Add($v)
}

function Switch-View($targetId) {
  $script:ActiveNav = $targetId
  foreach ($key in $navButtons.Keys) {
    if ($key -eq $targetId) {
      $navButtons[$key].BackColor = [System.Drawing.Color]::FromArgb(40, 245, 197, 66)
      $navButtons[$key].ForeColor = $C_GOLD
    } else {
      $navButtons[$key].BackColor = [System.Drawing.Color]::Transparent
      $navButtons[$key].ForeColor = $C_MUTED
    }
  }
  foreach ($key in $views.Keys) {
    $views[$key].Visible = ($key -eq $targetId)
  }

  if ($targetId -eq 'dashboard') { Refresh-Economy; Refresh-Overview }
  if ($targetId -eq 'players')   { Refresh-Players }
  if ($targetId -eq 'rooms')     { Refresh-Rooms; Get-GameList }
  if ($targetId -eq 'broadcast') { Refresh-Notices }
  if ($targetId -eq 'security')  { Refresh-Events }
}

foreach ($item in $navItems) {
  $id = $item.id
  $navButtons[$id].add_Click({ Switch-View $id })
}

# ================================================================
# VIEW 1: 大盘总览 (Dashboard)
# ================================================================
$vDash = $views['dashboard']

# KPI 卡片容器
$kpiPanel = New-Object System.Windows.Forms.Panel
$kpiPanel.Location = New-Object System.Drawing.Point(16, 16)
$kpiPanel.Size = New-Object System.Drawing.Size(1020, 110)
$kpiPanel.BackColor = [System.Drawing.Color]::Transparent
$vDash.Controls.Add($kpiPanel)

function Create-KpiCard($parent, $x, $y, $w, $h, $title, $sub) {
  $p = New-Object System.Windows.Forms.Panel
  $p.Location = New-Object System.Drawing.Point($x, $y)
  $p.Size = New-Object System.Drawing.Size($w, $h)
  $p.BackColor = $C_SURFACE
  $p.BorderStyle = 'FixedSingle'
  $parent.Controls.Add($p)

  $p.Controls.Add((New-CustomLabel $title 12 10 ($w - 24) 18 $C_MUTED))
  $lblVal = New-CustomLabel '--' 12 32 ($w - 24) 36 $C_TEXT $FONT_BIG
  $p.Controls.Add($lblVal)
  $p.Controls.Add((New-CustomLabel $sub 12 76 ($w - 24) 18 $C_MUTED))
  return $lblVal
}

$lblKpiUsers   = Create-KpiCard $kpiPanel 0   0 160 100 '全服总玩家' '已注册有效账号'
$lblKpiBalance = Create-KpiCard $kpiPanel 172 0 160 100 '筹码流通存量' '玩家金币总额'
$lblKpiBet     = Create-KpiCard $kpiPanel 344 0 160 100 '今日下注流水' '今日累计押注'
$lblKpiSettle  = Create-KpiCard $kpiPanel 516 0 160 100 '今日结算净值' '今日派奖净额'
$lblKpiTip     = Create-KpiCard $kpiPanel 688 0 150 100 '今日荷官打赏' '爱心赠礼总额'
$lblKpiRelief  = Create-KpiCard $kpiPanel 850 0 160 100 '今日救济产出' '破产保护福利'

$lblKpiBalance.ForeColor = $C_GOLD
$lblKpiBet.ForeColor     = $C_BLUE
$lblKpiSettle.ForeColor  = $C_GREEN
$lblKpiTip.ForeColor     = $C_GOLD

# 下半部双栏：今日盈利榜 Top 10 + 实时系统事件
$vDash.Controls.Add((New-CustomLabel '🏆 今日盈利榜 Top 10' 16 136 240 20 $C_GOLD $FONT_BOLD))
$lvWinners = New-CustomListView 16 162 480 440 @(
  @{ name = '名次'; width = 60 },
  @{ name = '玩家昵称'; width = 160 },
  @{ name = '今日净胜筹码'; width = 130 },
  @{ name = '对局局数'; width = 100 }
)
$vDash.Controls.Add($lvWinners)

$vDash.Controls.Add((New-CustomLabel '📡 实时风控与系统动态事件' 512 136 300 20 $C_BLUE $FONT_BOLD))
$txtDashEvents = New-Object System.Windows.Forms.RichTextBox
$txtDashEvents.Location = New-Object System.Drawing.Point(512, 162)
$txtDashEvents.Size = New-Object System.Drawing.Size(524, 440)
$txtDashEvents.BackColor = $C_INPUT
$txtDashEvents.ForeColor = $C_TEXT
$txtDashEvents.BorderStyle = 'FixedSingle'
$txtDashEvents.Font = $FONT_MONO
$txtDashEvents.ReadOnly = $true
$vDash.Controls.Add($txtDashEvents)

# ================================================================
# VIEW 2: 玩家管控与账本 (Players & Ledger)
# ================================================================
$vPlayers = $views['players']

$vPlayers.Controls.Add((New-CustomLabel '按 UID / 昵称 / 账号搜索玩家：' 16 16 220 20 $C_MUTED))
$txtPlayerSearch = New-CustomInput 230 14 260
$vPlayers.Controls.Add($txtPlayerSearch)

$btnPlayerSearch = New-CustomButton '🔍 搜索' 500 12 70 28 'gold'
$vPlayers.Controls.Add($btnPlayerSearch)

$btnPlayerShowAll = New-CustomButton '查看全部' 580 12 80 28 'normal'
$vPlayers.Controls.Add($btnPlayerShowAll)

# 玩家表格 (左)
$lvPlayers = New-CustomListView 16 52 640 580 @(
  @{ name = '昵称'; width = 130 },
  @{ name = '筹码余额'; width = 100 },
  @{ name = '账号'; width = 100 },
  @{ name = '状态'; width = 70 },
  @{ name = 'UID'; width = 110 },
  @{ name = '注册时间'; width = 110 }
)
$vPlayers.Controls.Add($lvPlayers)

# 玩家操作抽屉 (右)
$pPlayerDrawer = New-Object System.Windows.Forms.Panel
$pPlayerDrawer.Location = New-Object System.Drawing.Point(670, 52)
$pPlayerDrawer.Size = New-Object System.Drawing.Size(366, 580)
$pPlayerDrawer.BackColor = $C_SURFACE
$pPlayerDrawer.BorderStyle = 'FixedSingle'
$vPlayers.Controls.Add($pPlayerDrawer)

$pPlayerDrawer.Controls.Add((New-CustomLabel '👤 玩家详细资料' 16 16 200 24 $C_GOLD $FONT_BOLD))
$lblPlayerDetail = New-CustomLabel "请在左侧列表中点击选择一位玩家`r`n以查看详细资料与进行管控。" 16 48 334 110 $C_MUTED
$pPlayerDrawer.Controls.Add($lblPlayerDetail)

# 操作区：封禁/解封
$btnBanPlayer = New-CustomButton '🚫 封禁账号' 16 160 160 32 'danger'
$pPlayerDrawer.Controls.Add($btnBanPlayer)

$btnUnbanPlayer = New-CustomButton '✅ 解封账号' 188 160 160 32 'gold'
$pPlayerDrawer.Controls.Add($btnUnbanPlayer)

# 操作区：修改资料与密码
$btnEditNickname = New-CustomButton '✏️ 修改昵称' 16 204 160 32 'normal'
$pPlayerDrawer.Controls.Add($btnEditNickname)

$btnResetPass = New-CustomButton '🔑 重置登录密码' 188 204 160 32 'normal'
$pPlayerDrawer.Controls.Add($btnResetPass)

# 筹码调整区
$pPlayerDrawer.Controls.Add((New-CustomLabel '💰 增发 / 扣除筹码' 16 250 200 20 $C_GOLD $FONT_BOLD))
$pPlayerDrawer.Controls.Add((New-CustomLabel '金额 (正数增发，负数扣除)：' 16 274 200 18 $C_MUTED))
$txtGrantAmount = New-CustomInput 16 294 332 '10000'
$pPlayerDrawer.Controls.Add($txtGrantAmount)

$pPlayerDrawer.Controls.Add((New-CustomLabel '调整原因备注：' 16 324 200 18 $C_MUTED))
$txtGrantReason = New-CustomInput 16 344 332 'GM 奖励发放'
$pPlayerDrawer.Controls.Add($txtGrantReason)

$btnDoGrant = New-CustomButton '⚡ 执行调账 (幂等安全入账)' 16 376 332 34 'gold'
$pPlayerDrawer.Controls.Add($btnDoGrant)

# 资金账本流水抽屉按钮
$btnViewLedger = New-CustomButton '📜 调阅该玩家资金流水明细账本' 16 430 332 36 'normal'
$pPlayerDrawer.Controls.Add($btnViewLedger)

# ================================================================
# VIEW 3: 房间实时透视与调度 (Rooms Deep Inspector)
# ================================================================
$vRooms = $views['rooms']

$vRooms.Controls.Add((New-CustomLabel '选择游戏筛选：' 16 16 100 20 $C_MUTED))
$cboGameFilter = New-Object System.Windows.Forms.ComboBox
$cboGameFilter.Location = New-Object System.Drawing.Point(120, 14)
$cboGameFilter.Size = New-Object System.Drawing.Size(180, 24)
$cboGameFilter.DropDownStyle = 'DropDownList'
$cboGameFilter.BackColor = $C_INPUT
$cboGameFilter.ForeColor = $C_TEXT
$vRooms.Controls.Add($cboGameFilter)

$btnRefreshRooms = New-CustomButton '🔄 刷新房间' 310 12 90 28 'gold'
$vRooms.Controls.Add($btnRefreshRooms)

$btnDestroyRoom = New-CustomButton '销毁房间' 410 12 80 28 'danger'
$vRooms.Controls.Add($btnDestroyRoom)

# 批量创建平台庄
$vRooms.Controls.Add((New-CustomLabel '创建平台庄房数量：' 510 16 130 20 $C_MUTED))
$numCreateCount = New-Object System.Windows.Forms.NumericUpDown
$numCreateCount.Location = New-Object System.Drawing.Point(644, 14)
$numCreateCount.Size = New-Object System.Drawing.Size(50, 24)
$numCreateCount.BackColor = $C_INPUT
$numCreateCount.ForeColor = $C_TEXT
$numCreateCount.Minimum = 1
$numCreateCount.Maximum = 10
$numCreateCount.Value = 1
$vRooms.Controls.Add($numCreateCount)

$btnCreatePlatform = New-CustomButton '➕ 批量创建平台庄' 704 12 140 28 'gold'
$vRooms.Controls.Add($btnCreatePlatform)

# 房间列表 (左)
$lvRooms = New-CustomListView 16 52 530 580 @(
  @{ name = '房间名称'; width = 130 },
  @{ name = '游戏'; width = 90 },
  @{ name = '人数'; width = 60 },
  @{ name = '状态'; width = 70 },
  @{ name = '类型'; width = 70 },
  @{ name = '房间号'; width = 90 }
)
$vRooms.Controls.Add($lvRooms)

# 实时桌况透视面板 (右)
$pInspectDrawer = New-Object System.Windows.Forms.Panel
$pInspectDrawer.Location = New-Object System.Drawing.Point(560, 52)
$pInspectDrawer.Size = New-Object System.Drawing.Size(476, 580)
$pInspectDrawer.BackColor = $C_SURFACE
$pInspectDrawer.BorderStyle = 'FixedSingle'
$vRooms.Controls.Add($pInspectDrawer)

$pInspectDrawer.Controls.Add((New-CustomLabel '🔍 实时桌况透视与干预' 16 14 200 24 $C_GOLD $FONT_BOLD))
$lblInspectHead = New-CustomLabel "← 点击左侧房间查看内部玩家席位与对局状态" 16 42 440 36 $C_MUTED
$pInspectDrawer.Controls.Add($lblInspectHead)

# 桌内玩家席位列表
$lvInspectPlayers = New-CustomListView 16 80 444 320 @(
  @{ name = '座号'; width = 50 },
  @{ name = '昵称 / 标识'; width = 130 },
  @{ name = '类型'; width = 80 },
  @{ name = '准备'; width = 60 },
  @{ name = '当前得分'; width = 100 }
)
$pInspectDrawer.Controls.Add($lvInspectPlayers)

# 干预控制工具箱
$pInspectDrawer.Controls.Add((New-CustomLabel '🛠️ GM 即时调度干预：' 16 410 160 20 $C_GOLD $FONT_BOLD))

$btnKickPlayer = New-CustomButton '👢 踢出选中玩家' 16 434 130 32 'danger'
$pInspectDrawer.Controls.Add($btnKickPlayer)

$cboBotDiff = New-Object System.Windows.Forms.ComboBox
$cboBotDiff.Location = New-Object System.Drawing.Point(156, 438)
$cboBotDiff.Size = New-Object System.Drawing.Size(90, 24)
$cboBotDiff.DropDownStyle = 'DropDownList'
$cboBotDiff.BackColor = $C_INPUT
$cboBotDiff.ForeColor = $C_TEXT
[void]$cboBotDiff.Items.Add('中级')
[void]$cboBotDiff.Items.Add('初级')
[void]$cboBotDiff.Items.Add('高级')
$cboBotDiff.SelectedIndex = 0
$pInspectDrawer.Controls.Add($cboBotDiff)

$btnAddBot = New-CustomButton '🤖 添加机器人' 254 434 100 32 'gold'
$pInspectDrawer.Controls.Add($btnAddBot)

$btnRemoveBot = New-CustomButton '➖ 移除机器人' 362 434 98 32 'normal'
$pInspectDrawer.Controls.Add($btnRemoveBot)

$btnForceReset = New-CustomButton '🔄 强制流局并全额退款重置房间' 16 480 444 36 'danger'
$pInspectDrawer.Controls.Add($btnForceReset)

# ================================================================
# VIEW 4: 全服广播与公告 (Broadcast & Notices)
# ================================================================
$vBroadcast = $views['broadcast']

$vBroadcast.Controls.Add((New-CustomLabel '📢 全服即时跑马灯广播' 16 16 260 24 $C_GOLD $FONT_BOLD))
$vBroadcast.Controls.Add((New-CustomLabel '推送内容将即时下发至在线所有玩家的大厅跑马灯与牌桌屏幕顶部：' 16 42 500 18 $C_MUTED))
$txtMarquee = New-CustomInput 16 66 700 '' $false 28
$vBroadcast.Controls.Add($txtMarquee)

$btnSendMarquee = New-CustomButton '🚀 即刻全服推送' 726 64 140 30 'gold'
$vBroadcast.Controls.Add($btnSendMarquee)

$vBroadcast.Controls.Add((New-CustomLabel '📜 系统公告管理' 16 116 200 24 $C_GOLD $FONT_BOLD))

# 发布新公告面板 (左)
$pPublishNotice = New-Object System.Windows.Forms.Panel
$pPublishNotice.Location = New-Object System.Drawing.Point(16, 148)
$pPublishNotice.Size = New-Object System.Drawing.Size(320, 480)
$pPublishNotice.BackColor = $C_SURFACE
$pPublishNotice.BorderStyle = 'FixedSingle'
$vBroadcast.Controls.Add($pPublishNotice)

$pPublishNotice.Controls.Add((New-CustomLabel '发布新公告' 16 14 200 20 $C_GOLD $FONT_BOLD))
$pPublishNotice.Controls.Add((New-CustomLabel '标题 (1-40 字)：' 16 42 200 18 $C_MUTED))
$txtNoticeTitle = New-CustomInput 16 64 286
$pPublishNotice.Controls.Add($txtNoticeTitle)

$pPublishNotice.Controls.Add((New-CustomLabel '公告类型：' 16 98 200 18 $C_MUTED))
$cboNoticeKind = New-Object System.Windows.Forms.ComboBox
$cboNoticeKind.Location = New-Object System.Drawing.Point(16, 120)
$cboNoticeKind.Size = New-Object System.Drawing.Size(286, 24)
$cboNoticeKind.DropDownStyle = 'DropDownList'
$cboNoticeKind.BackColor = $C_INPUT
$cboNoticeKind.ForeColor = $C_TEXT
[void]$cboNoticeKind.Items.Add('notice - 普通公告')
[void]$cboNoticeKind.Items.Add('event - 庆典活动')
[void]$cboNoticeKind.Items.Add('maintenance - 系统维护')
$cboNoticeKind.SelectedIndex = 0
$pPublishNotice.Controls.Add($cboNoticeKind)

$pPublishNotice.Controls.Add((New-CustomLabel '公告正文内容：' 16 156 200 18 $C_MUTED))
$txtNoticeBody = New-Object System.Windows.Forms.TextBox
$txtNoticeBody.Location = New-Object System.Drawing.Point(16, 178)
$txtNoticeBody.Size = New-Object System.Drawing.Size(286, 200)
$txtNoticeBody.Multiline = $true
$txtNoticeBody.BackColor = $C_INPUT
$txtNoticeBody.ForeColor = $C_TEXT
$txtNoticeBody.BorderStyle = 'FixedSingle'
$pPublishNotice.Controls.Add($txtNoticeBody)

$btnPublishNotice = New-CustomButton '发布并推送公告' 16 392 286 36 'gold'
$pPublishNotice.Controls.Add($btnPublishNotice)

# 公告列表 (右)
$vBroadcast.Controls.Add((New-CustomLabel '已有有效公告列表：' 350 118 200 20 $C_MUTED))
$btnDeleteNotice = New-CustomButton '下架删除选中公告' 880 112 150 28 'danger'
$vBroadcast.Controls.Add($btnDeleteNotice)

$lvNotices = New-CustomListView 350 148 680 480 @(
  @{ name = '标题'; width = 160 },
  @{ name = '类型'; width = 80 },
  @{ name = '内容正文'; width = 300 },
  @{ name = '发布时间'; width = 120 }
)
$vBroadcast.Controls.Add($lvNotices)

# ================================================================
# VIEW 5: 安全风控与解限中心 (Security & Risk)
# ================================================================
$vSecurity = $views['security']

$vSecurity.Controls.Add((New-CustomLabel '🛡️ 安全风控审计与解限中心' 16 16 260 24 $C_GOLD $FONT_BOLD))
$btnClearLimits = New-CustomButton '🔓 一键清空防暴力限流锁定' 780 14 240 32 'gold'
$vSecurity.Controls.Add($btnClearLimits)

$vSecurity.Controls.Add((New-CustomLabel '当 GM 口令输入错误或账号遭遇防暴力破解机制锁定时，点击上方按钮可立即清空白名单恢复访问。' 16 46 800 18 $C_MUTED))

$txtSecurityEvents = New-Object System.Windows.Forms.RichTextBox
$txtSecurityEvents.Location = New-Object System.Drawing.Point(16, 76)
$txtSecurityEvents.Size = New-Object System.Drawing.Size(1010, 550)
$txtSecurityEvents.BackColor = $C_INPUT
$txtSecurityEvents.ForeColor = $C_TEXT
$txtSecurityEvents.BorderStyle = 'FixedSingle'
$txtSecurityEvents.Font = $FONT_MONO
$txtSecurityEvents.ReadOnly = $true
$vSecurity.Controls.Add($txtSecurityEvents)

# ================================================================
# VIEW 6: 运维与部署控制台 (DevOps & Deploy)
# ================================================================
$vOps = $views['ops']

$vOps.Controls.Add((New-CustomLabel '🚀 远程服务状态与一键部署' 16 16 260 24 $C_GOLD $FONT_BOLD))

$btnDeploy = New-CustomButton '📦 一键云端构建并部署' 16 50 180 34 'gold'
$vOps.Controls.Add($btnDeploy)

$btnRestart = New-CustomButton '🔄 重启远程服务' 206 50 140 34 'danger'
$vOps.Controls.Add($btnRestart)

$btnStatus = New-CustomButton '🔍 检查服务器状态' 356 50 140 34 'normal'
$vOps.Controls.Add($btnStatus)

$txtDeployLog = New-Object System.Windows.Forms.RichTextBox
$txtDeployLog.Location = New-Object System.Drawing.Point(16, 96)
$txtDeployLog.Size = New-Object System.Drawing.Size(1010, 530)
$txtDeployLog.BackColor = $C_INPUT
$txtDeployLog.ForeColor = $C_TEXT
$txtDeployLog.BorderStyle = 'FixedSingle'
$txtDeployLog.Font = $FONT_MONO
$txtDeployLog.ReadOnly = $true
$vOps.Controls.Add($txtDeployLog)

# ---------- 底部状态栏 ----------
$statusStrip = New-Object System.Windows.Forms.StatusStrip
$statusStrip.BackColor = $C_SURFACE
$statusStrip.ForeColor = $C_MUTED
$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Text = '就绪'
$statusStrip.Items.Add($statusLabel) | Out-Null
$form.Controls.Add($statusStrip)

# ---------- 核心网络与业务逻辑 ----------
function Add-LogMsg($box, $text, $kind = 'info') {
  if (-not $text) { return }
  $color = switch ($kind) {
    'err' { $C_RED }
    'ok' { $C_GREEN }
    'gold' { $C_GOLD }
    default { $C_MUTED }
  }
  $stamp = (Get-Date).ToString('HH:mm:ss')
  $box.SelectionStart = $box.TextLength
  $box.SelectionColor = $color
  $box.AppendText("[$stamp] $text`r`n")
  $box.SelectionStart = $box.TextLength
  $box.ScrollToCaret()
}

function Set-TopStatus($text, $isError = $false) {
  $lblConnStatus.Text = $text
  $lblConnStatus.ForeColor = if ($isError) { $C_RED } else { $C_GREEN }
  $statusLabel.Text = $text
}

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
  } catch { }
}

function Save-Config {
  $cfg = [ordered]@{
    host       = $txtHost.Text.Trim()
    port       = $txtPort.Text.Trim()
    username   = $txtUser.Text.Trim()
    password   = $txtPass.Text
    site       = $txtSite.Text.Trim()
    adminToken = $txtToken.Text.Trim()
  }
  ($cfg | ConvertTo-Json) | Set-Content -Path $script:ConfigPath -Encoding UTF8
  Set-TopStatus '配置已保存至 tools/.gm-config.json'
}

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

function Refresh-Economy {
  try {
    $res = Invoke-GmApi '/api/admin/economy'
    $eco = $res.overview
    $lblKpiUsers.Text   = ('{0:N0}' -f [double]$eco.totalUsers)
    $lblKpiBalance.Text = ('{0:N0}' -f [double]$eco.totalBalance)
    $lblKpiBet.Text     = ('{0:N0}' -f [double]$eco.todayBet)
    $lblKpiSettle.Text  = ('{0:N0}' -f [double]$eco.todaySettle)
    $lblKpiTip.Text     = ('{0:N0}' -f [double]$eco.todayTip)
    $lblKpiRelief.Text  = ('{0:N0}' -f [double]$eco.todayRelief)
  } catch { }
}

function Refresh-Overview {
  try {
    $res = Invoke-GmApi '/api/admin/overview'
    $lvWinners.Items.Clear()
    $daily = @($res.daily)
    $idx = 1
    foreach ($d in $daily) {
      $item = New-Object System.Windows.Forms.ListViewItem("#$idx")
      [void]$item.SubItems.Add([string]$d.nickname)
      [void]$item.SubItems.Add(('{0:N0}' -f [double]$d.net))
      [void]$item.SubItems.Add("$($d.rounds) 局")
      [void]$lvWinners.Items.Add($item)
      $idx += 1
    }
    Set-TopStatus "大盘已更新 · 活跃房间 $($res.summary.rooms) · 在线玩家 $($res.summary.humans)"
  } catch {
    Set-TopStatus "拉取总览失败: $($_.Exception.Message)" $true
  }
}

function Refresh-Players {
  try {
    $k = $txtPlayerSearch.Text.Trim()
    $res = Invoke-GmApi "/api/admin/players?q=$([uri]::EscapeDataString($k))"
    $script:Players = @($res.players)
    $lvPlayers.Items.Clear()
    foreach ($p in $script:Players) {
      $item = New-Object System.Windows.Forms.ListViewItem([string]$p.nickname)
      [void]$item.SubItems.Add(('{0:N0}' -f [double]$p.balance))
      [void]$item.SubItems.Add([string]$p.username)
      $status = if ($p.banned) { '🚫 封禁' } else { '正常' }
      [void]$item.SubItems.Add($status)
      [void]$item.SubItems.Add([string]$p.userId.Substring(0, 8))
      $time = if ($p.createdAt) { ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$p.createdAt)).LocalDateTime.ToString('yyyy-MM-dd') } else { '-' }
      [void]$item.SubItems.Add($time)
      $item.Tag = $p
      [void]$lvPlayers.Items.Add($item)
    }
  } catch {
    Set-TopStatus "刷新玩家失败: $($_.Exception.Message)" $true
  }
}

function Refresh-Rooms {
  try {
    $gameId = ''
    if ($cboGameFilter.SelectedItem -and $cboGameFilter.SelectedItem -ne '全部游戏') {
      $gameId = ($cboGameFilter.SelectedItem -split ' ')[0]
    }
    $path = if ($gameId) { "/api/admin/rooms?gameId=$gameId" } else { '/api/admin/rooms' }
    $res = Invoke-GmApi $path
    $script:Rooms = @($res.rooms)
    $lvRooms.Items.Clear()
    foreach ($r in $script:Rooms) {
      $item = New-Object System.Windows.Forms.ListViewItem([string]$r.roomName)
      [void]$item.SubItems.Add([string]$r.gameId)
      [void]$item.SubItems.Add("$($r.players)/$($r.maxPlayers)")
      [void]$item.SubItems.Add([string]$r.status)
      [void]$item.SubItems.Add($(if ($r.persistent) { '平台庄' } else { '玩家房' }))
      [void]$item.SubItems.Add([string]$r.roomId.Substring(0, 8))
      $item.Tag = $r
      [void]$lvRooms.Items.Add($item)
    }
  } catch {
    Set-TopStatus "刷新房间失败: $($_.Exception.Message)" $true
  }
}

function Inspect-Room($roomId) {
  try {
    $res = Invoke-GmApi "/api/admin/rooms/$roomId/detail"
    $r = $res.room
    $lblInspectHead.Text = "房间: $($r.roomId)`r`n游戏: $($r.gameId) · 局数: 第 $($r.round) 局 · 行动者: $($r.currentActor)"
    $lvInspectPlayers.Items.Clear()
    foreach ($p in @($r.players)) {
      $item = New-Object System.Windows.Forms.ListViewItem("#$($p.seat)")
      [void]$item.SubItems.Add([string]$p.nickname)
      $type = if ($p.isBot) { "🤖 $($p.botDifficulty)" } else { "👤 真人" }
      [void]$item.SubItems.Add($type)
      $ready = if ($p.ready) { '已准备' } else { '等待' }
      [void]$item.SubItems.Add($ready)
      [void]$item.SubItems.Add(('{0:N0}' -f [double]$p.score))
      $item.Tag = $p
      [void]$lvInspectPlayers.Items.Add($item)
    }
  } catch {
    $lblInspectHead.Text = "透视失败: $($_.Exception.Message)"
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
      $time = ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$n.createdAt)).LocalDateTime.ToString('MM-dd HH:mm')
      [void]$item.SubItems.Add($time)
      $item.Tag = $n
      [void]$lvNotices.Items.Add($item)
    }
  } catch { }
}

function Refresh-Events {
  try {
    $res = Invoke-GmApi '/api/admin/events?limit=80'
    $txtSecurityEvents.Clear()
    $txtDashEvents.Clear()
    foreach ($e in @($res.events)) {
      $time = ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$e.timestamp)).LocalDateTime.ToString('HH:mm:ss')
      $kind = if ($e.level -eq 'warn') { 'err' } elseif ($e.level -eq 'info') { 'ok' } else { 'gold' }
      Add-LogMsg $txtSecurityEvents "[$time] [$($e.category.ToUpper())] $($e.message)" $kind
      Add-LogMsg $txtDashEvents "[$time] [$($e.category.ToUpper())] $($e.message)" $kind
    }
  } catch { }
}

function Get-GameList {
  try {
    $res = Invoke-GmApi '/api/admin/overview'
    $cboGameFilter.Items.Clear()
    [void]$cboGameFilter.Items.Add('全部游戏')
    foreach ($g in @($res.games)) {
      [void]$cboGameFilter.Items.Add("$($g.gameId) - $($g.title)")
    }
    $cboGameFilter.SelectedIndex = 0
  } catch { }
}

# ---------- 事件监听绑定 ----------
$btnSaveCfg.add_Click({ Save-Config })
$btnTestConn.add_Click({
  try {
    Save-Config
    Refresh-Economy
    Refresh-Overview
    Set-TopStatus '● 连通成功！API 与房间服务正常响应'
  } catch {
    Set-TopStatus "连接失败: $($_.Exception.Message)" $true
  }
})
$btnRefreshAll.add_Click({
  Refresh-Economy
  Refresh-Overview
  Refresh-Players
  Refresh-Rooms
  Refresh-Notices
  Refresh-Events
})

$btnOpenWebGM.add_Click({
  $webPath = Join-Path $script:Root 'tools\web-admin\index.html'
  if (Test-Path $webPath) {
    Start-Process $webPath
  }
})

$btnOpenLobby.add_Click({
  $site = $txtSite.Text.Trim()
  if ($site) { Start-Process $site }
})

# 玩家点击与操作
$lvPlayers.add_SelectedIndexChanged({
  if ($lvPlayers.SelectedItems.Count -eq 0) { return }
  $p = $lvPlayers.SelectedItems[0].Tag
  $statusText = if ($p.banned) { '🚫 已封禁' } else { '✅ 正常' }
  $lblPlayerDetail.Text = "玩家昵称：$($p.nickname)`r`n登录账号：$($p.username)`r`n筹码余额：$('{0:N0}' -f [double]$p.balance)`r`n账号状态：$statusText`r`n玩家 UID：`r`n$($p.userId)"
})

$btnPlayerSearch.add_Click({ Refresh-Players })
$btnPlayerShowAll.add_Click({ $txtPlayerSearch.Text = ''; Refresh-Players })

$btnBanPlayer.add_Click({
  if ($lvPlayers.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先在列表中选中一位玩家'); return }
  $p = $lvPlayers.SelectedItems[0].Tag
  if ([System.Windows.Forms.MessageBox]::Show("确认封禁玩家 $($p.nickname)？", '封禁确认', 'YesNo', 'Warning') -ne 'Yes') { return }
  try {
    Invoke-GmApi "/api/admin/players/$($p.userId)/status" 'POST' @{ banned = $true } | Out-Null
    Set-TopStatus "已成功封禁玩家 $($p.nickname)"
    Refresh-Players
  } catch {
    [System.Windows.Forms.MessageBox]::Show("封禁失败: $($_.Exception.Message)")
  }
})

$btnUnbanPlayer.add_Click({
  if ($lvPlayers.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先在列表中选中一位玩家'); return }
  $p = $lvPlayers.SelectedItems[0].Tag
  try {
    Invoke-GmApi "/api/admin/players/$($p.userId)/status" 'POST' @{ banned = $false } | Out-Null
    Set-TopStatus "已成功解封玩家 $($p.nickname)"
    Refresh-Players
  } catch {
    [System.Windows.Forms.MessageBox]::Show("解封失败: $($_.Exception.Message)")
  }
})

$btnEditNickname.add_Click({
  if ($lvPlayers.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先在列表中选中一位玩家'); return }
  $p = $lvPlayers.SelectedItems[0].Tag
  $newNick = [Microsoft.VisualBasic.Interaction]::InputBox("请输入玩家 $($p.nickname) 的新昵称：", '修改玩家昵称', $p.nickname)
  if (-not $newNick -or $newNick.Trim().Length -lt 2) { return }
  try {
    Invoke-GmApi "/api/admin/players/$($p.userId)/update" 'POST' @{ nickname = $newNick.Trim() } | Out-Null
    Set-TopStatus "玩家昵称已更新为 $newNick"
    Refresh-Players
  } catch {
    [System.Windows.Forms.MessageBox]::Show("更新昵称失败: $($_.Exception.Message)")
  }
})

$btnResetPass.add_Click({
  if ($lvPlayers.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先在列表中选中一位玩家'); return }
  $p = $lvPlayers.SelectedItems[0].Tag
  $newPass = [Microsoft.VisualBasic.Interaction]::InputBox("请输入玩家 $($p.nickname) 的新登录密码 (6-32 位)：", '重置密码', '')
  if (-not $newPass -or $newPass.Length -lt 6) { return }
  try {
    Invoke-GmApi "/api/admin/players/$($p.userId)/reset-password" 'POST' @{ newPassword = $newPass } | Out-Null
    [System.Windows.Forms.MessageBox]::Show("玩家 $($p.nickname) 的登录密码已重置成功！", '重置成功', 'OK', 'Information')
  } catch {
    [System.Windows.Forms.MessageBox]::Show("重置密码失败: $($_.Exception.Message)")
  }
})

$btnDoGrant.add_Click({
  if ($lvPlayers.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先在列表中选中一位玩家'); return }
  $p = $lvPlayers.SelectedItems[0].Tag
  $amount = [int]$txtGrantAmount.Text
  if ($amount -eq 0) { [System.Windows.Forms.MessageBox]::Show('金额不能为 0'); return }
  try {
    $idempotencyKey = "gui_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())_$([Guid]::NewGuid().ToString().Substring(0, 8))"
    $res = Invoke-GmApi '/api/admin/grant' 'POST' @{
      userId = $p.userId
      amount = $amount
      reason = $txtGrantReason.Text
      idempotencyKey = $idempotencyKey
    }
    Set-TopStatus "已为 $($res.nickname) 调整 $amount，最新余额 $('{0:N0}' -f [double]$res.balance)"
    Refresh-Players
  } catch {
    [System.Windows.Forms.MessageBox]::Show("调账失败: $($_.Exception.Message)")
  }
})

# 玩家流水明细弹窗
$btnViewLedger.add_Click({
  if ($lvPlayers.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先在列表中选中一位玩家'); return }
  $p = $lvPlayers.SelectedItems[0].Tag
  try {
    $res = Invoke-GmApi "/api/admin/players/$($p.userId)/ledger?limit=100"
    $rows = @($res.ledger)
    $dlg = New-Object System.Windows.Forms.Form
    $dlg.Text = "📜 资金账本流水明细 · $($p.nickname) ($($p.userId))"
    $dlg.Size = New-Object System.Drawing.Size(860, 560)
    $dlg.StartPosition = 'CenterParent'
    $dlg.BackColor = $C_CANVAS
    $dlg.ForeColor = $C_TEXT
    $dlg.Font = $FONT_UI

    $lvL = New-CustomListView 16 16 812 480 @(
      @{ name = '发生时间'; width = 140 },
      @{ name = '业务类型'; width = 120 },
      @{ name = '变动 Delta'; width = 100 },
      @{ name = '变动后结余'; width = 110 },
      @{ name = '关联业务单号 (BizId)'; width = 310 }
    )
    foreach ($r in $rows) {
      $time = ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$r.createdAt)).LocalDateTime.ToString('yyyy-MM-dd HH:mm:ss')
      $item = New-Object System.Windows.Forms.ListViewItem($time)
      [void]$item.SubItems.Add([string]$r.bizType)
      $deltaStr = if ($r.delta -ge 0) { "+$('{0:N0}' -f [double]$r.delta)" } else { ('{0:N0}' -f [double]$r.delta) }
      [void]$item.SubItems.Add($deltaStr)
      [void]$item.SubItems.Add(('{0:N0}' -f [double]$r.balanceAfter))
      [void]$item.SubItems.Add([string]$r.bizId)
      [void]$lvL.Items.Add($item)
    }
    $dlg.Controls.Add($lvL)
    $dlg.ShowDialog($form) | Out-Null
  } catch {
    [System.Windows.Forms.MessageBox]::Show("拉取账本失败: $($_.Exception.Message)")
  }
})

# 房间实时透视与干预
$lvRooms.add_SelectedIndexChanged({
  if ($lvRooms.SelectedItems.Count -eq 0) { return }
  $r = $lvRooms.SelectedItems[0].Tag
  Inspect-Room $r.roomId
})

$btnRefreshRooms.add_Click({ Refresh-Rooms })
$cboGameFilter.add_SelectedIndexChanged({ Refresh-Rooms })

$btnCreatePlatform.add_Click({
  $sel = [string]$cboGameFilter.SelectedItem
  if (-not $sel -or $sel -eq '全部游戏') { [System.Windows.Forms.MessageBox]::Show('请先选择具体游戏品类'); return }
  $gameId = ($sel -split ' - ')[0].Trim()
  $count = [int]$numCreateCount.Value
  try {
    $res = Invoke-GmApi '/api/admin/rooms' 'POST' @{ gameId = $gameId; count = $count }
    Set-TopStatus "已成功创建 $($res.created.Count) 间 $gameId 平台庄房间"
    Refresh-Rooms
  } catch {
    [System.Windows.Forms.MessageBox]::Show("创建房间失败: $($_.Exception.Message)")
  }
})

$btnDestroyRoom.add_Click({
  if ($lvRooms.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先选中一间房'); return }
  $r = $lvRooms.SelectedItems[0].Tag
  if ([System.Windows.Forms.MessageBox]::Show("确认销毁房间 $($r.roomName)？", '销毁确认', 'YesNo', 'Warning') -ne 'Yes') { return }
  try {
    Invoke-GmApi "/api/admin/rooms/$($r.roomId)" 'DELETE' | Out-Null
    Set-TopStatus "已销毁房间 $($r.roomId)"
    Refresh-Rooms
  } catch {
    [System.Windows.Forms.MessageBox]::Show("销毁失败: $($_.Exception.Message)")
  }
})

$btnKickPlayer.add_Click({
  if ($lvRooms.SelectedItems.Count -eq 0) { return }
  $r = $lvRooms.SelectedItems[0].Tag
  if ($lvInspectPlayers.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先在座席列表中选中一位玩家'); return }
  $p = $lvInspectPlayers.SelectedItems[0].Tag
  try {
    Invoke-GmApi "/api/admin/rooms/$($r.roomId)/kick" 'POST' @{ playerId = $p.playerId } | Out-Null
    Set-TopStatus "已从房间 $($r.roomId) 踢出玩家 $($p.nickname)"
    Inspect-Room $r.roomId
  } catch {
    [System.Windows.Forms.MessageBox]::Show("踢人失败: $($_.Exception.Message)")
  }
})

$btnAddBot.add_Click({
  if ($lvRooms.SelectedItems.Count -eq 0) { return }
  $r = $lvRooms.SelectedItems[0].Tag
  $diffMap = @{ '初级' = 'low'; '中级' = 'medium'; '高级' = 'high' }
  $diff = $diffMap[[string]$cboBotDiff.SelectedItem]
  try {
    Invoke-GmApi "/api/admin/rooms/$($r.roomId)/bot" 'POST' @{ action = 'add'; difficulty = $diff } | Out-Null
    Set-TopStatus "已向房间 $($r.roomId) 添加机器人"
    Inspect-Room $r.roomId
  } catch {
    [System.Windows.Forms.MessageBox]::Show("添加机器人失败: $($_.Exception.Message)")
  }
})

$btnRemoveBot.add_Click({
  if ($lvRooms.SelectedItems.Count -eq 0) { return }
  $r = $lvRooms.SelectedItems[0].Tag
  try {
    Invoke-GmApi "/api/admin/rooms/$($r.roomId)/bot" 'POST' @{ action = 'remove' } | Out-Null
    Set-TopStatus "已从房间 $($r.roomId) 移除机器人"
    Inspect-Room $r.roomId
  } catch {
    [System.Windows.Forms.MessageBox]::Show("移除机器人失败: $($_.Exception.Message)")
  }
})

$btnForceReset.add_Click({
  if ($lvRooms.SelectedItems.Count -eq 0) { return }
  $r = $lvRooms.SelectedItems[0].Tag
  if ([System.Windows.Forms.MessageBox]::Show("【警告】强制流局将退还本局所有已下注筹码并重置房间状态，确认继续？", '强制流局退款', 'YesNo', 'Warning') -ne 'Yes') { return }
  try {
    Invoke-GmApi "/api/admin/rooms/$($r.roomId)/reset" 'POST' | Out-Null
    Set-TopStatus "房间 $($r.roomId) 已成功强制流局退款重置"
    Inspect-Room $r.roomId
  } catch {
    [System.Windows.Forms.MessageBox]::Show("重置失败: $($_.Exception.Message)")
  }
})

# 全服跑马灯与公告
$btnSendMarquee.add_Click({
  $msg = $txtMarquee.Text.Trim()
  if (-not $msg) { [System.Windows.Forms.MessageBox]::Show('请输入跑马灯广播内容'); return }
  try {
    $res = Invoke-GmApi '/api/admin/broadcast' 'POST' @{ text = $msg }
    Set-TopStatus "跑马灯已成功广播至在线 $($res.sentCount) 个客户端！"
    $txtMarquee.Text = ''
  } catch {
    [System.Windows.Forms.MessageBox]::Show("广播失败: $($_.Exception.Message)")
  }
})

$btnPublishNotice.add_Click({
  $title = $txtNoticeTitle.Text.Trim()
  $body = $txtNoticeBody.Text.Trim()
  if (-not $title -or -not $body) { [System.Windows.Forms.MessageBox]::Show('标题和正文均不能为空'); return }
  $kind = ([string]$cboNoticeKind.SelectedItem -split ' - ')[0]
  try {
    Invoke-GmApi '/api/admin/announcements' 'POST' @{ title = $title; content = $body; kind = $kind } | Out-Null
    Set-TopStatus "公告已成功发布：$title"
    $txtNoticeTitle.Text = ''
    $txtNoticeBody.Text = ''
    Refresh-Notices
  } catch {
    [System.Windows.Forms.MessageBox]::Show("发布失败: $($_.Exception.Message)")
  }
})

$btnDeleteNotice.add_Click({
  if ($lvNotices.SelectedItems.Count -eq 0) { [System.Windows.Forms.MessageBox]::Show('请先选中一条公告'); return }
  $n = $lvNotices.SelectedItems[0].Tag
  if ([System.Windows.Forms.MessageBox]::Show("确认删除公告 $($n.title)？", '删除确认', 'YesNo') -ne 'Yes') { return }
  try {
    Invoke-GmApi "/api/admin/announcements/$($n.id)" 'DELETE' | Out-Null
    Set-TopStatus "已删除公告 $($n.title)"
    Refresh-Notices
  } catch {
    [System.Windows.Forms.MessageBox]::Show("删除失败: $($_.Exception.Message)")
  }
})

# 安全解限
$btnClearLimits.add_Click({
  try {
    $res = Invoke-GmApi '/api/admin/security/clear-limits' 'POST'
    [System.Windows.Forms.MessageBox]::Show($res.message, '限流重置成功', 'OK', 'Information')
    Refresh-Events
  } catch {
    [System.Windows.Forms.MessageBox]::Show("清空限流失败: $($_.Exception.Message)")
  }
})

# 运维与外部任务
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
          $kind = switch ($obj.kind) { 'err' { 'err' } 'ok' { 'ok' } default { 'gold' } }
          Add-LogMsg $txtDeployLog $obj.text $kind
        } catch {
          Add-LogMsg $txtDeployLog $trim
        }
      }
    } catch { }
  }

  if ($script:Proc -and $script:Proc.HasExited) {
    $script:Timer.Stop()
    $script:Proc = $null
    Set-TopStatus '外部任务执行完毕'
    $btnDeploy.Enabled = $true
    $btnRestart.Enabled = $true
    $btnStatus.Enabled = $true
  }
})

function Invoke-ExternalOps($action) {
  if ($script:Proc -and -not $script:Proc.HasExited) {
    [System.Windows.Forms.MessageBox]::Show('已有部署任务在执行，请稍候'); return
  }
  if (-not $txtHost.Text.Trim() -or -not $txtUser.Text.Trim() -or -not $txtPass.Text) {
    [System.Windows.Forms.MessageBox]::Show('请先在顶部填写 SSH 主机、用户名与密码'); return
  }
  Save-Config
  if (Test-Path $script:ProcLog) { Remove-Item $script:ProcLog -Force -ErrorAction SilentlyContinue }
  $script:LogOffset = 0
  $txtDeployLog.Clear()

  $nodeArgs = @(
    (Join-Path $script:Root 'tools\gm-cli.mjs'),
    $action,
    '--host', $txtHost.Text.Trim(),
    '--port', $txtPort.Text.Trim(),
    '--user', $txtUser.Text.Trim(),
    '--pass', $txtPass.Text,
    '--dir', '/opt/chess-and-cards'
  )

  $btnDeploy.Enabled = $false
  $btnRestart.Enabled = $false
  $btnStatus.Enabled = $false
  Set-TopStatus "正在执行云端运维: $action"

  $script:Proc = Start-Process -FilePath 'node' -ArgumentList $nodeArgs `
    -WorkingDirectory $script:Root -NoNewWindow -PassThru `
    -RedirectStandardOutput $script:ProcLog `
    -RedirectStandardError "$script:ProcLog.err"

  Switch-View 'ops'
  $script:Timer.Start()
}

$btnDeploy.add_Click({ Invoke-ExternalOps 'deploy' })
$btnRestart.add_Click({ Invoke-ExternalOps 'restart' })
$btnStatus.add_Click({ Invoke-ExternalOps 'status' })

# ---------- 启动初始化 ----------
Load-Config
Switch-View 'dashboard'
[void]$form.ShowDialog()
