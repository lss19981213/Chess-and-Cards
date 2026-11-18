using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CcGmClient.Models
{
    // ---------- 大盘与经济数据模型 ----------
    public class OverviewResponse
    {
        [JsonPropertyName("dayKey")]
        public string? DayKey { get; set; }

        [JsonPropertyName("lastSettlementAt")]
        public JsonElement? RawLastSettlementAt { get; set; }

        [JsonIgnore]
        public string FormattedLastSettlement
        {
            get
            {
                if (RawLastSettlementAt.HasValue)
                {
                    var elem = RawLastSettlementAt.Value;
                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var ms))
                    {
                        return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
                    }
                    if (elem.ValueKind == JsonValueKind.String)
                    {
                        return elem.GetString() ?? "";
                    }
                }
                return "--";
            }
        }

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

        [JsonPropertyName("totalBalance")]
        public long TotalBalance { get; set; }

        [JsonPropertyName("totalCoins")]
        public long? AltTotalCoins { get; set; }

        [JsonIgnore]
        public long TotalCoins => AltTotalCoins ?? TotalBalance;

        [JsonPropertyName("todayBet")]
        public long TodayBet { get; set; }

        [JsonPropertyName("todayBets")]
        public long? AltTodayBets { get; set; }

        [JsonIgnore]
        public long TodayBets => AltTodayBets ?? TodayBet;

        [JsonPropertyName("todaySettle")]
        public long TodaySettle { get; set; }

        [JsonPropertyName("todayTip")]
        public long TodayTip { get; set; }

        [JsonPropertyName("todayTips")]
        public long? AltTodayTips { get; set; }

        [JsonIgnore]
        public long TodayTips => AltTodayTips ?? TodayTip;

        [JsonPropertyName("todayRelief")]
        public long TodayRelief { get; set; }

        [JsonPropertyName("todayGmGrant")]
        public long TodayGmGrant { get; set; }
    }

    public class DailyWinnerItem
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = "";

        [JsonPropertyName("username")]
        public string Username { get; set; } = "";

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("net")]
        public long Net { get; set; }

        [JsonPropertyName("netProfit")]
        public long? AltNetProfit { get; set; }

        [JsonIgnore]
        public long NetProfit => AltNetProfit ?? Net;

        [JsonPropertyName("rounds")]
        public int Rounds { get; set; }

        [JsonPropertyName("winCount")]
        public int? AltWinCount { get; set; }

        [JsonIgnore]
        public int WinCount => AltWinCount ?? Rounds;

        [JsonIgnore]
        public string DisplayProfit => NetProfit >= 0 ? $"+{NetProfit:N0}" : $"{NetProfit:N0}";
    }

    public class EventItem
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [JsonPropertyName("at")]
        public long? At { get; set; }

        [JsonPropertyName("time")]
        public string? Time { get; set; }

        [JsonPropertyName("level")]
        public string Level { get; set; } = "info";

        [JsonPropertyName("scope")]
        public string? Scope { get; set; }

        [JsonPropertyName("tag")]
        public string? RawTag { get; set; }

        [JsonIgnore]
        public string Tag => !string.IsNullOrEmpty(Scope) ? Scope : (!string.IsNullOrEmpty(RawTag) ? RawTag : "system");

        [JsonPropertyName("message")]
        public string Message { get; set; } = "";

        [JsonIgnore]
        public string DisplayTime
        {
            get
            {
                if (At.HasValue && At.Value > 0)
                {
                    return DateTimeOffset.FromUnixTimeMilliseconds(At.Value).ToLocalTime().ToString("HH:mm:ss");
                }
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

        [JsonPropertyName("level")]
        public int Level { get; set; } = 1;

        [JsonPropertyName("totalTurnover")]
        public long TotalTurnover { get; set; }

        [JsonPropertyName("banned")]
        public bool Banned { get; set; }

        [JsonPropertyName("role")]
        public string Role { get; set; } = "user";

        [JsonPropertyName("createdAt")]
        public JsonElement? RawCreatedAt { get; set; }

        [JsonIgnore]
        public string FormattedBalance => $"{Balance:N0}";
        [JsonIgnore]
        public string FormattedLevel => $"Lv.{Math.Max(1, Level)}";
        [JsonIgnore]
        public string FormattedTurnover => $"{TotalTurnover:N0}";
        [JsonIgnore]
        public string StatusText => Banned ? "已封禁" : "正常";
        [JsonIgnore]
        public string StatusColor => Banned ? "#FF5E62" : "#38D39F";

        [JsonIgnore]
        public string DisplayDate
        {
            get
            {
                if (RawCreatedAt.HasValue)
                {
                    var elem = RawCreatedAt.Value;
                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var ms))
                    {
                        return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                    }
                    if (elem.ValueKind == JsonValueKind.String && DateTime.TryParse(elem.GetString(), out var dt))
                    {
                        return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                    }
                }
                return "-";
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

        [JsonIgnore]
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

        [JsonPropertyName("balanceAfter")]
        public long BalanceAfter { get; set; }

        [JsonPropertyName("balance")]
        public long? RawBalance { get; set; }

        [JsonIgnore]
        public long Balance => RawBalance ?? BalanceAfter;

        [JsonPropertyName("bizType")]
        public string BizType { get; set; } = "";

        [JsonPropertyName("bizId")]
        public string? BizId { get; set; }

        [JsonPropertyName("bizLabel")]
        public string? BizLabel { get; set; }

        [JsonPropertyName("category")]
        public string? Category { get; set; }

        [JsonPropertyName("note")]
        public string? Note { get; set; }

        [JsonPropertyName("createdAt")]
        public JsonElement? RawCreatedAt { get; set; }

        [JsonIgnore]
        public string DisplayBizType => !string.IsNullOrWhiteSpace(BizLabel) ? BizLabel : BizType switch
        {
            "game_bet" => "游戏下注",
            "game_bet_refund" => "撤注退还",
            "game_bet_return" => "本金返还",
            "game_settle" => "游戏结算",
            "slots_bet" => "老虎机押注",
            "slots_win" => "老虎机派彩",
            "slots_spin" => "老虎机结算",
            "mail_reward" => "邮箱领取",
            "task" => "任务奖励",
            "level_reward" => "等级升级奖",
            "leaderboard" => "排行榜奖励",
            "worship" => "膜拜奖励",
            "dealer_tip" => "打赏荷官",
            "avatar_frame" => "购买头像框",
            "gm_grant" => "GM 调账",
            "init" => "注册赠豆",
            "relief" => "救济金",
            _ => string.IsNullOrWhiteSpace(BizType) ? "其他" : BizType
        };

        [JsonIgnore]
        public string DisplayNote => !string.IsNullOrWhiteSpace(Note)
            ? Note
            : (!string.IsNullOrWhiteSpace(BizId) ? BizId : "-");

        [JsonIgnore]
        public string FormattedDelta => Delta > 0 ? $"+{Delta:N0}" : $"{Delta:N0}";
        [JsonIgnore]
        public string FormattedBalance => $"{Balance:N0}";
        [JsonIgnore]
        public string DeltaColor => Delta > 0 ? "#38D39F" : (Delta < 0 ? "#FF5E62" : "#8E9DB5");

        [JsonIgnore]
        public string DisplayDate
        {
            get
            {
                if (RawCreatedAt.HasValue)
                {
                    var elem = RawCreatedAt.Value;
                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var ms))
                    {
                        return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
                    }
                    if (elem.ValueKind == JsonValueKind.String && DateTime.TryParse(elem.GetString(), out var dt))
                    {
                        return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
                    }
                }
                return "-";
            }
        }
    }

    public class LedgerSummary
    {
        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("level")]
        public int Level { get; set; } = 1;

        [JsonPropertyName("currentBalance")]
        public long CurrentBalance { get; set; }

        [JsonPropertyName("totalTurnover")]
        public long TotalTurnover { get; set; }

        [JsonPropertyName("totalCount")]
        public int TotalCount { get; set; }

        [JsonPropertyName("filteredCount")]
        public int FilteredCount { get; set; }

        [JsonPropertyName("totalIn")]
        public long TotalIn { get; set; }

        [JsonPropertyName("totalOut")]
        public long TotalOut { get; set; }

        [JsonPropertyName("netChange")]
        public long NetChange { get; set; }

        [JsonPropertyName("gameTurnover")]
        public long GameTurnover { get; set; }

        [JsonPropertyName("mailClaimed")]
        public long MailClaimed { get; set; }

        [JsonPropertyName("gmAdjusted")]
        public long GmAdjusted { get; set; }
    }

    public class PlayerLedgerResponse
    {
        [JsonPropertyName("ledger")]
        public List<LedgerItem> Ledger { get; set; } = new();

        [JsonPropertyName("summary")]
        public LedgerSummary? Summary { get; set; }
    }

    public class GrantCoinsResult
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("delivery")]
        public string Delivery { get; set; } = "direct";

        [JsonPropertyName("mailId")]
        public string? MailId { get; set; }

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("balance")]
        public long Balance { get; set; }

        [JsonPropertyName("amount")]
        public long Amount { get; set; }

        [JsonPropertyName("message")]
        public string Message { get; set; } = "";
    }

    // ---------- 房间与对战模型 ----------
    public class RoomItem
    {
        [JsonPropertyName("roomId")]
        public string? RoomId { get; set; }

        [JsonPropertyName("id")]
        public string? RawId { get; set; }

        [JsonIgnore]
        public string Id => !string.IsNullOrEmpty(RoomId) ? RoomId : (RawId ?? "");

        [JsonPropertyName("gameId")]
        public string GameId { get; set; } = "";

        [JsonPropertyName("roomName")]
        public string? RoomName { get; set; }

        [JsonPropertyName("gameTitle")]
        public string? GameTitle { get; set; }

        [JsonPropertyName("title")]
        public string? Title { get; set; }

        [JsonIgnore]
        public string DisplayGame => !string.IsNullOrEmpty(RoomName) ? RoomName : (!string.IsNullOrEmpty(GameTitle) ? GameTitle : GameId);

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

        [JsonPropertyName("status")]
        public string? Status { get; set; }

        [JsonPropertyName("stage")]
        public string? RawStage { get; set; }

        [JsonIgnore]
        public string Stage => !string.IsNullOrEmpty(Status) ? Status : (RawStage ?? "playing");

        [JsonPropertyName("persistent")]
        public bool Persistent { get; set; }

        [JsonPropertyName("createdAt")]
        public JsonElement? RawCreatedAt { get; set; }

        [JsonIgnore]
        public string DisplayMode => Persistent ? "官方平台庄" : "玩家自定义";
        [JsonIgnore]
        public string PlayerRatio => $"{Players}/{MaxPlayers} (人:{Humans} 机:{Bots})";
        [JsonIgnore]
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
        [JsonPropertyName("roomId")]
        public string? RoomId { get; set; }

        [JsonPropertyName("id")]
        public string? RawId { get; set; }

        [JsonIgnore]
        public string Id => !string.IsNullOrEmpty(RoomId) ? RoomId : (RawId ?? "");

        [JsonPropertyName("gameId")]
        public string GameId { get; set; } = "";

        [JsonPropertyName("roomName")]
        public string? RoomName { get; set; }

        [JsonPropertyName("title")]
        public string? Title { get; set; }

        [JsonIgnore]
        public string DisplayTitle => !string.IsNullOrEmpty(RoomName) ? RoomName : (!string.IsNullOrEmpty(Title) ? Title : GameId);

        [JsonPropertyName("status")]
        public string? Status { get; set; }

        [JsonPropertyName("stage")]
        public string? RawStage { get; set; }

        [JsonIgnore]
        public string Stage => !string.IsNullOrEmpty(Status) ? Status : (RawStage ?? "playing");

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

        [JsonIgnore]
        public string RoleBadge => IsBot ? $"🤖 机器人 ({FormatLevel(BotLevel)})" : "👤 真实玩家";
        [JsonIgnore]
        public string ReadyText => Ready ? "已准备" : "未准备";
        [JsonIgnore]
        public string ReadyColor => Ready ? "#38D39F" : "#8E9DB5";
        [JsonIgnore]
        public string FormattedChips => $"{Chips:N0}";

        private static string FormatLevel(string? level) => level switch
        {
            "low" => "低级",
            "medium" => "中级",
            "high" => "高级",
            _ => "常规"
        };
    }

    // ---------- 邮箱系统模型 ----------
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
        public JsonElement? RawCreatedAt { get; set; }

        [JsonPropertyName("claimedCount")]
        public int ClaimedCount { get; set; }

        [JsonIgnore]
        public string TargetDisplay => TargetType == "all" ? "🌐 全服玩家广播" : $"👤 定向玩家: {TargetUserId}";
        [JsonIgnore]
        public string FormattedReward => RewardCoins > 0 ? $"+{RewardCoins:N0} 筹码" : "无筹码 (通知信)";
        [JsonIgnore]
        public string RewardBadgeColor => RewardCoins > 0 ? "#F5C542" : "#8E9DB5";

        [JsonIgnore]
        public string DisplayDate
        {
            get
            {
                if (RawCreatedAt.HasValue)
                {
                    var elem = RawCreatedAt.Value;
                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var ms))
                    {
                        return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                    }
                    if (elem.ValueKind == JsonValueKind.String && DateTime.TryParse(elem.GetString(), out var dt))
                    {
                        return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                    }
                }
                return "-";
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
        public JsonElement? RawCreatedAt { get; set; }

        [JsonIgnore]
        public string KindDisplay => Kind switch
        {
            "notice" => "📢 常规通知",
            "event" => "🎉 活动公告",
            "maintenance" => "⚠️ 停机维护",
            _ => Kind
        };

        [JsonIgnore]
        public string DisplayDate
        {
            get
            {
                if (RawCreatedAt.HasValue)
                {
                    var elem = RawCreatedAt.Value;
                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var ms))
                    {
                        return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                    }
                    if (elem.ValueKind == JsonValueKind.String && DateTime.TryParse(elem.GetString(), out var dt))
                    {
                        return dt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                    }
                }
                return "-";
            }
        }
    }

    // ---------- 老虎机经营数据模型 ----------
    public class SlotsConfigModel
    {
        [JsonPropertyName("hitRatePercent")]
        public double HitRatePercent { get; set; } = 50;

        [JsonPropertyName("payoutMultiplier")]
        public double PayoutMultiplier { get; set; } = 1.0;

        [JsonPropertyName("jackpotRatePercent")]
        public double JackpotRatePercent { get; set; } = 0.8;
    }

    public class SlotsAnalyticsResponse
    {
        [JsonPropertyName("analytics")]
        public SlotsAnalytics? Analytics { get; set; }

        [JsonPropertyName("config")]
        public SlotsConfigModel? Config { get; set; }
    }

    public class SlotsAnalytics
    {
        [JsonPropertyName("today")]
        public SlotsSummaryMetrics Today { get; set; } = new();

        [JsonPropertyName("total")]
        public SlotsSummaryMetrics Total { get; set; } = new();

        [JsonPropertyName("topPlayers")]
        public List<SlotsPlayerStatItem> TopPlayers { get; set; } = new();

        [JsonPropertyName("recentSpins")]
        public List<SlotsSpinLogItem> RecentSpins { get; set; } = new();
    }

    public class SlotsSummaryMetrics
    {
        [JsonPropertyName("spins")]
        public long Spins { get; set; }

        [JsonPropertyName("players")]
        public long Players { get; set; }

        [JsonPropertyName("totalBet")]
        public long TotalBet { get; set; }

        [JsonPropertyName("totalPayout")]
        public long TotalPayout { get; set; }

        [JsonPropertyName("houseProfit")]
        public long HouseProfit { get; set; }

        [JsonPropertyName("rtpPercent")]
        public double RtpPercent { get; set; }

        [JsonPropertyName("jackpots")]
        public long Jackpots { get; set; }

        [JsonPropertyName("maxSingleWin")]
        public long MaxSingleWin { get; set; }
    }

    public class SlotsPlayerStatItem
    {
        [JsonPropertyName("userId")]
        public string UserId { get; set; } = "";

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("spins")]
        public long Spins { get; set; }

        [JsonPropertyName("totalBet")]
        public long TotalBet { get; set; }

        [JsonPropertyName("totalWin")]
        public long TotalWin { get; set; }

        [JsonPropertyName("netProfit")]
        public long NetProfit { get; set; }

        [JsonPropertyName("maxWin")]
        public long MaxWin { get; set; }

        [JsonPropertyName("jackpots")]
        public long Jackpots { get; set; }

        [JsonIgnore]
        public string FormattedBet => $"{TotalBet:N0}";
        [JsonIgnore]
        public string FormattedWin => $"{TotalWin:N0}";
        [JsonIgnore]
        public string FormattedNet => NetProfit > 0 ? $"+{NetProfit:N0}" : $"{NetProfit:N0}";
        [JsonIgnore]
        public string FormattedMaxWin => $"{MaxWin:N0}";
        [JsonIgnore]
        public string NetColor => NetProfit > 0 ? "#FF5E62" : (NetProfit < 0 ? "#38D39F" : "#8E9DB5");
    }

    public class SlotsSpinLogItem
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("userId")]
        public string UserId { get; set; } = "";

        [JsonPropertyName("nickname")]
        public string Nickname { get; set; } = "";

        [JsonPropertyName("betPerLine")]
        public int BetPerLine { get; set; }

        [JsonPropertyName("lines")]
        public int Lines { get; set; }

        [JsonPropertyName("totalBet")]
        public long TotalBet { get; set; }

        [JsonPropertyName("winAmount")]
        public long WinAmount { get; set; }

        [JsonPropertyName("netDelta")]
        public long NetDelta { get; set; }

        [JsonPropertyName("isJackpot")]
        public bool IsJackpot { get; set; }

        [JsonPropertyName("winningLines")]
        public int WinningLines { get; set; }

        [JsonPropertyName("createdAt")]
        public JsonElement? RawCreatedAt { get; set; }

        [JsonIgnore]
        public string SpecDisplay => $"{BetPerLine:N0} × {Lines}线";
        [JsonIgnore]
        public string FormattedBet => $"{TotalBet:N0}";
        [JsonIgnore]
        public string FormattedWin => WinAmount > 0 ? $"+{WinAmount:N0}" : "0";
        [JsonIgnore]
        public string FormattedNet => NetDelta > 0 ? $"+{NetDelta:N0}" : $"{NetDelta:N0}";
        [JsonIgnore]
        public string JackpotBadge => IsJackpot ? "🎆 SUPER JACKPOT" : (WinningLines > 0 ? $"中 {WinningLines} 线" : "未中奖");
        [JsonIgnore]
        public string NetColor => NetDelta > 0 ? "#FF5E62" : (NetDelta < 0 ? "#38D39F" : "#8E9DB5");

        [JsonIgnore]
        public string DisplayDate
        {
            get
            {
                if (RawCreatedAt.HasValue)
                {
                    var elem = RawCreatedAt.Value;
                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var ms))
                    {
                        return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("MM-dd HH:mm:ss");
                    }
                    if (elem.ValueKind == JsonValueKind.String && DateTime.TryParse(elem.GetString(), out var dt))
                    {
                        return dt.ToLocalTime().ToString("MM-dd HH:mm:ss");
                    }
                }
                return "-";
            }
        }
    }

    // ---------- 游戏分类动态配置模型 ----------
    public class GameCategoryItem
    {
        [JsonPropertyName("key")]
        public string Key { get; set; } = "";

        [JsonPropertyName("label")]
        public string Label { get; set; } = "";

        [JsonPropertyName("icon")]
        public string Icon { get; set; } = "🎮";

        [JsonPropertyName("badge")]
        public string? Badge { get; set; }

        [JsonPropertyName("sortOrder")]
        public int SortOrder { get; set; }

        [JsonIgnore]
        public string DisplayTitle => $"{Icon} {Label} ({Key})";
    }

    public class GameMetaItem
    {
        [JsonPropertyName("gameId")]
        public string GameId { get; set; } = "";

        [JsonPropertyName("name")]
        public string Name { get; set; } = "";

        [JsonPropertyName("icon")]
        public string? Icon { get; set; }

        [JsonPropertyName("category")]
        public string? Category { get; set; }
    }

    public class GameCategoriesResponse
    {
        [JsonPropertyName("categories")]
        public List<GameCategoryItem> Categories { get; set; } = new();

        [JsonPropertyName("gameCategoryMap")]
        public Dictionary<string, string> GameCategoryMap { get; set; } = new();

        [JsonPropertyName("games")]
        public List<GameMetaItem> Games { get; set; } = new();
    }

    public class GameAssignmentRow
    {
        public string GameId { get; set; } = "";
        public string GameName { get; set; } = "";
        public string CategoryKey { get; set; } = "";
        public string CategoryLabel { get; set; } = "";
    }

    // ---------- 每日任务与成长任务动态配置模型 ----------
    public class TaskConfigItem
    {
        [JsonPropertyName("key")]
        public string Key { get; set; } = "";

        [JsonPropertyName("name")]
        public string Name { get; set; } = "";

        [JsonPropertyName("description")]
        public string Description { get; set; } = "";

        [JsonPropertyName("group")]
        public string Group { get; set; } = "daily";

        [JsonPropertyName("period")]
        public string Period { get; set; } = "daily";

        [JsonPropertyName("kind")]
        public string Kind { get; set; } = "play";

        [JsonPropertyName("metric")]
        public string Metric { get; set; } = "daily_play";

        [JsonPropertyName("metricLabel")]
        public string? MetricLabel { get; set; }

        [JsonPropertyName("target")]
        public long Target { get; set; } = 1;

        [JsonPropertyName("reward")]
        public long Reward { get; set; } = 100;

        [JsonPropertyName("maxBalance")]
        public long? MaxBalance { get; set; }

        [JsonPropertyName("sortOrder")]
        public int SortOrder { get; set; }

        [JsonIgnore]
        public string GroupDisplay => Group == "growth" ? "🌟 成长任务" : "☀️ 每日任务";

        [JsonIgnore]
        public string DisplayMetric => !string.IsNullOrWhiteSpace(MetricLabel) ? MetricLabel : Metric;

        [JsonIgnore]
        public string FormattedTarget => $"{Target:N0}";

        [JsonIgnore]
        public string FormattedReward => $"+{Reward:N0} 豆";
    }

    public class TaskMetricOption
    {
        [JsonPropertyName("metric")]
        public string Metric { get; set; } = "";

        [JsonPropertyName("label")]
        public string Label { get; set; } = "";

        [JsonPropertyName("group")]
        public string Group { get; set; } = "daily";

        [JsonPropertyName("kind")]
        public string Kind { get; set; } = "play";

        [JsonPropertyName("supportsMaxBalance")]
        public bool SupportsMaxBalance { get; set; }

        [JsonIgnore]
        public string DisplayText => $"{Label} ({Metric})";
    }

    public class AdminTasksResponse
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("action")]
        public string? Action { get; set; }

        [JsonPropertyName("tasks")]
        public List<TaskConfigItem> Tasks { get; set; } = new();

        [JsonPropertyName("metrics")]
        public List<TaskMetricOption>? Metrics { get; set; }
    }
}
