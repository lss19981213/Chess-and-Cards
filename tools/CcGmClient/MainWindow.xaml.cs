using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using CcGmClient.Models;
using CcGmClient.Services;

namespace CcGmClient
{
    public partial class MainWindow : Window
    {
        private readonly GmApiClient _api = new();
        private GmConfig _config = new();
        private readonly DispatcherTimer _timer = new();
        private string _activeView = "dashboard";
        private PlayerItem? _selectedPlayer;
        private RoomItem? _selectedRoom;

        public MainWindow()
        {
            InitializeComponent();
            Loaded += MainWindow_Loaded;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            _config = GmConfig.Load();

            CmbServerUrl.ItemsSource = new List<string>
            {
                "http://82.157.54.179",
                "http://127.0.0.1:3000",
                "http://localhost:3000"
            };
            CmbServerUrl.Text = !string.IsNullOrEmpty(_config.ServerUrl) ? _config.ServerUrl : "http://82.157.54.179";
            TxtAdminToken.Password = !string.IsNullOrEmpty(_config.AdminToken) ? _config.AdminToken : "2f6f6fe8e5cced301026985a44a26192fcf1b6f1cf2ef218";

            TxtSshHost.Text = _config.Host;
            TxtSshPort.Text = _config.Port;
            TxtSshUser.Text = _config.Username;
            TxtSshPass.Password = _config.Password;

            _timer.Interval = TimeSpan.FromSeconds(10);
            _timer.Tick += async (_, _) =>
            {
                if (ChkAutoRefresh.IsChecked == true)
                {
                    await RefreshCurrentViewAsync(silent: true);
                }
            };
            _timer.Start();

            await ConnectServerAsync();
        }

        // ==================== 快捷切换服务器 ====================
        private async void BtnSwitchCloud_Click(object sender, RoutedEventArgs e)
        {
            CmbServerUrl.Text = "http://82.157.54.179";
            await ConnectServerAsync();
        }

        private async void BtnSwitchLocal_Click(object sender, RoutedEventArgs e)
        {
            CmbServerUrl.Text = "http://127.0.0.1:3000";
            await ConnectServerAsync();
        }

        private string GetServerUrl()
        {
            var text = CmbServerUrl.Text?.Trim();
            if (!string.IsNullOrEmpty(text) && !text.Contains("ComboBoxItem")) return text;
            if (CmbServerUrl.SelectedItem is string s && !string.IsNullOrEmpty(s)) return s;
            return !string.IsNullOrEmpty(_config.ServerUrl) ? _config.ServerUrl : "http://82.157.54.179";
        }

        private void SetConnectedState(bool isConnected, long latencyMs = 0, string? err = null)
        {
            if (isConnected)
            {
                DotConn.Fill = (SolidColorBrush)FindResource("BrushGreen");
                TxtConnStatus.Text = latencyMs > 0 ? $"已连接 ({latencyMs}ms)" : "已连接";
                TxtConnStatus.Foreground = (SolidColorBrush)FindResource("BrushGreen");
                BadgeConnStatus.BorderBrush = (SolidColorBrush)FindResource("BrushGreen");
            }
            else
            {
                DotConn.Fill = (SolidColorBrush)FindResource("BrushRed");
                TxtConnStatus.Text = "未连接";
                TxtConnStatus.Foreground = (SolidColorBrush)FindResource("BrushRed");
                BadgeConnStatus.BorderBrush = (SolidColorBrush)FindResource("BrushRed");
                if (!string.IsNullOrEmpty(err))
                {
                    SetStatus($"未连接: {err}");
                }
            }
        }

        // ==================== 窗口标题栏控制 ====================
        private void BtnMinimize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState.Minimized;
        }

        private void BtnMaximize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }

        private void BtnOpenLobby_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var serverUrl = GetServerUrl();
                var site = !string.IsNullOrEmpty(_config.Site) ? _config.Site : $"{serverUrl.TrimEnd('/')}/lobby";
                Process.Start(new ProcessStartInfo(site) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show($"打开浏览器失败: {ex.Message}", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        // ==================== 服务连接与鉴权 ====================
        private async void BtnConnect_Click(object sender, RoutedEventArgs e)
        {
            await ConnectServerAsync();
        }

        private async Task ConnectServerAsync()
        {
            var url = GetServerUrl();
            var token = TxtAdminToken.Password.Trim();

            _api.Configure(url, token);
            _config.ServerUrl = url;
            _config.AdminToken = token;
            _config.Save();

            TxtConnStatus.Text = "连接中...";
            TxtConnStatus.Foreground = (SolidColorBrush)FindResource("BrushGold");
            DotConn.Fill = (SolidColorBrush)FindResource("BrushGold");
            BadgeConnStatus.BorderBrush = (SolidColorBrush)FindResource("BrushGold");

            try
            {
                var sw = Stopwatch.StartNew();
                await _api.GetOverviewAsync();
                sw.Stop();

                SetConnectedState(true, sw.ElapsedMilliseconds);
                SetStatus($"成功连接到 {url}，响应时间 {sw.ElapsedMilliseconds}ms");

                await RefreshCurrentViewAsync();
            }
            catch (Exception ex)
            {
                SetConnectedState(false, 0, ex.Message);
            }
        }

        private void SetStatus(string msg)
        {
            TxtBottomStatus.Text = msg;
            TxtLastRefreshTime.Text = DateTime.Now.ToString("HH:mm:ss");
        }

        // ==================== 视图切换 ====================
        private async void Nav_Checked(object sender, RoutedEventArgs e)
        {
            if (sender is not RadioButton rb || rb.Tag is not string tag) return;

            _activeView = tag;

            ViewDashboard.Visibility = tag == "dashboard" ? Visibility.Visible : Visibility.Collapsed;
            ViewPlayers.Visibility = tag == "players" ? Visibility.Visible : Visibility.Collapsed;
            ViewRooms.Visibility = tag == "rooms" ? Visibility.Visible : Visibility.Collapsed;
            ViewMailbox.Visibility = tag == "mailbox" ? Visibility.Visible : Visibility.Collapsed;
            ViewBroadcast.Visibility = tag == "broadcast" ? Visibility.Visible : Visibility.Collapsed;
            ViewSecurity.Visibility = tag == "security" ? Visibility.Visible : Visibility.Collapsed;
            ViewDevOps.Visibility = tag == "devops" ? Visibility.Visible : Visibility.Collapsed;

            TxtCurrentViewTitle.Text = tag switch
            {
                "dashboard" => "📊 大盘总览与经济流动",
                "players" => "👥 玩家管控与流水审计",
                "rooms" => "🎲 房间实时透视与博弈管控",
                "mailbox" => "📬 全服邮箱发放与筹码直赠",
                "broadcast" => "📢 即时跑马灯与系统公告",
                "security" => "🛡️ 安全风控机制与解限",
                "devops" => "🚀 运维诊断与远程持续部署",
                _ => "GM 运营中台"
            };

            await RefreshCurrentViewAsync();
        }

        private async void BtnRefreshCurrent_Click(object sender, RoutedEventArgs e)
        {
            await RefreshCurrentViewAsync();
        }

        private void ChkAutoRefresh_Changed(object sender, RoutedEventArgs e)
        {
            TxtAutoRefreshBadge.Visibility = ChkAutoRefresh.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        }

        private async Task RefreshCurrentViewAsync(bool silent = false)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                switch (_activeView)
                {
                    case "dashboard":
                        await RefreshDashboardAsync();
                        break;
                    case "players":
                        await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
                        break;
                    case "rooms":
                        await RefreshRoomsAsync();
                        break;
                    case "mailbox":
                        await RefreshMailsAsync();
                        break;
                    case "broadcast":
                        await RefreshAnnouncementsAsync();
                        break;
                    case "security":
                        await RefreshSecurityEventsAsync();
                        break;
                    case "devops":
                        break;
                }
                sw.Stop();
                SetConnectedState(true, sw.ElapsedMilliseconds);
                if (!silent) SetStatus($"模块 {_activeView} 数据已刷新 ({sw.ElapsedMilliseconds}ms)");
            }
            catch (Exception ex)
            {
                sw.Stop();
                SetConnectedState(false, 0, ex.Message);
                if (!silent) SetStatus($"刷新失败: {ex.Message}");
            }
        }

        // ==================== 批量创建账号对话框 ====================
        private void BtnOpenBatchPlayersModal_Click(object sender, RoutedEventArgs e)
        {
            PanelBatchPlayersForm.Visibility = Visibility.Visible;
            PanelBatchPlayersResult.Visibility = Visibility.Collapsed;
            BtnCancelBatchPlayers.Visibility = Visibility.Visible;
            BtnExecuteBatchPlayers.Visibility = Visibility.Visible;
            BtnCopyBatchPlayers.Visibility = Visibility.Collapsed;
            BtnDoneBatchPlayers.Visibility = Visibility.Collapsed;
            ModalBatchPlayers.Visibility = Visibility.Visible;
        }

        private void BtnCloseBatchPlayersModal_Click(object sender, RoutedEventArgs e)
        {
            ModalBatchPlayers.Visibility = Visibility.Collapsed;
        }

        private void BtnBatchCountFast_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string s)
                TxtBatchPlayerCount.Text = s;
        }

        private void BtnBatchCoinsFast_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string s)
                TxtBatchPlayerCoins.Text = s;
        }

        private List<CreatedAccountItem> _lastCreatedAccounts = new();

        private async void BtnExecuteBatchPlayers_Click(object sender, RoutedEventArgs e)
        {
            var prefix = TxtBatchPlayerPrefix.Text.Trim();
            if (string.IsNullOrEmpty(prefix)) prefix = "user_";
            var nickPrefix = TxtBatchPlayerNickPrefix.Text.Trim();
            if (string.IsNullOrEmpty(nickPrefix)) nickPrefix = "牌友_";
            var pass = TxtBatchPlayerPassword.Text.Trim();
            if (pass.Length < 6)
            {
                MessageBox.Show("密码长度不能少于 6 位", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (!int.TryParse(TxtBatchPlayerCount.Text.Trim(), out var count) || count < 1 || count > 50)
            {
                MessageBox.Show("生成数量需在 1 到 50 之间", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (!long.TryParse(TxtBatchPlayerCoins.Text.Trim(), out var coins) || coins < 0)
            {
                MessageBox.Show("初始筹码需为非负数", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                BtnExecuteBatchPlayers.IsEnabled = false;
                BtnExecuteBatchPlayers.Content = "生成中...";

                var res = await _api.BatchCreatePlayersAsync(prefix, nickPrefix, pass, count, coins);
                _lastCreatedAccounts = res.Accounts;

                TxtBatchSuccessSummary.Text = $"🎉 成功创建 {res.Count} 个新账号！(初始每人 {coins:N0} 欢乐豆)";
                DgBatchCreatedAccounts.ItemsSource = res.Accounts;

                PanelBatchPlayersForm.Visibility = Visibility.Collapsed;
                PanelBatchPlayersResult.Visibility = Visibility.Visible;
                BtnCancelBatchPlayers.Visibility = Visibility.Collapsed;
                BtnExecuteBatchPlayers.Visibility = Visibility.Collapsed;
                BtnCopyBatchPlayers.Visibility = Visibility.Visible;
                BtnDoneBatchPlayers.Visibility = Visibility.Visible;

                SetStatus($"成功批量创建了 {res.Count} 个玩家账号");
                await RefreshPlayersAsync("");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"批量创建账号失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                BtnExecuteBatchPlayers.IsEnabled = true;
                BtnExecuteBatchPlayers.Content = "🚀 开始批量生成";
            }
        }

        private void BtnCopyBatchPlayers_Click(object sender, RoutedEventArgs e)
        {
            if (_lastCreatedAccounts.Count == 0) return;
            var text = string.Join("\r\n", _lastCreatedAccounts.Select(a => $"账号: {a.Username}  密码: {a.InitialPassword}  昵称: {a.Nickname}  筹码: {a.Balance:N0}  UID: {a.UserId}"));
            Clipboard.SetText(text);
            MessageBox.Show($"已复制 {_lastCreatedAccounts.Count} 个账号信息至剪贴板！", "复制成功", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        private void BtnDoneBatchPlayers_Click(object sender, RoutedEventArgs e)
        {
            ModalBatchPlayers.Visibility = Visibility.Collapsed;
        }

        // ==================== 1. 大盘总览 (Dashboard) ====================
        private async Task RefreshDashboardAsync()
        {
            var overviewTask = _api.GetOverviewAsync();
            var economyTask = _api.GetEconomyAsync();
            var eventsTask = _api.GetEventsAsync(60);

            await Task.WhenAll(overviewTask, economyTask, eventsTask);

            var ov = await overviewTask;
            var eco = await economyTask;
            var ev = await eventsTask;

            if (eco != null)
            {
                KpiTotalUsers.Text = eco.TotalUsers.ToString("N0");
                KpiTotalCoins.Text = eco.TotalCoins.ToString("N0");
                KpiTodayBets.Text = eco.TodayBets.ToString("N0");
                KpiTodaySettle.Text = eco.TodaySettle >= 0 ? $"+{eco.TodaySettle:N0}" : $"{eco.TodaySettle:N0}";
                KpiTodayTips.Text = eco.TodayTips.ToString("N0");
                KpiTodayRelief.Text = eco.TodayRelief.ToString("N0");
            }

            if (ov.Summary != null)
            {
                KpiOnlineInfo.Text = $"在线: {ov.Summary.Online} 人 (真实: {ov.Summary.Humans} 陪玩: {ov.Summary.Bots})";
            }

            DgDailyWinners.ItemsSource = ov.Daily;
            DgAuditEvents.ItemsSource = ev;
        }

        private async void BtnRefreshEvents_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var ev = await _api.GetEventsAsync(60);
                DgAuditEvents.ItemsSource = ev;
                SetStatus("实时审计流已更新");
            }
            catch (Exception ex)
            {
                SetStatus($"更新审计流失败: {ex.Message}");
            }
        }

        // ==================== 2. 玩家管控与流水 (Players) ====================
        private async void TxtPlayerSearch_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
            }
        }

        private async void BtnSearchPlayers_Click(object sender, RoutedEventArgs e)
        {
            await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
        }

        private async void BtnResetPlayersSearch_Click(object sender, RoutedEventArgs e)
        {
            TxtPlayerSearch.Text = "";
            await RefreshPlayersAsync("");
        }

        private async Task RefreshPlayersAsync(string keyword)
        {
            var players = await _api.GetPlayersAsync(keyword);
            DgPlayers.ItemsSource = players;

            if (_selectedPlayer != null)
            {
                var current = players.FirstOrDefault(p => p.UserId == _selectedPlayer.UserId);
                if (current != null)
                {
                    SelectPlayer(current);
                }
            }
        }

        private void DgPlayers_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (DgPlayers.SelectedItem is PlayerItem item)
            {
                SelectPlayer(item);
            }
        }

        private void SelectPlayer(PlayerItem player)
        {
            _selectedPlayer = player;
            TxtSelectedPlayerName.Text = $"{player.Nickname} ({player.Username})";
            TxtSelectedPlayerUid.Text = $"UID: {player.UserId}";
            TxtSelectedPlayerBalance.Text = player.FormattedBalance;

            BtnBanPlayer.IsEnabled = !player.Banned;
            BtnUnbanPlayer.IsEnabled = player.Banned;
            TxtNewNickname.Text = player.Nickname;
        }

        private void BtnQuickAmount_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string s)
            {
                TxtGrantAmount.Text = s;
            }
        }

        private async void BtnExecuteGrant_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null)
            {
                MessageBox.Show("请先在左侧选择要调整筹码的玩家", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            if (!long.TryParse(TxtGrantAmount.Text.Trim(), out var amount) || amount == 0)
            {
                MessageBox.Show("请输入非零的整数金额", "校验错误", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var reason = TxtGrantReason.Text.Trim();
            if (string.IsNullOrEmpty(reason)) reason = "GM 调账";

            var opDesc = amount > 0 ? $"发放 +{amount:N0}" : $"扣除 {Math.Abs(amount):N0}";
            var confirm = MessageBox.Show(
                $"确定要对玩家「{_selectedPlayer.Nickname}」(UID: {_selectedPlayer.UserId}) {opDesc} 欢乐豆吗？\n\n原因: {reason}",
                "调账确认",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                var idempotencyKey = Guid.NewGuid().ToString("N");
                var newBalance = await _api.GrantCoinsAsync(_selectedPlayer.UserId, amount, reason, idempotencyKey);
                _selectedPlayer.Balance = newBalance;
                TxtSelectedPlayerBalance.Text = $"{newBalance:N0}";
                SetStatus($"成功对 {_selectedPlayer.Nickname} 调账: {opDesc}，当前余额: {newBalance:N0}");
                await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
            }
            catch (Exception ex)
            {
                MessageBox.Show($"调整筹码失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnBanPlayer_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null) return;
            var confirm = MessageBox.Show($"确定要封禁账号「{_selectedPlayer.Nickname}」(UID: {_selectedPlayer.UserId}) 吗？\n封禁后玩家将无法登录。", "封禁账号", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                await _api.SetPlayerStatusAsync(_selectedPlayer.UserId, true);
                SetStatus($"已封禁玩家 {_selectedPlayer.Nickname}");
                await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
            }
            catch (Exception ex)
            {
                MessageBox.Show($"封禁失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnUnbanPlayer_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null) return;
            try
            {
                await _api.SetPlayerStatusAsync(_selectedPlayer.UserId, false);
                SetStatus($"已解除封禁玩家 {_selectedPlayer.Nickname}");
                await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
            }
            catch (Exception ex)
            {
                MessageBox.Show($"解封失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnResetPassword_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null) return;
            var newPass = TxtNewPassword.Text.Trim();
            if (newPass.Length < 6)
            {
                MessageBox.Show("新密码长度不能少于 6 位", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                await _api.ResetPasswordAsync(_selectedPlayer.UserId, newPass);
                MessageBox.Show($"玩家 {_selectedPlayer.Nickname} 的密码已成功重置为: {newPass}", "重置成功", MessageBoxButton.OK, MessageBoxImage.Information);
                SetStatus($"已重置玩家 {_selectedPlayer.Nickname} 的登录密码");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"重置密码失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnUpdateNickname_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null) return;
            var newNick = TxtNewNickname.Text.Trim();
            if (string.IsNullOrEmpty(newNick))
            {
                MessageBox.Show("昵称不能为空", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                await _api.UpdateNicknameAsync(_selectedPlayer.UserId, newNick);
                SetStatus($"已将玩家 {_selectedPlayer.UserId} 的昵称更新为: {newNick}");
                await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
            }
            catch (Exception ex)
            {
                MessageBox.Show($"更新昵称失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnViewLedger_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null) return;
            try
            {
                TxtLedgerTitle.Text = $"📜 {_selectedPlayer.Nickname} 的资金流水账本";
                TxtLedgerSubtitle.Text = $"UID: {_selectedPlayer.UserId} | 当前余额: {_selectedPlayer.FormattedBalance} 豆";
                ModalLedger.Visibility = Visibility.Visible;

                var ledger = await _api.GetPlayerLedgerAsync(_selectedPlayer.UserId, 100);
                DgUserLedger.ItemsSource = ledger;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"拉取流水失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnCloseLedgerModal_Click(object sender, RoutedEventArgs e)
        {
            ModalLedger.Visibility = Visibility.Collapsed;
        }

        // ==================== 3. 房间实时透视 (Rooms) ====================
        private async void CmbGameFilter_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (ViewRooms == null || !IsLoaded) return;
            await RefreshRoomsAsync();
        }

        private async void BtnRefreshRooms_Click(object sender, RoutedEventArgs e)
        {
            await RefreshRoomsAsync();
        }

        private async Task RefreshRoomsAsync()
        {
            string? gameId = null;
            if (CmbGameFilter.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            {
                gameId = tag;
            }

            var rooms = await _api.GetRoomsAsync(gameId);
            DgRooms.ItemsSource = rooms;

            if (_selectedRoom != null)
            {
                var cur = rooms.FirstOrDefault(r => r.Id == _selectedRoom.Id);
                if (cur != null)
                {
                    await InspectRoomAsync(cur);
                }
            }
        }

        private async void DgRooms_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (DgRooms.SelectedItem is RoomItem item)
            {
                await InspectRoomAsync(item);
            }
        }

        private async Task InspectRoomAsync(RoomItem room)
        {
            _selectedRoom = room;
            TxtInspectorRoomTitle.Text = $"房间: {room.Id} · {room.DisplayGame} ({room.DisplayMode})";
            TxtInspectorRoomStage.Text = $"阶段: {room.DisplayStage}";
            TxtInspectorRoomRound.Text = $"在线: {room.Players}/{room.MaxPlayers} (人:{room.Humans} 机:{room.Bots})";

            try
            {
                var detail = await _api.GetRoomDetailAsync(room.Id);
                if (detail != null)
                {
                    TxtInspectorRoomStage.Text = $"阶段: {room.DisplayStage} (轮次: {detail.Round})";
                    DgSeatedPlayers.ItemsSource = detail.Seated;
                }
            }
            catch
            {
                DgSeatedPlayers.ItemsSource = null;
            }
        }

        private async void BtnKickPlayer_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedRoom == null) return;
            if (DgSeatedPlayers.SelectedItem is not SeatedPlayer player)
            {
                MessageBox.Show("请先在下方列表中选择要踢出的在座玩家", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            try
            {
                await _api.KickPlayerAsync(_selectedRoom.Id, player.PlayerId);
                SetStatus($"已将玩家 {player.Nickname} 踢出房间 {_selectedRoom.Id}");
                await InspectRoomAsync(_selectedRoom);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"踢人失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnAddBot_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedRoom == null)
            {
                MessageBox.Show("请先选择一个房间", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            string level = "medium";
            if (CmbBotLevel.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            {
                level = tag;
            }

            try
            {
                await _api.AddBotAsync(_selectedRoom.Id, level);
                SetStatus($"已向房间 {_selectedRoom.Id} 加入 {level} 级陪玩机器人");
                await InspectRoomAsync(_selectedRoom);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"添加机器人失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnRemoveBot_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedRoom == null) return;
            try
            {
                await _api.RemoveBotAsync(_selectedRoom.Id);
                SetStatus($"已从房间 {_selectedRoom.Id} 移除一个机器人");
                await InspectRoomAsync(_selectedRoom);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"移除机器人失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnResetRoom_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedRoom == null) return;
            var confirm = MessageBox.Show($"确定要强制重置房间「{_selectedRoom.Id}」吗？\n将终止当前未完成的对局并全额退还在座玩家的下注筹码。", "强制流局退款", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                await _api.ResetRoomAsync(_selectedRoom.Id);
                SetStatus($"已强制重置并退款房间 {_selectedRoom.Id}");
                await RefreshRoomsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"重置房间失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnDeleteRoom_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedRoom == null) return;
            var confirm = MessageBox.Show($"确定要彻底解散销毁房间「{_selectedRoom.Id}」吗？", "销毁房间", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                await _api.DeleteRoomAsync(_selectedRoom.Id);
                SetStatus($"已解散房间 {_selectedRoom.Id}");
                _selectedRoom = null;
                await RefreshRoomsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"销毁房间失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnOpenBatchRoomModal_Click(object sender, RoutedEventArgs e)
        {
            ModalBatchRooms.Visibility = Visibility.Visible;
        }

        private void BtnCloseBatchRoomModal_Click(object sender, RoutedEventArgs e)
        {
            ModalBatchRooms.Visibility = Visibility.Collapsed;
        }

        private async void BtnExecuteBatchRoom_Click(object sender, RoutedEventArgs e)
        {
            string gameId = "doudizhu";
            if (CmbBatchGame.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            {
                gameId = tag;
            }

            if (!int.TryParse(TxtBatchCount.Text.Trim(), out var count) || count < 1 || count > 10)
            {
                MessageBox.Show("开台数量需在 1 到 10 之间", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                var createdCount = await _api.BatchCreateRoomsAsync(gameId, count);
                ModalBatchRooms.Visibility = Visibility.Collapsed;
                SetStatus($"成功批量创建 {createdCount} 间官方平台房间 ({gameId})");
                await RefreshRoomsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"批量开台失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        // ==================== 4. 📬 邮箱发放与管理 (Mailbox - NEW!) ====================
        private void RadioMailTarget_Changed(object sender, RoutedEventArgs e)
        {
            if (PanelMailTargetUser == null) return;
            PanelMailTargetUser.Visibility = RadioMailUser.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        }

        private void BtnQuickMailCoins_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string s)
            {
                TxtMailRewardCoins.Text = s;
            }
        }

        private async void BtnSendMail_Click(object sender, RoutedEventArgs e)
        {
            var isUserTarget = RadioMailUser.IsChecked == true;
            var targetType = isUserTarget ? "user" : "all";
            string? targetUserId = null;
            string? targetUsername = null;

            if (isUserTarget)
            {
                var inputTarget = TxtMailTargetUserId.Text.Trim();
                if (string.IsNullOrEmpty(inputTarget))
                {
                    MessageBox.Show("请输入定向接收邮件的玩家 UID 或账号名", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                if (inputTarget.StartsWith("u_") || inputTarget.Length == 24 || inputTarget.All(char.IsDigit))
                {
                    targetUserId = inputTarget;
                }
                else
                {
                    targetUsername = inputTarget;
                }
            }

            var title = TxtMailTitle.Text.Trim();
            var content = TxtMailContent.Text.Trim();
            var senderName = TxtMailSender.Text.Trim();
            if (string.IsNullOrEmpty(senderName)) senderName = "系统管理员";

            if (string.IsNullOrEmpty(title))
            {
                MessageBox.Show("邮件标题不能为空", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (string.IsNullOrEmpty(content))
            {
                MessageBox.Show("邮件正文不能为空", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            if (!long.TryParse(TxtMailRewardCoins.Text.Trim(), out var rewardCoins) || rewardCoins < 0)
            {
                MessageBox.Show("附带筹码数额需为非负整数", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var targetDesc = targetType == "all" ? "全服所有玩家广播" : $"指定玩家 ({TxtMailTargetUserId.Text.Trim()})";
            var coinDesc = rewardCoins > 0 ? $"附带赠送筹码: {rewardCoins:N0} 欢乐豆" : "无赠送筹码";

            var confirm = MessageBox.Show(
                $"确认要发送此邮件吗？\n\n发送目标: {targetDesc}\n邮件标题: {title}\n{coinDesc}",
                "确认发送邮件",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                await _api.SendMailAsync(targetType, targetUserId, targetUsername, title, content, rewardCoins, senderName);
                MessageBox.Show("邮件已成功入库并向玩家发放！", "发送成功", MessageBoxButton.OK, MessageBoxImage.Information);
                SetStatus($"邮件「{title}」已成功发放给 {targetDesc}");
                await RefreshMailsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"发送邮件失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnRefreshMails_Click(object sender, RoutedEventArgs e)
        {
            await RefreshMailsAsync();
        }

        private async Task RefreshMailsAsync()
        {
            var mails = await _api.GetMailsAsync(100);
            DgMails.ItemsSource = mails;
        }

        private async void BtnDeleteMail_Click(object sender, RoutedEventArgs e)
        {
            if (DgMails.SelectedItem is not MailItem mail)
            {
                MessageBox.Show("请先选择要撤回/删除的邮件", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            var confirm = MessageBox.Show($"确定要撤回/删除邮件「{mail.Title}」(ID: {mail.Id}) 吗？\n撤回后未领取的玩家将无法再领取。", "确认撤回", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                await _api.DeleteMailAsync(mail.Id);
                SetStatus($"已撤回邮件 {mail.Id}");
                await RefreshMailsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"删除邮件失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        // ==================== 5. 跑马灯与公告 (Broadcast) ====================
        private async void BtnPushBroadcast_Click(object sender, RoutedEventArgs e)
        {
            var text = TxtBroadcastContent.Text.Trim();
            if (string.IsNullOrEmpty(text))
            {
                MessageBox.Show("请输入跑马灯广播内容", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                await _api.SendBroadcastAsync(text);
                MessageBox.Show("跑马灯已成功向全服实时推送！", "推送成功", MessageBoxButton.OK, MessageBoxImage.Information);
                SetStatus($"已向全服推送跑马灯: {text}");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"推送失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnPublishAnnouncement_Click(object sender, RoutedEventArgs e)
        {
            var title = TxtAnnounceTitle.Text.Trim();
            var content = TxtAnnounceContent.Text.Trim();
            string kind = "notice";
            if (CmbAnnounceKind.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            {
                kind = tag;
            }

            if (string.IsNullOrEmpty(title) || string.IsNullOrEmpty(content))
            {
                MessageBox.Show("标题与内容不能为空", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                await _api.CreateAnnouncementAsync(title, content, kind);
                TxtAnnounceTitle.Text = "";
                TxtAnnounceContent.Text = "";
                SetStatus($"成功发布公告「{title}」");
                await RefreshAnnouncementsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"发布公告失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnRefreshAnnouncements_Click(object sender, RoutedEventArgs e)
        {
            await RefreshAnnouncementsAsync();
        }

        private async Task RefreshAnnouncementsAsync()
        {
            var list = await _api.GetAnnouncementsAsync();
            DgAnnouncements.ItemsSource = list;
        }

        private async void BtnDeleteAnnouncement_Click(object sender, RoutedEventArgs e)
        {
            if (DgAnnouncements.SelectedItem is not AnnouncementItem ann)
            {
                MessageBox.Show("请先选择要删除的公告", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            try
            {
                await _api.DeleteAnnouncementAsync(ann.Id);
                SetStatus($"已删除公告 {ann.Id}");
                await RefreshAnnouncementsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"删除公告失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        // ==================== 6. 安全风控与解限 (Security) ====================
        private async void BtnClearSecurityLimits_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                await _api.ClearSecurityLimitsAsync();
                MessageBox.Show("全服所有安全限流与频控拦截已成功重置刷新！", "操作成功", MessageBoxButton.OK, MessageBoxImage.Information);
                SetStatus("限流拦截白名单已重置");
                await RefreshSecurityEventsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"解限失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async Task RefreshSecurityEventsAsync()
        {
            var events = await _api.GetEventsAsync(80);
            DgSecurityEvents.ItemsSource = events;
        }

        // ==================== 7. 运维与远程部署 (DevOps) ====================
        private void BtnSaveSshConfig_Click(object sender, RoutedEventArgs e)
        {
            _config.Host = TxtSshHost.Text.Trim();
            _config.Port = TxtSshPort.Text.Trim();
            _config.Username = TxtSshUser.Text.Trim();
            _config.Password = TxtSshPass.Password.Trim();
            _config.Save();
            SetStatus("SSH 运维连接配置已持久化保存");
            MessageBox.Show("SSH 配置保存成功！", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        private async void BtnDiagnoseHealth_Click(object sender, RoutedEventArgs e)
        {
            AppendTerminal($"[诊断] 正在探活目标服务器: {_api.BaseUrl} ...");
            var sw = Stopwatch.StartNew();
            try
            {
                var ov = await _api.GetOverviewAsync();
                sw.Stop();
                AppendTerminal($"[诊断成功] API 服务正常在线，RTT: {sw.ElapsedMilliseconds}ms，在运房间数: {ov.Summary?.Rooms ?? 0}");
            }
            catch (Exception ex)
            {
                sw.Stop();
                AppendTerminal($"[诊断失败] 目标服务无响应: {ex.Message} (耗时: {sw.ElapsedMilliseconds}ms)");
            }
        }

        private async void BtnSshPm2Status_Click(object sender, RoutedEventArgs e)
        {
            await RunSshCommandAsync("pm2 status");
        }

        private async void BtnSshRestartServices_Click(object sender, RoutedEventArgs e)
        {
            var confirm = MessageBox.Show("确认要通过 SSH 重启远程游戏微服务吗？", "重启微服务", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            var cmd = $"cd {_config.RemoteDir} && pm2 restart all";
            await RunSshCommandAsync(cmd);
        }

        private async void BtnSshGitPull_Click(object sender, RoutedEventArgs e)
        {
            var confirm = MessageBox.Show("确认拉取最新 Git 代码并在服务器上重新编译吗？", "远程热更", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            var cmd = $"cd {_config.RemoteDir} && git pull && pnpm build && pm2 reload all";
            await RunSshCommandAsync(cmd);
        }

        private async Task RunSshCommandAsync(string command)
        {
            var host = TxtSshHost.Text.Trim();
            if (!int.TryParse(TxtSshPort.Text.Trim(), out var port)) port = 22;
            var user = TxtSshUser.Text.Trim();
            var pass = TxtSshPass.Password.Trim();

            if (string.IsNullOrEmpty(host) || string.IsNullOrEmpty(user))
            {
                AppendTerminal("[SSH 提示] 请先配置有效的主机 IP 与用户名。");
                return;
            }

            await SshService.ExecuteCommandAsync(host, port, user, pass, command, line =>
            {
                Dispatcher.Invoke(() => AppendTerminal(line));
            });
        }

        private void AppendTerminal(string line)
        {
            TxtTerminalOutput.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}\n");
            ScrollTerminal.ScrollToEnd();
        }

        private void BtnClearTerminal_Click(object sender, RoutedEventArgs e)
        {
            TxtTerminalOutput.Text = "";
        }
    }
}
