using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using CcGmClient.Models;

namespace CcGmClient.Services
{
    public class GmApiClient
    {
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
            BaseUrl = baseUrl;
            AdminToken = token;
        }

        private HttpRequestMessage CreateRequest(HttpMethod method, string path, object? body = null)
        {
            var url = $"{_baseUrl}{path}";
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

            var result = JsonSerializer.Deserialize<T>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
            if (result == null)
            {
                throw new Exception("响应内容为空");
            }
            return result;
        }

        // ---------- 1. 探活与概览 ----------
        public async Task<OverviewResponse> GetOverviewAsync()
        {
            return await SendAsync<OverviewResponse>(HttpMethod.Get, "/api/admin/overview");
        }

        public async Task<EconomyOverview?> GetEconomyAsync()
        {
            var res = await SendAsync<EconomyResponse>(HttpMethod.Get, "/api/admin/economy");
            return res.Overview;
        }

        // ---------- 2. 玩家管控 ----------
        public async Task<List<PlayerItem>> GetPlayersAsync(string q = "")
        {
            var path = string.IsNullOrEmpty(q) ? "/api/admin/players" : $"/api/admin/players?q={Uri.EscapeDataString(q)}";
            var res = await SendAsync<Dictionary<string, List<PlayerItem>>>(HttpMethod.Get, path);
            return res.TryGetValue("players", out var list) ? list : new List<PlayerItem>();
        }

        public async Task<List<LedgerItem>> GetPlayerLedgerAsync(string userId, int limit = 100)
        {
            var path = $"/api/admin/players/{Uri.EscapeDataString(userId)}/ledger?limit={limit}";
            var res = await SendAsync<Dictionary<string, List<LedgerItem>>>(HttpMethod.Get, path);
            return res.TryGetValue("ledger", out var list) ? list : new List<LedgerItem>();
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

        public async Task<long> GrantCoinsAsync(string userId, long amount, string reason, string idempotencyKey)
        {
            var body = new
            {
                userId,
                amount,
                reason,
                idempotencyKey
            };
            using var req = CreateRequest(HttpMethod.Post, "/api/admin/grant", body);
            using var res = await _http.SendAsync(req);
            var content = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                string errMsg = "调整筹码失败";
                try
                {
                    using var doc = JsonDocument.Parse(content);
                    if (doc.RootElement.TryGetProperty("error", out var e)) errMsg = e.GetString() ?? errMsg;
                }
                catch { }
                throw new Exception(errMsg);
            }

            using var docRes = JsonDocument.Parse(content);
            if (docRes.RootElement.TryGetProperty("balance", out var balProp))
            {
                return balProp.GetInt64();
            }
            return 0;
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
    }
}
