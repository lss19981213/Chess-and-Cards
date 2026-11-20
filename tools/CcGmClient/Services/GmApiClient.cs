using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using CcGmClient.Converters;
using CcGmClient.Models;

namespace CcGmClient.Services
{
    public class GmApiClient
    {
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
            NumberHandling = JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString,
            Converters =
            {
                new FlexibleStringConverter(),
                new FlexibleLongConverter(),
                new FlexibleIntConverter()
            }
        };

        private readonly HttpClient _http;
        private string _baseUrl = "http://82.157.54.179";
        private string _adminToken = "";

        public string BaseUrl
        {
            get => _baseUrl;
            set => _baseUrl = (value ?? "").TrimEnd('/');
        }

        public string AdminToken
        {
            get => _adminToken;
            set => _adminToken = (value ?? "").Trim();
        }

        public GmApiClient()
        {
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
        }

        public void Configure(string baseUrl, string token)
        {
            var clean = (baseUrl ?? "").Trim().TrimEnd('/');
            if (clean.EndsWith("/api", StringComparison.OrdinalIgnoreCase))
            {
                clean = clean[..^4];
            }
            BaseUrl = clean;
            AdminToken = token;
        }

        private HttpRequestMessage CreateRequest(HttpMethod method, string path, object? body = null)
        {
            var cleanPath = path.StartsWith('/') ? path : $"/{path}";
            if (_baseUrl.EndsWith("/api", StringComparison.OrdinalIgnoreCase) && cleanPath.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            {
                cleanPath = cleanPath[4..];
            }
            var url = $"{_baseUrl}{cleanPath}";
            var req = new HttpRequestMessage(method, url);
            if (!string.IsNullOrEmpty(_adminToken))
            {
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _adminToken);
            }
            if (body != null)
            {
                var json = JsonSerializer.Serialize(body);
                req.Content = new StringContent(json, Encoding.UTF8, "application/json");
            }
            return req;
        }

        private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body = null)
        {
            using var req = CreateRequest(method, path, body);
            using var res = await _http.SendAsync(req);
            var content = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                string errMsg = $"请求失败 ({res.StatusCode})";
                try
                {
                    using var doc = JsonDocument.Parse(content);
                    if (doc.RootElement.TryGetProperty("error", out var errProp))
                    {
                        errMsg = errProp.GetString() ?? errMsg;
                    }
                    else if (doc.RootElement.TryGetProperty("message", out var msgProp))
                    {
                        errMsg = msgProp.GetString() ?? errMsg;
                    }
                }
                catch { }

                throw new Exception(errMsg);
            }

            var result = JsonSerializer.Deserialize<T>(content, JsonOptions);
            if (result == null)
            {
                throw new Exception("响应内容为空");
            }
            return result;
        }

        // ---------- 1. 探活与概览 ----------
        public async Task<OverviewResponse> GetOverviewAsync()
        {
            try
            {
                return await SendAsync<OverviewResponse>(HttpMethod.Get, "/api/admin/overview");
            }
            catch (Exception ex) when (ex.Message.Contains("404") || ex.Message.Contains("NotFound"))
            {
                if (!_baseUrl.EndsWith("/lobby", StringComparison.OrdinalIgnoreCase))
                {
                    var oldBase = _baseUrl;
                    _baseUrl = $"{oldBase}/lobby";
                    try
                    {
                        return await SendAsync<OverviewResponse>(HttpMethod.Get, "/api/admin/overview");
                    }
                    catch
                    {
                        _baseUrl = oldBase;
                        throw;
                    }
                }
                throw;
            }
        }

        public async Task<EconomyOverview?> GetEconomyAsync()
        {
            var res = await SendAsync<EconomyResponse>(HttpMethod.Get, "/api/admin/economy");
            return res.Overview;
        }

        public async Task<SlotsAnalyticsResponse> GetSlotsAnalyticsFullAsync(int limit = 60)
        {
            return await SendAsync<SlotsAnalyticsResponse>(HttpMethod.Get, $"/api/admin/slots/analytics?limit={limit}");
        }

        public async Task<SlotsAnalytics> GetSlotsAnalyticsAsync(int limit = 60)
        {
            var res = await GetSlotsAnalyticsFullAsync(limit);
            return res.Analytics ?? new SlotsAnalytics();
        }

        public async Task<SlotsConfigModel> UpdateSlotsConfigAsync(SlotsConfigModel cfg)
        {
            var res = await SendAsync<SlotsAnalyticsResponse>(HttpMethod.Put, "/api/admin/slots/config", cfg);
            return res.Config ?? cfg;
        }

        // ---------- 游戏分类动态管理 ----------
        public async Task<GameCategoriesResponse> GetGameCategoriesAsync()
        {
            return await SendAsync<GameCategoriesResponse>(HttpMethod.Get, "/api/admin/game-categories");
        }

        public async Task<GameCategoriesResponse> UpdateGameCategoriesAsync(
            List<GameCategoryItem> categories,
            Dictionary<string, string> gameCategoryMap)
        {
            var body = new
            {
                categories,
                gameCategoryMap
            };
            return await SendAsync<GameCategoriesResponse>(HttpMethod.Put, "/api/admin/game-categories", body);
        }

        // ---------- 每日任务与成长任务动态管理 ----------
        public async Task<AdminTasksResponse> GetTasksConfigAsync()
        {
            return await SendAsync<AdminTasksResponse>(HttpMethod.Get, "/api/admin/tasks");
        }

        public async Task<AdminTasksResponse> UpsertTaskAsync(
            string key,
            string? originalKey,
            string name,
            string description,
            string group,
            string metric,
            long target,
            long reward,
            long? maxBalance = null)
        {
            var body = new
            {
                key,
                originalKey = string.IsNullOrWhiteSpace(originalKey) ? null : originalKey,
                name,
                description,
                group,
                metric,
                target,
                reward,
                maxBalance
            };
            return await SendAsync<AdminTasksResponse>(HttpMethod.Post, "/api/admin/tasks", body);
        }

        public async Task<AdminTasksResponse> SaveAllTasksAsync(List<TaskConfigItem> tasks)
        {
            var payload = new
            {
                tasks = tasks.ConvertAll(t => new
                {
                    key = t.Key,
                    name = t.Name,
                    description = t.Description,
                    group = t.Group,
                    metric = t.Metric,
                    target = t.Target,
                    reward = t.Reward,
                    maxBalance = t.MaxBalance
                })
            };
            return await SendAsync<AdminTasksResponse>(HttpMethod.Put, "/api/admin/tasks", payload);
        }

        public async Task<AdminTasksResponse> DeleteTaskAsync(string key)
        {
            var path = $"/api/admin/tasks/{Uri.EscapeDataString(key)}";
            return await SendAsync<AdminTasksResponse>(HttpMethod.Delete, path);
        }

        public async Task<AdminTasksResponse> ResetDefaultTasksAsync()
        {
            return await SendAsync<AdminTasksResponse>(HttpMethod.Post, "/api/admin/tasks/reset", new { });
        }

        // ---------- 2. 玩家管控 ----------
        public async Task<List<PlayerItem>> GetPlayersAsync(string q = "")
        {
            var path = string.IsNullOrEmpty(q) ? "/api/admin/players" : $"/api/admin/players?q={Uri.EscapeDataString(q)}";
            var res = await SendAsync<Dictionary<string, List<PlayerItem>>>(HttpMethod.Get, path);
            return res.TryGetValue("players", out var list) ? list : new List<PlayerItem>();
        }

        public async Task<PlayerLedgerResponse> GetPlayerLedgerFullAsync(string userId, int limit = 200, string category = "all")
        {
            var cat = string.IsNullOrWhiteSpace(category) ? "all" : category.Trim();
            var path = $"/api/admin/players/{Uri.EscapeDataString(userId)}/ledger?limit={limit}&category={Uri.EscapeDataString(cat)}";
            return await SendAsync<PlayerLedgerResponse>(HttpMethod.Get, path);
        }

        public async Task<List<LedgerItem>> GetPlayerLedgerAsync(string userId, int limit = 200)
        {
            var res = await GetPlayerLedgerFullAsync(userId, limit, "all");
            return res.Ledger ?? new List<LedgerItem>();
        }

        public async Task<bool> SetPlayerStatusAsync(string userId, bool banned)
        {
            var path = $"/api/admin/players/{Uri.EscapeDataString(userId)}/status";
            await SendAsync<object>(HttpMethod.Post, path, new { banned });
            return true;
        }

        public async Task<bool> ResetPasswordAsync(string userId, string newPassword)
        {
            var path = $"/api/admin/players/{Uri.EscapeDataString(userId)}/reset-password";
            await SendAsync<object>(HttpMethod.Post, path, new { newPassword });
            return true;
        }

        public async Task<bool> UpdateNicknameAsync(string userId, string nickname)
        {
            var path = $"/api/admin/players/{Uri.EscapeDataString(userId)}/update";
            await SendAsync<object>(HttpMethod.Post, path, new { nickname });
            return true;
        }

        public async Task<BatchCreateAccountResult> BatchCreatePlayersAsync(
            string prefix,
            string nicknamePrefix,
            string password,
            int count,
            long initialCoins)
        {
            var body = new
            {
                prefix,
                nicknamePrefix,
                password,
                count,
                initialCoins
            };
            return await SendAsync<BatchCreateAccountResult>(HttpMethod.Post, "/api/admin/players/batch-create", body);
        }

        public async Task<GrantCoinsResult> GrantCoinsAsync(string userId, long amount, string reason, string idempotencyKey)
        {
            var body = new
            {
                userId,
                amount,
                reason,
                idempotencyKey
            };
            return await SendAsync<GrantCoinsResult>(HttpMethod.Post, "/api/admin/grant", body);
        }

        // ---------- 3. 房间透视与管控 ----------
        public async Task<List<RoomItem>> GetRoomsAsync(string? gameId = null)
        {
            var path = string.IsNullOrEmpty(gameId) ? "/api/admin/rooms" : $"/api/admin/rooms?gameId={Uri.EscapeDataString(gameId)}";
            var res = await SendAsync<Dictionary<string, List<RoomItem>>>(HttpMethod.Get, path);
            return res.TryGetValue("rooms", out var list) ? list : new List<RoomItem>();
        }

        public async Task<RoomDetail> GetRoomDetailAsync(string roomId)
        {
            var path = $"/api/admin/rooms/{Uri.EscapeDataString(roomId)}/detail";
            return await SendAsync<RoomDetail>(HttpMethod.Get, path);
        }

        public async Task<bool> KickPlayerAsync(string roomId, string playerId)
        {
            var path = $"/api/admin/rooms/{Uri.EscapeDataString(roomId)}/kick";
            await SendAsync<object>(HttpMethod.Post, path, new { playerId });
            return true;
        }

        public async Task<bool> AddBotAsync(string roomId, string level = "medium")
        {
            var path = $"/api/admin/rooms/{Uri.EscapeDataString(roomId)}/bot";
            await SendAsync<object>(HttpMethod.Post, path, new { action = "add", level });
            return true;
        }

        public async Task<bool> RemoveBotAsync(string roomId)
        {
            var path = $"/api/admin/rooms/{Uri.EscapeDataString(roomId)}/bot";
            await SendAsync<object>(HttpMethod.Post, path, new { action = "remove" });
            return true;
        }

        public async Task<bool> ResetRoomAsync(string roomId)
        {
            var path = $"/api/admin/rooms/{Uri.EscapeDataString(roomId)}/reset";
            await SendAsync<object>(HttpMethod.Post, path, new { });
            return true;
        }

        public async Task<bool> DeleteRoomAsync(string roomId)
        {
            var path = $"/api/admin/rooms/{Uri.EscapeDataString(roomId)}";
            await SendAsync<object>(HttpMethod.Delete, path);
            return true;
        }

        public async Task<int> BatchCreateRoomsAsync(string gameId, int count)
        {
            var body = new { gameId, count };
            using var req = CreateRequest(HttpMethod.Post, "/api/admin/rooms", body);
            using var res = await _http.SendAsync(req);
            var content = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                throw new Exception($"批量开台失败: {content}");
            }
            using var doc = JsonDocument.Parse(content);
            if (doc.RootElement.TryGetProperty("created", out var cArr) && cArr.ValueKind == JsonValueKind.Array)
            {
                return cArr.GetArrayLength();
            }
            return count;
        }

        // ---------- 4. 邮箱发放与管理 (新增) ----------
        public async Task<List<MailItem>> GetMailsAsync(int limit = 100)
        {
            var path = $"/api/admin/mail?limit={limit}";
            var res = await SendAsync<Dictionary<string, List<MailItem>>>(HttpMethod.Get, path);
            return res.TryGetValue("mails", out var list) ? list : new List<MailItem>();
        }

        public async Task<MailItem> SendMailAsync(
            string targetType,
            string? targetUserId,
            string? targetUsername,
            string title,
            string content,
            long rewardCoins,
            string sender = "系统管理员")
        {
            var body = new
            {
                targetType,
                targetUserId = !string.IsNullOrEmpty(targetUserId) ? targetUserId : null,
                targetUsername = !string.IsNullOrEmpty(targetUsername) ? targetUsername : null,
                title,
                content,
                rewardCoins,
                sender
            };

            using var req = CreateRequest(HttpMethod.Post, "/api/admin/mail", body);
            using var res = await _http.SendAsync(req);
            var resText = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                string errMsg = "发送邮件失败";
                try
                {
                    using var doc = JsonDocument.Parse(resText);
                    if (doc.RootElement.TryGetProperty("error", out var e)) errMsg = e.GetString() ?? errMsg;
                }
                catch { }
                throw new Exception(errMsg);
            }

            using var resDoc = JsonDocument.Parse(resText);
            if (resDoc.RootElement.TryGetProperty("mail", out var mProp))
            {
                return JsonSerializer.Deserialize<MailItem>(mProp.GetRawText()) ?? new MailItem();
            }
            return new MailItem();
        }

        public async Task<bool> DeleteMailAsync(string mailId)
        {
            var path = $"/api/admin/mail/{Uri.EscapeDataString(mailId)}";
            await SendAsync<object>(HttpMethod.Delete, path);
            return true;
        }

        // ---------- 5. 广播与公告 ----------
        public async Task<bool> SendBroadcastAsync(string text)
        {
            await SendAsync<object>(HttpMethod.Post, "/api/admin/broadcast", new { text });
            return true;
        }

        public async Task<List<AnnouncementItem>> GetAnnouncementsAsync()
        {
            var res = await SendAsync<Dictionary<string, List<AnnouncementItem>>>(HttpMethod.Get, "/api/admin/announcements");
            return res.TryGetValue("announcements", out var list) ? list : new List<AnnouncementItem>();
        }

        public async Task<bool> CreateAnnouncementAsync(string title, string content, string kind = "notice")
        {
            await SendAsync<object>(HttpMethod.Post, "/api/admin/announcements", new { title, content, kind });
            return true;
        }

        public async Task<bool> DeleteAnnouncementAsync(string id)
        {
            await SendAsync<object>(HttpMethod.Delete, $"/api/admin/announcements/{Uri.EscapeDataString(id)}");
            return true;
        }

        // ---------- 6. 风控与安全事件 ----------
        public async Task<List<EventItem>> GetEventsAsync(int limit = 80)
        {
            var res = await SendAsync<Dictionary<string, List<EventItem>>>(HttpMethod.Get, $"/api/admin/events?limit={limit}");
            return res.TryGetValue("events", out var list) ? list : new List<EventItem>();
        }

        public async Task<bool> ClearSecurityLimitsAsync()
        {
            await SendAsync<object>(HttpMethod.Post, "/api/admin/security/clear-limits", new { });
            return true;
        }

        // ---------- 7. 玩家问题反馈工单管理 ----------
        public async Task<AdminTicketsResponse> GetTicketsAsync(
            string status = "all",
            string category = "all",
            string keyword = "",
            int limit = 150)
        {
            var qs = new List<string> { $"limit={limit}" };
            if (!string.IsNullOrWhiteSpace(status) && status != "all")
                qs.Add($"status={Uri.EscapeDataString(status)}");
            if (!string.IsNullOrWhiteSpace(category) && category != "all")
                qs.Add($"category={Uri.EscapeDataString(category)}");
            if (!string.IsNullOrWhiteSpace(keyword))
                qs.Add($"keyword={Uri.EscapeDataString(keyword.Trim())}");
            var path = "/api/admin/tickets?" + string.Join("&", qs);
            return await SendAsync<AdminTicketsResponse>(HttpMethod.Get, path);
        }

        public async Task<AdminTicketDetailResponse> GetTicketDetailAsync(string ticketId)
        {
            var path = $"/api/admin/tickets/{Uri.EscapeDataString(ticketId)}";
            return await SendAsync<AdminTicketDetailResponse>(HttpMethod.Get, path);
        }

        public async Task<FeedbackTicketItem?> ReplyTicketAsync(
            string ticketId,
            string content,
            string status = "replied",
            long rewardCoins = 0,
            bool notifyMail = true,
            string? adminNote = null)
        {
            var path = $"/api/admin/tickets/{Uri.EscapeDataString(ticketId)}/reply";
            var res = await SendAsync<AdminTicketDetailResponse>(HttpMethod.Post, path, new
            {
                content,
                status,
                rewardCoins,
                notifyMail,
                adminNote
            });
            return res.Ticket;
        }

        public async Task<FeedbackTicketItem?> UpdateTicketStatusAsync(
            string ticketId,
            string status,
            string? adminNote = null)
        {
            var path = $"/api/admin/tickets/{Uri.EscapeDataString(ticketId)}/status";
            var res = await SendAsync<AdminTicketDetailResponse>(HttpMethod.Post, path, new
            {
                status,
                adminNote
            });
            return res.Ticket;
        }

        public async Task<bool> DeleteTicketAsync(string ticketId)
        {
            var path = $"/api/admin/tickets/{Uri.EscapeDataString(ticketId)}";
            await SendAsync<object>(HttpMethod.Delete, path);
            return true;
        }

        /// <summary>
        /// 拉取全部游戏运营态（含活跃真人对局数）。
        /// </summary>
        public async Task<List<GameOpsItem>> GetGameOpsListAsync()
        {
            var res = await SendAsync<GameOpsListResponse>(HttpMethod.Get, "/api/admin/games");
            return res.Games ?? new List<GameOpsItem>();
        }

        /// <summary>
        /// 单游戏运维：drain / disable / enable / reload。
        /// </summary>
        /// <param name="gameId">玩法 ID 或包名</param>
        /// <param name="action">drain|disable|enable|reload</param>
        /// <param name="message">可选维护文案</param>
        public async Task<bool> GameOpsActionAsync(string gameId, string action, string? message = null)
        {
            var path = $"/api/admin/games/{Uri.EscapeDataString(gameId)}/{action}";
            object body = string.IsNullOrWhiteSpace(message) ? new { } : new { message };
            await SendAsync<object>(HttpMethod.Post, path, body);
            return true;
        }

        // ---------- 12. 系统日志与深度排障 ----------

        /// <summary>
        /// 获取服务器上已归档的日志文件列表
        /// </summary>
        public async Task<LogFilesResponse> GetLogFilesAsync()
        {
            return await SendAsync<LogFilesResponse>(HttpMethod.Get, "/api/admin/logs/files");
        }

        /// <summary>
        /// 下载指定日志文件的二进制流
        /// </summary>
        public async Task<byte[]> DownloadLogFileAsync(string fileName)
        {
            var path = $"/api/admin/logs/download?file={Uri.EscapeDataString(fileName)}";
            using var req = CreateRequest(HttpMethod.Get, path);
            using var res = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            if (!res.IsSuccessStatusCode)
            {
                var err = await res.Content.ReadAsStringAsync();
                throw new Exception($"下载日志失败 ({res.StatusCode}): {err}");
            }
            return await res.Content.ReadAsByteArrayAsync();
        }

        /// <summary>
        /// 在线调阅/检索最近日志内容
        /// </summary>
        public async Task<LogTailResponse> GetLogTailAsync(
            string service = "all",
            string level = "all",
            int lines = 200,
            string keyword = "",
            string file = "")
        {
            var q = $"/api/admin/logs/tail?service={Uri.EscapeDataString(service)}&level={Uri.EscapeDataString(level)}&lines={lines}&keyword={Uri.EscapeDataString(keyword)}&file={Uri.EscapeDataString(file)}";
            return await SendAsync<LogTailResponse>(HttpMethod.Get, q);
        }

        /// <summary>
        /// 清理旧日志文件
        /// </summary>
        public async Task<LogCleanResponse> CleanLogsAsync(int retainDays = 7)
        {
            return await SendAsync<LogCleanResponse>(HttpMethod.Post, "/api/admin/logs/clean", new { retainDays });
        }

        // ---------- 13. 改命股市大盘与全服交易监控 ----------

        /// <summary>
        /// 获取改命股市全服总览、实时行情、各标的持仓汇总与最新交易成交流水
        /// </summary>
        public async Task<AdminStocksOverviewResponse> GetStocksOverviewAsync()
        {
            return await SendAsync<AdminStocksOverviewResponse>(HttpMethod.Get, "/api/admin/stocks/overview");
        }

        /// <summary>
        /// 强制穿透缓存刷新股市实时行情
        /// </summary>
        public async Task<AdminStockRefreshResponse> RefreshStockQuotesAsync()
        {
            return await SendAsync<AdminStockRefreshResponse>(HttpMethod.Post, "/api/admin/stocks/refresh");
        }
    }
}
