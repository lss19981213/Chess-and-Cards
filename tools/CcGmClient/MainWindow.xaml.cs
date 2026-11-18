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
        private bool _isConnected = false;
        private PlayerItem? _selectedPlayer;
        private RoomItem? _selectedRoom;
        private List<GameCategoryItem> _categories = new();
        private Dictionary<string, string> _gameCategoryMap = new();
        private List<GameMetaItem> _allGames = new();
        private GameAssignmentRow? _selectedGameAssignment;

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
                "http://chess.fantasyclaw.top",
                "http://chess.fantasyclaw.top/lobby",
                "http://82.157.54.179",
                "http://82.157.54.179/lobby",
                "http://127.0.0.1:8080",
                "http://localhost:8080",
                "http://127.0.0.1:3000"
            };
            CmbServerUrl.Text = !string.IsNullOrEmpty(_config.ServerUrl) ? _config.ServerUrl : "http://chess.fantasyclaw.top";
            TxtAdminToken.Password = !string.IsNullOrEmpty(_config.AdminToken) ? _config.AdminToken : "";

            TxtSshHost.Text = _config.Host;
            TxtSshPort.Text = _config.Port;
            TxtSshUser.Text = _config.Username;
            TxtSshPass.Password = _config.Password;

            _timer.Interval = TimeSpan.FromSeconds(10);
            _timer.Tick += async (_, _) =>
            {
                // 未连接或鉴权失败时暂停自动轮询，防止反复请求触发服务端口令防爆破限流
                if (_isConnected && ChkAutoRefresh.IsChecked == true)
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
            CmbServerUrl.Text = "http://chess.fantasyclaw.top";
            await ConnectServerAsync();
        }

        private async void BtnSwitchLocal_Click(object sender, RoutedEventArgs e)
        {
            CmbServerUrl.Text = "http://127.0.0.1:8080";
            await ConnectServerAsync();
        }

        private string GetServerUrl()
        {
            var text = CmbServerUrl.Text?.Trim();
            if (!string.IsNullOrEmpty(text) && !text.Contains("ComboBoxItem")) return text;
            if (CmbServerUrl.SelectedItem is string s && !string.IsNullOrEmpty(s)) return s;
            return !string.IsNullOrEmpty(_config.ServerUrl) ? _config.ServerUrl : "http://chess.fantasyclaw.top";
        }

        private void SetConnectedState(bool isConnected, long latencyMs = 0, string? err = null)
        {
            _isConnected = isConnected;
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
                    SetStatus($"未连接（自动轮询已暂停）: {err}");
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
                var serverUrl = GetServerUrl().TrimEnd('/');
                var site = serverUrl.EndsWith("/lobby", StringComparison.OrdinalIgnoreCase)
                    ? $"{serverUrl}/"
                    : $"{serverUrl}/lobby/";
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
            ViewSlots.Visibility = tag == "slots" ? Visibility.Visible : Visibility.Collapsed;
            ViewCategories.Visibility = tag == "categories" ? Visibility.Visible : Visibility.Collapsed;
            ViewTasks.Visibility = tag == "tasks" ? Visibility.Visible : Visibility.Collapsed;
            ViewMailbox.Visibility = tag == "mailbox" ? Visibility.Visible : Visibility.Collapsed;
            ViewBroadcast.Visibility = tag == "broadcast" ? Visibility.Visible : Visibility.Collapsed;
            ViewSecurity.Visibility = tag == "security" ? Visibility.Visible : Visibility.Collapsed;
            ViewDevOps.Visibility = tag == "devops" ? Visibility.Visible : Visibility.Collapsed;

            TxtCurrentViewTitle.Text = tag switch
            {
                "dashboard" => "📊 大盘总览与经济流动",
                "players" => "👥 玩家管控与流水审计",
                "rooms" => "🎲 房间实时透视与博弈管控",
                "slots" => "🎰 老虎机经营数据与概率调控",
                "categories" => "🗂️ 大厅游戏分类与归属动态配置",
                "tasks" => "🎯 每日任务与成长任务动态管理",
                "mailbox" => "📬 全服邮箱发放与筹码直赠",
                "broadcast" => "📢 即时跑马灯与系统公告",
                "security" => "🛡️ 安全风控机制与解限",
                "devops" => "🚀 运维诊断与远程持续部署",
                _ => "GM 运营中台"
            };

            if (_isConnected)
            {
                await RefreshCurrentViewAsync();
            }
            else if (tag != "devops")
            {
                SetStatus("未连接到服务器，请核对地址与 GM 口令后点击「⚡ 连接服务」");
            }
        }

        private async void BtnRefreshCurrent_Click(object sender, RoutedEventArgs e)
        {
            if (!_isConnected)
            {
                await ConnectServerAsync();
                return;
            }
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
                    case "slots":
                        await RefreshSlotsAnalyticsAsync();
                        break;
                    case "categories":
                        await RefreshCategoriesAsync();
                        break;
                    case "tasks":
                        await RefreshTasksAsync();
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
                try { System.IO.File.AppendAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "gm_refresh.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] Refresh OK: {_activeView} in {sw.ElapsedMilliseconds}ms\n"); } catch { }
            }
            catch (Exception ex)
            {
                sw.Stop();
                SetConnectedState(false, 0, ex.Message);
                if (!silent) SetStatus($"刷新失败: {ex.Message}");
                try { System.IO.File.AppendAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "gm_refresh.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] Refresh ERROR ({_activeView}): {ex}\n"); } catch { }
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
            OverviewResponse? ov = null;
            EconomyOverview? eco = null;
            List<EventItem> ev = new();
            var errors = new List<string>();

            try { ov = await _api.GetOverviewAsync(); }
            catch (Exception ex) { errors.Add($"总览: {ex.Message}"); }

            try { eco = await _api.GetEconomyAsync(); }
            catch (Exception ex) { errors.Add($"经济: {ex.Message}"); }

            try { ev = await _api.GetEventsAsync(60); }
            catch (Exception ex) { errors.Add($"审计: {ex.Message}"); }

            if (eco != null)
            {
                KpiTotalUsers.Text = eco.TotalUsers.ToString("N0");
                KpiTotalCoins.Text = eco.TotalCoins.ToString("N0");
                KpiTodayBets.Text = eco.TodayBets.ToString("N0");
                KpiTodaySettle.Text = eco.TodaySettle >= 0 ? $"+{eco.TodaySettle:N0}" : $"{eco.TodaySettle:N0}";
                KpiTodayTips.Text = eco.TodayTips.ToString("N0");
                KpiTodayRelief.Text = eco.TodayRelief.ToString("N0");
            }

            if (ov?.Summary != null)
            {
                KpiOnlineInfo.Text = $"在线: {ov.Summary.Online} 人 (真实: {ov.Summary.Humans} 陪玩: {ov.Summary.Bots})";
            }

            if (ov?.Daily != null)
            {
                DgDailyWinners.ItemsSource = ov.Daily;
            }

            if (ev.Count > 0)
            {
                DgAuditEvents.ItemsSource = ev;
            }

            if (ov == null && eco == null)
            {
                throw new Exception(string.Join("; ", errors));
            }
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

        // ==================== 1.5 老虎机经营数据与概率调控 (Slots Analytics) ====================
        private async Task RefreshSlotsAnalyticsAsync()
        {
            var full = await _api.GetSlotsAnalyticsFullAsync(60);
            var data = full.Analytics ?? new SlotsAnalytics();
            var today = data.Today;
            var total = data.Total;

            KpiSlotsTodaySpins.Text = today.Spins.ToString("N0");
            KpiSlotsTodayPlayers.Text = $"今日活跃玩家: {today.Players:N0} 人";
            KpiSlotsTodayBet.Text = today.TotalBet.ToString("N0");
            KpiSlotsTodayPayout.Text = today.TotalPayout.ToString("N0");
            KpiSlotsTodayMaxWin.Text = $"今日最高单笔: {today.MaxSingleWin:N0}";
            KpiSlotsTodayProfit.Text = today.HouseProfit >= 0 ? $"+{today.HouseProfit:N0}" : $"{today.HouseProfit:N0}";
            KpiSlotsTodayProfit.Foreground = (SolidColorBrush)FindResource(today.HouseProfit >= 0 ? "BrushGreen" : "BrushRed");
            KpiSlotsTodayRtp.Text = $"{today.RtpPercent:F2}%";
            KpiSlotsTodayJackpots.Text = $"今日爆出大奖: {today.Jackpots:N0} 次";

            KpiSlotsTotalSpins.Text = total.Spins.ToString("N0");
            KpiSlotsTotalPlayers.Text = $"累计参与玩家: {total.Players:N0} 人";
            KpiSlotsTotalBet.Text = total.TotalBet.ToString("N0");
            KpiSlotsTotalPayout.Text = total.TotalPayout.ToString("N0");
            KpiSlotsTotalMaxWin.Text = $"历史单笔最高: {total.MaxSingleWin:N0}";
            KpiSlotsTotalProfit.Text = total.HouseProfit >= 0 ? $"+{total.HouseProfit:N0}" : $"{total.HouseProfit:N0}";
            KpiSlotsTotalProfit.Foreground = (SolidColorBrush)FindResource(total.HouseProfit >= 0 ? "BrushGreen" : "BrushRed");
            KpiSlotsTotalRtp.Text = $"{total.RtpPercent:F2}%";
            KpiSlotsTotalJackpots.Text = $"历史大奖总计: {total.Jackpots:N0} 次";

            if (full.Config != null &&
                !TxtSlotsHitRate.IsKeyboardFocused &&
                !TxtSlotsPayoutMult.IsKeyboardFocused &&
                !TxtSlotsJackpotRate.IsKeyboardFocused)
            {
                TxtSlotsHitRate.Text = full.Config.HitRatePercent.ToString("0.#");
                TxtSlotsPayoutMult.Text = full.Config.PayoutMultiplier.ToString("0.##");
                TxtSlotsJackpotRate.Text = full.Config.JackpotRatePercent.ToString("0.##");
            }

            DgSlotsPlayers.ItemsSource = data.TopPlayers;
            DgSlotsRecent.ItemsSource = data.RecentSpins;
        }

        private void BtnSlotsPreset_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string raw) return;
            var parts = raw.Split(',');
            if (parts.Length == 3)
            {
                TxtSlotsHitRate.Text = parts[0];
                TxtSlotsPayoutMult.Text = parts[1];
                TxtSlotsJackpotRate.Text = parts[2];
            }
        }

        private async void BtnSaveSlotsConfig_Click(object sender, RoutedEventArgs e)
        {
            if (!double.TryParse(TxtSlotsHitRate.Text.Trim(), out var hitRate) || hitRate < 0 || hitRate > 95)
            {
                MessageBox.Show("中奖概率需在 0 ~ 95 (%) 之间", "参数提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (!double.TryParse(TxtSlotsPayoutMult.Text.Trim(), out var mult) || mult < 0.2 || mult > 3.0)
            {
                MessageBox.Show("派彩倍率系数需在 0.2 ~ 3.0 之间", "参数提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (!double.TryParse(TxtSlotsJackpotRate.Text.Trim(), out var jpRate) || jpRate < 0 || jpRate > 20)
            {
                MessageBox.Show("超级大奖概率需在 0 ~ 20 (%) 之间", "参数提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                BtnSaveSlotsConfig.IsEnabled = false;
                var saved = await _api.UpdateSlotsConfigAsync(new SlotsConfigModel
                {
                    HitRatePercent = hitRate,
                    PayoutMultiplier = mult,
                    JackpotRatePercent = jpRate
                });
                TxtSlotsHitRate.Text = saved.HitRatePercent.ToString("0.#");
                TxtSlotsPayoutMult.Text = saved.PayoutMultiplier.ToString("0.##");
                TxtSlotsJackpotRate.Text = saved.JackpotRatePercent.ToString("0.##");
                SetStatus($"老虎机概率已保存生效：中奖率 {saved.HitRatePercent}% · 倍率 {saved.PayoutMultiplier}x · 大奖率 {saved.JackpotRatePercent}%");
                MessageBox.Show(
                    $"老虎机中奖概率已更新并即时生效！\n\n• 中奖概率：{saved.HitRatePercent}%\n• 派彩倍率：{saved.PayoutMultiplier}x\n• 超级大奖概率：{saved.JackpotRatePercent}%",
                    "保存成功",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"保存老虎机概率失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                BtnSaveSlotsConfig.IsEnabled = true;
            }
        }

        private async void BtnRefreshSlots_Click(object sender, RoutedEventArgs e)
        {
            if (!_isConnected)
            {
                await ConnectServerAsync();
                return;
            }
            await RefreshCurrentViewAsync();
        }

        // ==================== 1.6 游戏分类动态管理 (Categories) ====================
        private async Task RefreshCategoriesAsync()
        {
            var res = await _api.GetGameCategoriesAsync();
            _categories = res.Categories.OrderBy(c => c.Key == "all" ? -1 : c.SortOrder).ToList();
            _gameCategoryMap = new Dictionary<string, string>(res.GameCategoryMap);
            _allGames = res.Games.Where(g => g.GameId != "slots").ToList();
            RenderCategoriesTables();
        }

        private void RenderCategoriesTables()
        {
            DgCategories.ItemsSource = null;
            DgCategories.ItemsSource = _categories.OrderBy(c => c.Key == "all" ? -1 : c.SortOrder).ToList();

            var assignable = _categories.Where(c => c.Key != "all").OrderBy(c => c.SortOrder).ToList();
            CmbAssignCategory.ItemsSource = assignable;

            var catMap = _categories.ToDictionary(c => c.Key, c => $"{c.Icon} {c.Label}");
            var gameIds = new HashSet<string>(_allGames.Select(g => g.GameId));
            foreach (var k in _gameCategoryMap.Keys)
            {
                if (k != "slots") gameIds.Add(k);
            }

            var nameLookup = _allGames.ToDictionary(g => g.GameId, g => g.Name);
            var rows = gameIds
                .OrderBy(id => _gameCategoryMap.TryGetValue(id, out var ck) ? ck : "zzz")
                .ThenBy(id => id)
                .Select(id =>
                {
                    var ck = _gameCategoryMap.TryGetValue(id, out var mapped) ? mapped : "all";
                    return new GameAssignmentRow
                    {
                        GameId = id,
                        GameName = nameLookup.TryGetValue(id, out var nm) ? nm : id,
                        CategoryKey = ck,
                        CategoryLabel = catMap.TryGetValue(ck, out var lbl) ? $"{lbl} ({ck})" : ck
                    };
                })
                .ToList();

            DgGameAssignments.ItemsSource = rows;
        }

        private void DgCategories_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (DgCategories.SelectedItem is not GameCategoryItem item) return;
            TxtCatKey.Text = item.Key;
            TxtCatIcon.Text = item.Icon;
            TxtCatLabel.Text = item.Label;
            TxtCatBadge.Text = item.Badge ?? "";
            TxtCatSort.Text = item.SortOrder.ToString();
        }

        private void BtnUpsertCategory_Click(object sender, RoutedEventArgs e)
        {
            var key = TxtCatKey.Text.Trim().ToLowerInvariant();
            var label = TxtCatLabel.Text.Trim();
            var icon = string.IsNullOrWhiteSpace(TxtCatIcon.Text) ? "🎮" : TxtCatIcon.Text.Trim();
            var badge = string.IsNullOrWhiteSpace(TxtCatBadge.Text) ? null : TxtCatBadge.Text.Trim();
            if (!int.TryParse(TxtCatSort.Text.Trim(), out var sortOrder)) sortOrder = _categories.Count;

            if (string.IsNullOrEmpty(key) || !System.Text.RegularExpressions.Regex.IsMatch(key, "^[a-z0-9_-]{1,24}$"))
            {
                MessageBox.Show("分类标识 Key 仅支持 1-24 位小写字母、数字、下划线或短横线（如 mahjong）", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (string.IsNullOrEmpty(label))
            {
                MessageBox.Show("请输入分类显示名称（如 雀神麻将）", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var existing = _categories.FirstOrDefault(c => c.Key == key);
            if (existing != null)
            {
                existing.Label = label;
                existing.Icon = icon;
                existing.Badge = badge;
                existing.SortOrder = sortOrder;
            }
            else
            {
                _categories.Add(new GameCategoryItem
                {
                    Key = key,
                    Label = label,
                    Icon = icon,
                    Badge = badge,
                    SortOrder = sortOrder
                });
            }

            RenderCategoriesTables();
            SetStatus($"已本地更新分类「{icon} {label}」，请点击右上角「💾 保存并同步到大厅」生效");
        }

        private void BtnDeleteCategory_Click(object sender, RoutedEventArgs e)
        {
            if (DgCategories.SelectedItem is not GameCategoryItem item)
            {
                MessageBox.Show("请先在左侧列表选中要删除的分类", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            if (item.Key == "all")
            {
                MessageBox.Show("「全部热门 (all)」为系统默认分类，不可删除", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            _categories.RemoveAll(c => c.Key == item.Key);
            var fallback = _categories.FirstOrDefault(c => c.Key != "all")?.Key ?? "all";
            foreach (var k in _gameCategoryMap.Keys.ToList())
            {
                if (_gameCategoryMap[k] == item.Key) _gameCategoryMap[k] = fallback;
            }

            RenderCategoriesTables();
            SetStatus($"已本地移除分类「{item.Label}」，请点击「💾 保存并同步到大厅」生效");
        }

        private void DgGameAssignments_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (DgGameAssignments.SelectedItem is not GameAssignmentRow row) return;
            _selectedGameAssignment = row;
            TxtSelectedGameAssign.Text = $"当前选中: {row.GameName} ({row.GameId})";
            CmbAssignCategory.SelectedValue = row.CategoryKey;
        }

        private void BtnApplyGameCategory_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedGameAssignment == null)
            {
                MessageBox.Show("请先在右侧列表选中一款游戏", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            if (CmbAssignCategory.SelectedValue is not string targetKey || string.IsNullOrEmpty(targetKey))
            {
                MessageBox.Show("请选择目标分类", "提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            _gameCategoryMap[_selectedGameAssignment.GameId] = targetKey;
            RenderCategoriesTables();
            SetStatus($"已将「{_selectedGameAssignment.GameName}」划归分类 {targetKey}，请点击「💾 保存并同步到大厅」生效");
        }

        private async void BtnRefreshCategories_Click(object sender, RoutedEventArgs e)
        {
            if (!_isConnected)
            {
                await ConnectServerAsync();
                return;
            }
            await RefreshCurrentViewAsync();
        }

        private async void BtnSaveCategories_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                BtnSaveCategories.IsEnabled = false;
                var saved = await _api.UpdateGameCategoriesAsync(_categories, _gameCategoryMap);
                _categories = saved.Categories.OrderBy(c => c.Key == "all" ? -1 : c.SortOrder).ToList();
                _gameCategoryMap = new Dictionary<string, string>(saved.GameCategoryMap);
                RenderCategoriesTables();
                SetStatus($"游戏分类配置已保存（共 {_categories.Count} 个分类），大厅已同步生效！");
                MessageBox.Show("游戏分类配置已保存并同步到玩家大厅！", "保存成功", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"保存游戏分类失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                BtnSaveCategories.IsEnabled = true;
            }
        }

        // ==================== 1.7 每日任务与成长任务动态管理 (Tasks) ====================
        private List<TaskConfigItem> _allTasks = new();
        private List<TaskMetricOption> _taskMetrics = new();
        private string? _editingTaskOriginalKey;
        private bool _isBindingTaskForm;

        private async Task RefreshTasksAsync()
        {
            var resp = await _api.GetTasksConfigAsync();
            _allTasks = resp.Tasks ?? new List<TaskConfigItem>();
            if (resp.Metrics != null && resp.Metrics.Count > 0)
            {
                _taskMetrics = resp.Metrics;
            }
            EnsureDefaultTaskMetrics();
            RenderTasksGrid(_editingTaskOriginalKey);

            // 首次进入若右侧下拉还未填充，按当前分组填充维度列表
            if (CmbTaskMetric.ItemsSource == null)
            {
                var currentGroup = GetSelectedTaskFormGroup();
                PopulateTaskMetricsForGroup(currentGroup, null);
            }
        }

        private void EnsureDefaultTaskMetrics()
        {
            if (_taskMetrics.Count > 0) return;
            _taskMetrics = new List<TaskMetricOption>
            {
                new() { Metric = "daily_play", Label = "当日完成任意对局局数", Group = "daily", Kind = "play" },
                new() { Metric = "daily_win", Label = "当日赢下对局局数", Group = "daily", Kind = "win" },
                new() { Metric = "daily_bigwin", Label = "当日单局净赢500+次数", Group = "daily", Kind = "win" },
                new() { Metric = "gameKinds", Label = "当日体验不同游戏款数", Group = "daily", Kind = "variety" },
                new() { Metric = "daily_mahjong", Label = "当日雀神麻将对局局数", Group = "daily", Kind = "mahjong" },
                new() { Metric = "daily_turnover", Label = "当日累计有效流水筹码", Group = "daily", Kind = "turnover" },
                new() { Metric = "daily_tip", Label = "当日打赏荷官次数", Group = "daily", Kind = "tip" },
                new() { Metric = "daily_worship", Label = "当日排行榜膜拜次数", Group = "daily", Kind = "worship" },
                new() { Metric = "daily_login", Label = "每日登录签到", Group = "daily", Kind = "login" },
                new() { Metric = "daily_invite", Label = "当日邀请新玩家注册(按人头)", Group = "daily", Kind = "invite" },
                new() { Metric = "relief", Label = "破产救济金(余额低于阈值可领)", Group = "daily", Kind = "relief", SupportsMaxBalance = true },
                new() { Metric = "total_play", Label = "历史累计完成对局局数", Group = "growth", Kind = "play" },
                new() { Metric = "total_win", Label = "历史累计赢下对局局数", Group = "growth", Kind = "win" },
                new() { Metric = "total_checkin", Label = "历史累计签到天数", Group = "growth", Kind = "login" },
                new() { Metric = "total_tip", Label = "历史累计打赏荷官次数", Group = "growth", Kind = "tip" },
                new() { Metric = "level", Label = "玩家当前账号等级", Group = "growth", Kind = "level" },
                new() { Metric = "totalGameKinds", Label = "历史累计体验不同游戏款数", Group = "growth", Kind = "variety" },
                new() { Metric = "ownedFrames", Label = "历史累计拥有头像框数量", Group = "growth", Kind = "frame" },
            };
        }

        private string GetSelectedTaskFormGroup()
        {
            return (CmbTaskGroup?.SelectedItem as ComboBoxItem)?.Tag as string ?? "daily";
        }

        private void PopulateTaskMetricsForGroup(string group, string? preferredMetric)
        {
            EnsureDefaultTaskMetrics();
            var filtered = _taskMetrics.Where(m => string.Equals(m.Group, group, StringComparison.OrdinalIgnoreCase)).ToList();
            if (filtered.Count == 0) filtered = _taskMetrics.ToList();

            CmbTaskMetric.ItemsSource = filtered;
            if (!string.IsNullOrWhiteSpace(preferredMetric) && filtered.Any(m => m.Metric == preferredMetric))
            {
                CmbTaskMetric.SelectedValue = preferredMetric;
            }
            else if (filtered.Count > 0)
            {
                CmbTaskMetric.SelectedIndex = 0;
            }
            UpdateReliefPanelVisibility();
        }

        private void UpdateReliefPanelVisibility()
        {
            if (PanelTaskMaxBalance == null) return;
            var opt = CmbTaskMetric.SelectedItem as TaskMetricOption;
            PanelTaskMaxBalance.Visibility = opt != null && (opt.SupportsMaxBalance || opt.Metric == "relief")
                ? Visibility.Visible
                : Visibility.Collapsed;
        }

        private void RenderTasksGrid(string? selectKey = null)
        {
            var filter = (CmbTasksFilterGroup?.SelectedItem as ComboBoxItem)?.Tag as string ?? "all";
            var filtered = filter == "all"
                ? _allTasks.ToList()
                : _allTasks.Where(t => string.Equals(t.Group, filter, StringComparison.OrdinalIgnoreCase)).ToList();

            var dailyCount = _allTasks.Count(t => t.Group == "daily");
            var growthCount = _allTasks.Count(t => t.Group == "growth");
            TxtTasksSummaryCount.Text = $"共 {_allTasks.Count} 条（每日 {dailyCount} / 成长 {growthCount}）";

            DgTasks.ItemsSource = null;
            DgTasks.ItemsSource = filtered;

            if (!string.IsNullOrWhiteSpace(selectKey))
            {
                var found = filtered.FirstOrDefault(t => t.Key == selectKey);
                if (found != null)
                {
                    DgTasks.SelectedItem = found;
                }
            }
        }

        private void CmbTasksFilterGroup_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (!IsLoaded || DgTasks == null) return;
            RenderTasksGrid(_editingTaskOriginalKey);
        }

        private void DgTasks_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (DgTasks.SelectedItem is not TaskConfigItem task) return;

            _isBindingTaskForm = true;
            try
            {
                _editingTaskOriginalKey = task.Key;
                TxtTaskEditorMode.Text = $"✏️ 编辑任务：{task.Name}";
                BtnDeleteTask.IsEnabled = true;

                CmbTaskGroup.SelectedIndex = task.Group == "growth" ? 1 : 0;
                PopulateTaskMetricsForGroup(task.Group, task.Metric);

                TxtTaskKey.Text = task.Key;
                TxtTaskName.Text = task.Name;
                TxtTaskDesc.Text = task.Description;
                TxtTaskTarget.Text = task.Target.ToString();
                TxtTaskReward.Text = task.Reward.ToString();
                TxtTaskMaxBalance.Text = (task.MaxBalance ?? 100).ToString();
                UpdateReliefPanelVisibility();
            }
            finally
            {
                _isBindingTaskForm = false;
            }
        }

        private void CmbTaskGroup_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (!IsLoaded || _isBindingTaskForm || CmbTaskMetric == null) return;
            var group = GetSelectedTaskFormGroup();
            PopulateTaskMetricsForGroup(group, null);
        }

        private void CmbTaskMetric_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (!IsLoaded || PanelTaskMaxBalance == null) return;
            UpdateReliefPanelVisibility();
        }

        private void BtnNewTask_Click(object sender, RoutedEventArgs e)
        {
            _isBindingTaskForm = true;
            try
            {
                DgTasks.SelectedItem = null;
                _editingTaskOriginalKey = null;
                TxtTaskEditorMode.Text = "➕ 新建任务";
                BtnDeleteTask.IsEnabled = false;

                var filter = (CmbTasksFilterGroup?.SelectedItem as ComboBoxItem)?.Tag as string ?? "all";
                var defaultGroup = filter == "growth" ? "growth" : "daily";
                CmbTaskGroup.SelectedIndex = defaultGroup == "growth" ? 1 : 0;
                PopulateTaskMetricsForGroup(defaultGroup, null);

                TxtTaskKey.Text = GenerateTaskKey(defaultGroup);
                TxtTaskName.Text = "";
                TxtTaskDesc.Text = "";
                TxtTaskTarget.Text = defaultGroup == "growth" ? "10" : "3";
                TxtTaskReward.Text = defaultGroup == "growth" ? "5000" : "500";
                TxtTaskMaxBalance.Text = "100";
                UpdateReliefPanelVisibility();
                TxtTaskName.Focus();
            }
            finally
            {
                _isBindingTaskForm = false;
            }
        }

        private static string GenerateTaskKey(string group)
        {
            var prefix = group == "growth" ? "once_custom_" : "daily_custom_";
            return $"{prefix}{DateTime.Now:HHmmss}";
        }

        private void BtnAutoGenTaskKey_Click(object sender, RoutedEventArgs e)
        {
            var group = GetSelectedTaskFormGroup();
            TxtTaskKey.Text = GenerateTaskKey(group);
        }

        private async void BtnRefreshTasks_Click(object sender, RoutedEventArgs e)
        {
            if (!_isConnected)
            {
                await ConnectServerAsync();
                return;
            }
            await RefreshCurrentViewAsync();
        }

        private async void BtnSaveTask_Click(object sender, RoutedEventArgs e)
        {
            var group = GetSelectedTaskFormGroup();
            var key = TxtTaskKey.Text.Trim().ToLowerInvariant();
            var name = TxtTaskName.Text.Trim();
            var desc = TxtTaskDesc.Text.Trim();
            var metric = (CmbTaskMetric.SelectedItem as TaskMetricOption)?.Metric
                ?? (group == "growth" ? "total_play" : "daily_play");

            if (string.IsNullOrWhiteSpace(key))
            {
                key = GenerateTaskKey(group);
                TxtTaskKey.Text = key;
            }
            if (string.IsNullOrWhiteSpace(name))
            {
                MessageBox.Show("请填写任务名称", "校验提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (!long.TryParse(TxtTaskTarget.Text.Trim(), out var target) || target < 1 || target > 100_000_000)
            {
                MessageBox.Show("完成目标数值需为正整数（1 ~ 100,000,000）", "校验提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (!long.TryParse(TxtTaskReward.Text.Trim(), out var reward) || reward < 1 || reward > MaxGrantAmount)
            {
                MessageBox.Show($"奖励欢乐豆需为正整数（1 ~ {MaxGrantAmount:N0}）", "校验提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            long? maxBalance = null;
            if (metric == "relief")
            {
                if (!long.TryParse(TxtTaskMaxBalance.Text.Trim(), out var mb) || mb < 1)
                {
                    MessageBox.Show("救济金余额上限需为正整数", "校验提示", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                maxBalance = mb;
            }

            if (string.IsNullOrWhiteSpace(desc))
            {
                var metricLabel = (CmbTaskMetric.SelectedItem as TaskMetricOption)?.Label ?? name;
                desc = $"{metricLabel}达到 {target:N0} 即可领取 {reward:N0} 欢乐豆奖励";
                TxtTaskDesc.Text = desc;
            }

            try
            {
                BtnSaveTask.IsEnabled = false;
                var resp = await _api.UpsertTaskAsync(key, _editingTaskOriginalKey, name, desc, group, metric, target, reward, maxBalance);
                _allTasks = resp.Tasks ?? _allTasks;
                _editingTaskOriginalKey = key;
                RenderTasksGrid(key);

                var actionText = resp.Action == "created" ? "新增" : "修改";
                var groupLabel = group == "growth" ? "成长任务" : "每日任务";
                SetStatus($"已{actionText}{groupLabel}「{name}」({key})，玩家大厅已即时生效！");
                MessageBox.Show($"已成功{actionText}{groupLabel}「{name}」，玩家大厅任务列表已同步生效！", "保存成功", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"保存任务失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                BtnSaveTask.IsEnabled = true;
            }
        }

        private async void BtnDeleteTask_Click(object sender, RoutedEventArgs e)
        {
            var key = _editingTaskOriginalKey ?? (DgTasks.SelectedItem as TaskConfigItem)?.Key;
            if (string.IsNullOrWhiteSpace(key))
            {
                MessageBox.Show("请先在左侧选择要删除的任务", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            var target = _allTasks.FirstOrDefault(t => t.Key == key);
            var label = target != null ? $"「{target.Name}」({key})" : key;

            var confirm = MessageBox.Show(
                $"确认要删除任务 {label} 吗？\n删除后玩家大厅将不再展示此任务。",
                "确认删除任务",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                BtnDeleteTask.IsEnabled = false;
                var resp = await _api.DeleteTaskAsync(key);
                _allTasks = resp.Tasks ?? _allTasks;
                _editingTaskOriginalKey = null;
                RenderTasksGrid(null);
                BtnNewTask_Click(sender, e);
                SetStatus($"已删除任务 {label}，玩家大厅已同步更新");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"删除任务失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                BtnDeleteTask.IsEnabled = true;
            }
        }

        private async void BtnTaskMoveUp_Click(object sender, RoutedEventArgs e)
        {
            await MoveSelectedTaskAsync(-1);
        }

        private async void BtnTaskMoveDown_Click(object sender, RoutedEventArgs e)
        {
            await MoveSelectedTaskAsync(1);
        }

        private async Task MoveSelectedTaskAsync(int delta)
        {
            if (DgTasks.SelectedItem is not TaskConfigItem selected)
            {
                MessageBox.Show("请先选中一条任务再调整顺序", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            var idx = _allTasks.FindIndex(t => t.Key == selected.Key);
            if (idx < 0) return;

            var targetIdx = idx + delta;
            while (targetIdx >= 0 && targetIdx < _allTasks.Count && _allTasks[targetIdx].Group != selected.Group)
            {
                targetIdx += delta;
            }
            if (targetIdx < 0 || targetIdx >= _allTasks.Count) return;

            (_allTasks[idx], _allTasks[targetIdx]) = (_allTasks[targetIdx], _allTasks[idx]);
            try
            {
                var resp = await _api.SaveAllTasksAsync(_allTasks);
                _allTasks = resp.Tasks ?? _allTasks;
                RenderTasksGrid(selected.Key);
                SetStatus($"已调整任务「{selected.Name}」展示顺序并同步到大厅");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"调整排序失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void BtnResetTasks_Click(object sender, RoutedEventArgs e)
        {
            var confirm = MessageBox.Show(
                "确认要将所有每日任务和成长任务恢复为系统默认配置吗？\n当前自定义的增删改将被覆盖。",
                "恢复默认任务确认",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                var resp = await _api.ResetDefaultTasksAsync();
                _allTasks = resp.Tasks ?? new List<TaskConfigItem>();
                _editingTaskOriginalKey = null;
                RenderTasksGrid(null);
                SetStatus($"已恢复系统默认任务列表（共 {_allTasks.Count} 条）");
                MessageBox.Show("已恢复为系统默认每日任务与成长任务！", "恢复成功", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"恢复默认任务失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
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

        private async void DgPlayers_MouseDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (DgPlayers.SelectedItem is PlayerItem item)
            {
                SelectPlayer(item);
                await OpenPlayerLedgerAsync(item);
            }
        }

        private void SelectPlayer(PlayerItem player)
        {
            _selectedPlayer = player;
            TxtSelectedPlayerName.Text = $"{player.Nickname} ({player.Username})";
            TxtSelectedPlayerLevel.Text = player.FormattedLevel;
            TxtSelectedPlayerUid.Text = $"UID: {player.UserId}";
            TxtSelectedPlayerBalance.Text = $"{player.FormattedBalance} 豆";
            TxtSelectedPlayerTurnover.Text = $"{player.FormattedTurnover} 豆";

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

        private const long MaxGrantAmount = 50_000_000;

        private async void BtnExecuteGrant_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null)
            {
                MessageBox.Show("请先在左侧选择要操作的玩家", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            if (!long.TryParse(TxtGrantAmount.Text.Trim(), out var amount) || amount == 0)
            {
                MessageBox.Show("请输入非零的整数金额", "校验错误", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            if (Math.Abs(amount) > MaxGrantAmount)
            {
                MessageBox.Show($"单次补发或扣减上限为 {MaxGrantAmount:N0} (5,000万) 欢乐豆", "超出上限", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var reason = TxtGrantReason.Text.Trim();
            if (string.IsNullOrEmpty(reason)) reason = amount > 0 ? "GM 客服筹码补发" : "GM 后台扣减";

            string confirmText = amount > 0
                ? $"确认通过【玩家邮箱】向「{_selectedPlayer.Nickname}」(UID: {_selectedPlayer.UserId}) 补发 +{amount:N0} 欢乐豆吗？\n\n📬 补发筹码将投递至玩家大厅邮箱，需玩家进入邮箱点击领取后才会到账！\n备注: {reason}"
                : $"确认直接扣除玩家「{_selectedPlayer.Nickname}」(UID: {_selectedPlayer.UserId}) {Math.Abs(amount):N0} 欢乐豆吗？\n\n⚠️ 负数扣减将立即实时从账户余额扣除。\n备注: {reason}";

            var confirm = MessageBox.Show(
                confirmText,
                amount > 0 ? "邮箱补发筹码确认" : "直接扣减筹码确认",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (confirm != MessageBoxResult.Yes) return;

            try
            {
                var idempotencyKey = Guid.NewGuid().ToString("N");
                var result = await _api.GrantCoinsAsync(_selectedPlayer.UserId, amount, reason, idempotencyKey);

                if (string.Equals(result.Delivery, "mail", StringComparison.OrdinalIgnoreCase))
                {
                    var tip = !string.IsNullOrWhiteSpace(result.Message)
                        ? result.Message
                        : $"已通过邮箱向「{_selectedPlayer.Nickname}」补发 +{amount:N0} 欢乐豆，请通知玩家前往大厅「邮箱」领取！";
                    MessageBox.Show($"{tip}\n\n邮件编号: {result.MailId ?? "-"}", "邮箱补发成功", MessageBoxButton.OK, MessageBoxImage.Information);
                    SetStatus($"已通过邮箱向 {_selectedPlayer.Nickname} 补发 +{amount:N0} 欢乐豆（待玩家邮箱领取，邮件ID: {result.MailId}）");
                    await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
                }
                else
                {
                    _selectedPlayer.Balance = result.Balance;
                    TxtSelectedPlayerBalance.Text = $"{result.Balance:N0} 豆";
                    SetStatus($"已扣除 {_selectedPlayer.Nickname} {Math.Abs(amount):N0} 欢乐豆，当前余额: {result.Balance:N0}");
                    await RefreshPlayersAsync(TxtPlayerSearch.Text.Trim());
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"操作失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
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

        private PlayerItem? _ledgerPlayer;
        private bool _isLoadingLedger;

        private async void BtnViewLedger_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedPlayer == null)
            {
                MessageBox.Show("请先在左侧选择要查看账单的玩家", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            await OpenPlayerLedgerAsync(_selectedPlayer);
        }

        private async Task OpenPlayerLedgerAsync(PlayerItem player)
        {
            _ledgerPlayer = player;
            _isLoadingLedger = true;
            try
            {
                CmbLedgerCategory.SelectedIndex = 0;
                CmbLedgerLimit.SelectedIndex = 1; // 默认 200 笔
            }
            finally
            {
                _isLoadingLedger = false;
            }

            TxtLedgerTitle.Text = $"📜 {player.Nickname} ({player.Username}) 的真实流水账单与欢乐豆明细";
            TxtLedgerSubtitle.Text = $"UID: {player.UserId} · 实时读取全量数据库真实资金流水与牌局/老虎机/邮箱/任务明细";
            ModalLedger.Visibility = Visibility.Visible;
            await LoadCurrentPlayerLedgerAsync();
        }

        private async Task LoadCurrentPlayerLedgerAsync()
        {
            if (_ledgerPlayer == null) return;
            try
            {
                var category = (CmbLedgerCategory.SelectedItem as ComboBoxItem)?.Tag as string ?? "all";
                var limitStr = (CmbLedgerLimit.SelectedItem as ComboBoxItem)?.Tag as string ?? "200";
                var limit = int.TryParse(limitStr, out var parsed) ? parsed : 200;

                TxtLedgerCount.Text = "正在拉取真实流水账单...";
                var resp = await _api.GetPlayerLedgerFullAsync(_ledgerPlayer.UserId, limit, category);
                var ledger = resp.Ledger ?? new List<LedgerItem>();
                DgUserLedger.ItemsSource = ledger;

                var sum = resp.Summary;
                if (sum != null)
                {
                    TxtLedgerBalance.Text = $"{sum.CurrentBalance:N0} 豆";
                    TxtLedgerLevel.Text = $"等级: Lv.{Math.Max(1, sum.Level)}";
                    TxtLedgerTotalTurnover.Text = $"{sum.TotalTurnover:N0} 豆";
                    TxtLedgerGameTurnover.Text = $"当前页牌局/老虎机流水: {sum.GameTurnover:N0}";
                    TxtLedgerTotalIn.Text = $"+{sum.TotalIn:N0}";
                    TxtLedgerTotalOut.Text = $"-{sum.TotalOut:N0}";
                    TxtLedgerNetChange.Text = $"净变动: {(sum.NetChange >= 0 ? "+" : "")}{sum.NetChange:N0}";
                    TxtLedgerMailClaimed.Text = $"邮箱领取: +{sum.MailClaimed:N0}";
                    TxtLedgerGmAdjusted.Text = $"GM直调: {(sum.GmAdjusted >= 0 ? "+" : "")}{sum.GmAdjusted:N0}";
                    TxtLedgerCount.Text = category == "all"
                        ? $"展示最新 {sum.TotalCount} 笔真实明细"
                        : $"筛选命中 {sum.FilteredCount} / {sum.TotalCount} 笔明细";
                }
                else
                {
                    TxtLedgerBalance.Text = $"{_ledgerPlayer.FormattedBalance} 豆";
                    TxtLedgerLevel.Text = $"等级: {_ledgerPlayer.FormattedLevel}";
                    TxtLedgerTotalTurnover.Text = $"{_ledgerPlayer.FormattedTurnover} 豆";
                    TxtLedgerCount.Text = $"共 {ledger.Count} 笔明细";
                }
            }
            catch (Exception ex)
            {
                TxtLedgerCount.Text = "拉取失败";
                MessageBox.Show($"拉取玩家流水账单失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void CmbLedgerFilter_Changed(object sender, SelectionChangedEventArgs e)
        {
            if (!IsLoaded || _isLoadingLedger || ModalLedger == null || ModalLedger.Visibility != Visibility.Visible) return;
            await LoadCurrentPlayerLedgerAsync();
        }

        private async void BtnRefreshLedger_Click(object sender, RoutedEventArgs e)
        {
            await LoadCurrentPlayerLedgerAsync();
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
            if (rewardCoins > MaxGrantAmount)
            {
                MessageBox.Show($"单封邮件附赠筹码上限为 {MaxGrantAmount:N0} (5,000万) 欢乐豆", "超出上限", MessageBoxButton.OK, MessageBoxImage.Warning);
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
