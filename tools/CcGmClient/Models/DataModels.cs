using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace CcGmClient.Models
{
    // ---------- 大盘与经济数据模型 ----------
    public class OverviewResponse
    {
        [JsonPropertyName("dayKey")]
        public string? DayKey { get; set; }

        [JsonPropertyName("lastSettlementAt")]
        public string? LastSettlementAt { get; set; }

        [JsonPropertyName("summary")]
        public OverviewSummary? Summary { get; set; }

        [JsonPropertyName("rooms")]
        public List<RoomItem> Rooms { get; set; } = new();

        [JsonPropertyName("daily")]
        public List<DailyWinnerItem> Daily { get; set; } = new();
    }

    public class OverviewSummary
    {
        [JsonPropertyName("rooms")]
        public int Rooms { get; set; }

        [JsonPropertyName("platformRooms")]
        public int PlatformRooms { get; set; }

        [JsonPropertyName("playerRooms")]
        public int PlayerRooms { get; set; }

        [JsonPropertyName("online")]
        public int Online { get; set; }

        [JsonPropertyName("humans")]
        public int Humans { get; set; }

        [JsonPropertyName("bots")]
        public int Bots { get; set; }

        [JsonPropertyName("games")]
        public int Games { get; set; }
    }

    public class EconomyResponse
    {
        [JsonPropertyName("overview")]
        public EconomyOverview? Overview { get; set; }
    }

    public class EconomyOverview
    {
        [JsonPropertyName("totalUsers")]
        public long TotalUsers { get; set; }

        [JsonPropertyName("totalCoins")]
        public long TotalCoins { get; set; }

        [JsonPropertyName("todayBets")]
        public long TodayBets { get; set; }

        [JsonPropertyName("todaySettle")]
        public long TodaySettle { get; set; }

        [JsonPropertyName("todayTips")]
        public long TodayTips { get; set; }

        [JsonPropertyName("todayRelief")]
        public long TodayRelief { get; set; }
    }

    public class DailyWinnerItem
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = "";

        [JsonPropertyName("username")]
        public string Username { get; set; } = "";

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("netProfit")]
        public long NetProfit { get; set; }

        [JsonPropertyName("winCount")]
        public int WinCount { get; set; }

        public string DisplayProfit => NetProfit >= 0 ? $"+{NetProfit:N0}" : $"{NetProfit:N0}";
    }

    public class EventItem
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [JsonPropertyName("time")]
        public string? Time { get; set; }

        [JsonPropertyName("level")]
        public string Level { get; set; } = "info";

        [JsonPropertyName("tag")]
        public string Tag { get; set; } = "system";

        [JsonPropertyName("message")]
        public string Message { get; set; } = "";

        public string DisplayTime
        {
            get
            {
                if (DateTime.TryParse(Time, out var dt))
                {
                    return dt.ToLocalTime().ToString("HH:mm:ss");
                }
                return Time ?? "";
            }
        }
    }

    // ---------- 玩家与流水模型 ----------
    public class PlayerItem
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = "";

        [JsonPropertyName("username")]
        public string Username { get; set; } = "";

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("balance")]
        public long Balance { get; set; }

        [JsonPropertyName("banned")]
        public bool Banned { get; set; }

        [JsonPropertyName("role")]
        public string Role { get; set; } = "user";

        [JsonPropertyName("createdAt")]
        public string? CreatedAt { get; set; }

        public string FormattedBalance => $"{Balance:N0}";
        public string StatusText => Banned ? "已封禁" : "正常";
        public string StatusColor => Banned ? "#FF5E62" : "#38D39F";

        public string DisplayDate
        {
            get
            {
                if (DateTime.TryParse(CreatedAt, out var dt))
                {
                    return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                }
                return CreatedAt ?? "-";
            }
        }
    }

    public class BatchCreateAccountResult
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("count")]
        public int Count { get; set; }

        [JsonPropertyName("accounts")]
        public List<CreatedAccountItem> Accounts { get; set; } = new();
    }

    public class CreatedAccountItem
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = "";

        [JsonPropertyName("username")]
        public string Username { get; set; } = "";

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("balance")]
        public long Balance { get; set; }

        [JsonPropertyName("initialPassword")]
        public string InitialPassword { get; set; } = "";

        public string FormattedBalance => $"{Balance:N0}";
    }

    public class LedgerItem
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("userId")]
        public string UserId { get; set; } = "";

        [JsonPropertyName("delta")]
        public long Delta { get; set; }

        [JsonPropertyName("balance")]
        public long Balance { get; set; }

        [JsonPropertyName("bizType")]
        public string BizType { get; set; } = "";

        [JsonPropertyName("note")]
        public string? Note { get; set; }

        [JsonPropertyName("createdAt")]
        public string? CreatedAt { get; set; }

        public string FormattedDelta => Delta > 0 ? $"+{Delta:N0}" : $"{Delta:N0}";
        public string FormattedBalance => $"{Balance:N0}";
        public string DeltaColor => Delta > 0 ? "#38D39F" : (Delta < 0 ? "#FF5E62" : "#8E9DB5");

        public string DisplayDate
        {
            get
            {
                if (DateTime.TryParse(CreatedAt, out var dt))
                {
                    return dt.ToLocalTime().ToString("MM-dd HH:mm:ss");
                }
                return CreatedAt ?? "-";
            }
        }
    }

    // ---------- 房间与对战模型 ----------
    public class RoomItem
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("gameId")]
        public string GameId { get; set; } = "";

        [JsonPropertyName("gameTitle")]
        public string? GameTitle { get; set; }

        [JsonPropertyName("title")]
        public string? Title { get; set; }

        [JsonPropertyName("mode")]
        public string Mode { get; set; } = "standard";

        [JsonPropertyName("players")]
        public int Players { get; set; }

        [JsonPropertyName("maxPlayers")]
        public int MaxPlayers { get; set; }

        [JsonPropertyName("humans")]
        public int Humans { get; set; }

        [JsonPropertyName("bots")]
        public int Bots { get; set; }

        [JsonPropertyName("stage")]
        public string? Stage { get; set; }

        [JsonPropertyName("persistent")]
        public bool Persistent { get; set; }

        [JsonPropertyName("createdAt")]
        public string? CreatedAt { get; set; }

        public string DisplayGame => !string.IsNullOrEmpty(GameTitle) ? GameTitle : GameId;
        public string DisplayMode => Persistent ? "官方平台庄" : "玩家自定义";
        public string PlayerRatio => $"{Players}/{MaxPlayers} (人:{Humans} 机:{Bots})";
        public string DisplayStage => Stage switch
        {
            "waiting" => "等待准备",
            "betting" => "下注阶段",
            "dealing" => "发牌中",
            "playing" => "对决博弈",
            "settle" => "结算清算",
            _ => Stage ?? "运行中"
        };
    }

    public class RoomDetail
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("gameId")]
        public string GameId { get; set; } = "";

        [JsonPropertyName("title")]
        public string? Title { get; set; }

        [JsonPropertyName("stage")]
        public string? Stage { get; set; }

        [JsonPropertyName("round")]
        public int Round { get; set; }

        [JsonPropertyName("turn")]
        public string? Turn { get; set; }

        [JsonPropertyName("seated")]
        public List<SeatedPlayer> Seated { get; set; } = new();
    }

    public class SeatedPlayer
    {
        [JsonPropertyName("seat")]
        public int Seat { get; set; }

        [JsonPropertyName("playerId")]
        public string PlayerId { get; set; } = "";

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("isBot")]
        public bool IsBot { get; set; }

        [JsonPropertyName("ready")]
        public bool Ready { get; set; }

        [JsonPropertyName("chips")]
        public long Chips { get; set; }

        [JsonPropertyName("score")]
        public long Score { get; set; }

        [JsonPropertyName("botLevel")]
        public string? BotLevel { get; set; }

        public string RoleBadge => IsBot ? $"🤖 机器人 ({FormatLevel(BotLevel)})" : "👤 真实玩家";
        public string ReadyText => Ready ? "已准备" : "未准备";
        public string ReadyColor => Ready ? "#38D39F" : "#8E9DB5";
        public string FormattedChips => $"{Chips:N0}";

        private static string FormatLevel(string? level) => level switch
        {
            "low" => "低级",
            "medium" => "中级",
            "high" => "高级",
            _ => "常规"
        };
    }

    // ---------- 邮箱系统模型 (新增) ----------
    public class MailItem
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("targetType")]
        public string TargetType { get; set; } = "all";

        [JsonPropertyName("targetUserId")]
        public string? TargetUserId { get; set; }

        [JsonPropertyName("sender")]
        public string Sender { get; set; } = "系统管理员";

        [JsonPropertyName("title")]
        public string Title { get; set; } = "";

        [JsonPropertyName("content")]
        public string Content { get; set; } = "";

        [JsonPropertyName("rewardCoins")]
        public long RewardCoins { get; set; }

        [JsonPropertyName("createdAt")]
        public string? CreatedAt { get; set; }

        [JsonPropertyName("claimedCount")]
        public int ClaimedCount { get; set; }

        public string TargetDisplay => TargetType == "all" ? "🌐 全服玩家广播" : $"👤 定向玩家: {TargetUserId}";
        public string FormattedReward => RewardCoins > 0 ? $"+{RewardCoins:N0} 筹码" : "无筹码 (通知信)";
        public string RewardBadgeColor => RewardCoins > 0 ? "#F5C542" : "#8E9DB5";

        public string DisplayDate
        {
            get
            {
                if (DateTime.TryParse(CreatedAt, out var dt))
                {
                    return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                }
                return CreatedAt ?? "-";
            }
        }
    }

    // ---------- 跑马灯与公告模型 ----------
    public class AnnouncementItem
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("title")]
        public string Title { get; set; } = "";

        [JsonPropertyName("content")]
        public string Content { get; set; } = "";

        [JsonPropertyName("kind")]
        public string Kind { get; set; } = "notice";

        [JsonPropertyName("createdAt")]
        public string? CreatedAt { get; set; }

        public string KindDisplay => Kind switch
        {
            "notice" => "📢 常规通知",
            "event" => "🎉 活动公告",
            "maintenance" => "⚠️ 停机维护",
            _ => Kind
        };

        public string DisplayDate
        {
            get
            {
                if (DateTime.TryParse(CreatedAt, out var dt))
                {
                    return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                }
                return CreatedAt ?? "-";
            }
        }
    }
}
