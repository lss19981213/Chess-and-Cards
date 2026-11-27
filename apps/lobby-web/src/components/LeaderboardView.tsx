import { useEffect, useState } from 'react';
import type { StockLeaderboardEntry } from '@cc/protocol';
import {
  api,
  type LeaderboardEntry,
  type LeaderboardRewardRow,
  type LevelLeaderboardEntry,
} from '../api';
import { audio } from '../audio';
import { AvatarWithFrame } from './AvatarWithFrame';
import { Chip } from './Chip';
import { IconBack, IconCrown, IconTrophy } from './Icons';
import { PlayerCardModal } from './PlayerCardModal';

interface Props {
  myUserId: string | null;
  onBalanceChange?: (newBalance: number) => void;
  onBack: () => void;
}

type Tab = 'total' | 'level' | 'daily' | 'stock' | 'reward';

const RANK_TITLES = ['赌神', '赌圣', '赌侠', '赌王', '赌将', '豪侠', '名手', '高手', '老手', '新星'];

function titleOf(rank: number): string {
  return RANK_TITLES[rank - 1] ?? '座上宾';
}

function formatTurnover(raw: string): string {
  try {
    const n = BigInt(raw || '0');
    if (n >= 100_000_000n) return `${(Number(n / 1_000_000n) / 100).toFixed(2)}亿`;
    if (n >= 10_000n) return `${(Number(n / 100n) / 100).toFixed(2)}万`;
    return n.toLocaleString();
  } catch {
    return raw || '0';
  }
}

export function LeaderboardView({ myUserId, onBalanceChange, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('total');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [levelEntries, setLevelEntries] = useState<LevelLeaderboardEntry[]>([]);
  const [dailyEntries, setDailyEntries] = useState<
    Array<{ userId: string; nickname: string; net: number; rounds: number }>
  >([]);
  const [dailyDay, setDailyDay] = useState('');
  const [stockEntries, setStockEntries] = useState<StockLeaderboardEntry[]>([]);
  const [rewards, setRewards] = useState<LeaderboardRewardRow[]>([]);
  const [rewardDay, setRewardDay] = useState('');
  const [myRank, setMyRank] = useState<number | null>(null);
  const [remainingWorships, setRemainingWorships] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [worshippingId, setWorshippingId] = useState<string | null>(null);
  const [flyingHearts, setFlyingHearts] = useState<{ id: string; x: number; y: number }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [cardUserId, setCardUserId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const task =
      tab === 'total'
        ? api.leaderboard().then((data) => {
            if (cancelled) return;
            setEntries(data.entries);
            setMyRank(data.myRank);
            if (typeof data.remainingWorshipsToday === 'number') {
              setRemainingWorships(data.remainingWorshipsToday);
            }
          })
        : tab === 'level'
          ? api.levelLeaderboard().then((data) => {
              if (cancelled) return;
              setLevelEntries(data.entries);
              setMyRank(data.myRank);
              if (typeof data.remainingWorshipsToday === 'number') {
                setRemainingWorships(data.remainingWorshipsToday);
              }
            })
          : tab === 'daily'
            ? api.dailyWinners(30).then((data) => {
                if (cancelled) return;
                setDailyEntries(data.entries);
                setDailyDay(data.dayKey);
              })
            : tab === 'stock'
              ? api.getStockLeaderboard(30).then((data) => {
                  if (cancelled) return;
                  setStockEntries(data.entries);
                })
              : api.leaderboardRewards().then((data) => {
                  if (cancelled) return;
                  setRewards(data.entries);
                  setRewardDay(data.dayKey);
                });

    task
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载排行榜失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab]);

  const handleWorship = async (targetUserId: string, targetNickname: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (worshippingId || remainingWorships <= 0) return;
    if (targetUserId === myUserId) {
      audio.play('alert');
      showToast('不能膜拜自己哦~');
      return;
    }

    setWorshippingId(targetUserId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const heartItem = { id: `${targetUserId}-${Date.now()}`, x: rect.left + 20, y: rect.top - 10 };
    setFlyingHearts((prev) => [...prev, heartItem]);
    window.setTimeout(() => {
      setFlyingHearts((prev) => prev.filter((h) => h.id !== heartItem.id));
    }, 1200);

    try {
      audio.play('worship');
      const res = await api.worshipUser(targetUserId);
      setRemainingWorships(res.remainingToday);

      setEntries((prev) =>
        prev.map((row) =>
          row.userId === targetUserId ? { ...row, worshipCount: res.newWorshipCount } : row,
        ),
      );
      setLevelEntries((prev) =>
        prev.map((row) =>
          row.userId === targetUserId ? { ...row, worshipCount: res.newWorshipCount } : row,
        ),
      );

      if (onBalanceChange && res.reward > 0) {
        onBalanceChange(
          (window as unknown as { __cc_last_bal?: number }).__cc_last_bal
            ? (window as unknown as { __cc_last_bal: number }).__cc_last_bal + res.reward
            : res.reward,
        );
      }

      showToast(`🙏 膜拜【${targetNickname}】成功！获得筹码奖励 +${res.reward}！`);
    } catch (err) {
      audio.play('alert');
      showToast(err instanceof Error ? err.message : '膜拜失败');
    } finally {
      setWorshippingId(null);
    }
  };

  const isLevelTab = tab === 'level';
  const podiumItems = isLevelTab ? levelEntries.slice(0, 3) : entries.slice(0, 3);

  return (
    <div className="full-screen-view leaderboard-view">
      {/* 顶部统一返回条 */}
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconTrophy size={22} />
          <h2>至尊名人堂</h2>
          <span className="view-sub">
            {tab === 'level'
              ? '账号等级与流水巅峰榜 · 最高 Lv.100 雀坛宗师 · 点击头像查看战绩'
              : tab === 'daily'
                ? '今日牌桌净胜筹码榜 · 实时结算展示当日战神'
                : tab === 'stock'
                  ? '改命股市净盈亏总榜 · 已实现收益 + 实时持仓浮盈'
                  : '筹码财富巅峰排行 · 点击玩家查看名片与战绩 · 膜拜赢金币'}
          </span>
        </div>
        <div className="view-tabs-group">
          <button
            type="button"
            className={`view-tab-btn ${tab === 'total' ? 'is-active' : ''}`}
            onClick={() => setTab('total')}
          >
            💰 财富总榜
          </button>
          <button
            type="button"
            className={`view-tab-btn ${tab === 'level' ? 'is-active' : ''}`}
            onClick={() => setTab('level')}
          >
            ⭐ 等级排行
          </button>
          <button
            type="button"
            className={`view-tab-btn ${tab === 'daily' ? 'is-active' : ''}`}
            onClick={() => setTab('daily')}
          >
            🌞 今日赢分王
          </button>
          <button
            type="button"
            className={`view-tab-btn ${tab === 'stock' ? 'is-active' : ''}`}
            onClick={() => setTab('stock')}
          >
            📈 股神榜
          </button>
          <button
            type="button"
            className={`view-tab-btn ${tab === 'reward' ? 'is-active' : ''}`}
            onClick={() => setTab('reward')}
          >
            🏆 昨日殊荣
          </button>
        </div>
      </header>

      {toast && <div className="rank-toast-banner">{toast}</div>}

      {/* 主体横向分栏 */}
      <main className="view-main rank-layout">
        {tab === 'total' || tab === 'level' ? (
          <>
            {/* 左侧前三甲神坛展台 */}
            <aside className="rank-podium-card">
              <div className="podium-header">
                <IconCrown size={28} />
                <h3>{isLevelTab ? '等级三甲' : '至尊三甲'}</h3>
              </div>
              <div className="podium-slots">
                {podiumItems.map((item, idx) => (
                  <div key={item.userId} className={`podium-slot slot--${idx + 1}`}>
                    <div className="podium-crown">{idx === 0 ? '👑' : idx === 1 ? '🥈' : '🥉'}</div>
                    <div
                      className="podium-avatar-box"
                      onClick={() => {
                        audio.play('click');
                        setCardUserId(item.userId);
                      }}
                      title="点击查看玩家战绩名片"
                    >
                      <AvatarWithFrame
                        nickname={item.nickname}
                        avatar={item.avatar}
                        frameId={item.equippedFrame}
                        size={64}
                        showCrown={idx === 0}
                      />
                    </div>
                    <strong className="podium-name">{item.nickname}</strong>
                    <span className="podium-title-tag">
                      {'levelTitle' in item ? item.levelTitle : titleOf(idx + 1)}
                    </span>
                    <div className="podium-worship-tag">
                      ❤️ 膜拜 {item.worshipCount?.toLocaleString() ?? 0} 次
                    </div>
                    <div className="podium-chips">
                      {'level' in item ? (
                        <span className="rank-level-pill">
                          Lv.{item.level} · 流水 {formatTurnover(item.totalTurnover)}
                        </span>
                      ) : (
                        <>
                          <Chip size={14} />
                          <span>{item.balance.toLocaleString()}</span>
                        </>
                      )}
                    </div>
                    {item.userId !== myUserId && (
                      <button
                        type="button"
                        className="btn-podium-worship"
                        disabled={remainingWorships <= 0 || worshippingId === item.userId}
                        onClick={(e) => handleWorship(item.userId, item.nickname, e)}
                      >
                        🙏 膜拜大神
                      </button>
                    )}
                  </div>
                ))}
                {podiumItems.length === 0 && <p className="hint">虚位以待，等你登顶</p>}
              </div>

              <div className="my-rank-status-bar">
                <div className="rank-status-row">
                  <span>
                    {isLevelTab ? '我的等级榜名次' : '我的财富榜名次'}:{' '}
                    <strong>{myRank ? `第 ${myRank} 名` : '未上榜'}</strong>
                  </span>
                </div>
                <div className="worship-status-row">
                  <span>今日膜拜机会: <strong className="text-gold">{remainingWorships}/10</strong> 次</span>
                </div>
              </div>
            </aside>

            {/* 右侧完整榜单 */}
            <section className="rank-table-panel">
              {error && <div className="luxury-alert is-error">{error}</div>}
              {loading && <div className="view-loading">正在拉取名人堂战绩…</div>}

              <div className="rank-table-list">
                {isLevelTab
                  ? levelEntries.map((item) => {
                      const isMe = item.userId === myUserId;
                      return (
                        <div
                          key={item.userId}
                          className={`rank-item-card ${isMe ? 'is-me' : ''} ${item.rank <= 3 ? `is-top${item.rank}` : ''}`}
                        >
                          <div className="rank-index-col">
                            <span className="rank-badge-num">
                              {item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank}
                            </span>
                          </div>
                          <div
                            className="rank-user-col"
                            onClick={() => {
                              audio.play('click');
                              setCardUserId(item.userId);
                            }}
                            title="点击查看玩家战绩与名片"
                          >
                            <AvatarWithFrame
                              nickname={item.nickname}
                              avatar={item.avatar}
                              frameId={item.equippedFrame}
                              size={46}
                              showCrown={item.rank === 1}
                            />
                            <div className="rank-user-text">
                              <div className="name-and-tag">
                                <strong>{item.nickname}</strong>
                                {isMe && <em className="tag-self">我</em>}
                              </div>
                              <span className="worship-mini-badge">
                                🌊 累计流水 {formatTurnover(item.totalTurnover)} · ❤️ 膜拜 {item.worshipCount ?? 0}
                              </span>
                            </div>
                          </div>
                          <div className="rank-title-col">
                            <span className={`title-pill title-pill--${Math.min(item.rank, 10)}`}>
                              {item.levelTitle}
                            </span>
                          </div>
                          <div className="rank-balance-col">
                            <span className="rank-level-pill rank-level-pill--lg">Lv.{item.level}</span>
                          </div>
                          <div className="rank-worship-action-col">
                            {!isMe && (
                              <button
                                type="button"
                                className="btn-rank-worship"
                                disabled={remainingWorships <= 0 || worshippingId === item.userId}
                                onClick={(e) => handleWorship(item.userId, item.nickname, e)}
                                title="膜拜大神，每日限10次，每次获赠 188 筹码"
                              >
                                🙏 膜拜
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  : entries.map((item) => {
                      const isMe = item.userId === myUserId;
                      return (
                        <div
                          key={item.userId}
                          className={`rank-item-card ${isMe ? 'is-me' : ''} ${item.rank <= 3 ? `is-top${item.rank}` : ''}`}
                        >
                          <div className="rank-index-col">
                            <span className="rank-badge-num">
                              {item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank}
                            </span>
                          </div>
                          <div
                            className="rank-user-col"
                            onClick={() => {
                              audio.play('click');
                              setCardUserId(item.userId);
                            }}
                            title="点击查看玩家战绩与名片"
                          >
                            <AvatarWithFrame
                              nickname={item.nickname}
                              avatar={item.avatar}
                              frameId={item.equippedFrame}
                              size={46}
                              showCrown={item.rank === 1}
                            />
                            <div className="rank-user-text">
                              <div className="name-and-tag">
                                <strong>{item.nickname}</strong>
                                {isMe && <em className="tag-self">我</em>}
                              </div>
                              <span className="worship-mini-badge">
                                ❤️ 被膜拜 {item.worshipCount?.toLocaleString() ?? 0} 次
                              </span>
                            </div>
                          </div>
                          <div className="rank-title-col">
                            <span className={`title-pill title-pill--${item.rank}`}>{titleOf(item.rank)}</span>
                          </div>
                          <div className="rank-balance-col">
                            <Chip size={16} />
                            <strong>{item.balance.toLocaleString()}</strong>
                          </div>
                          <div className="rank-worship-action-col">
                            {!isMe && (
                              <button
                                type="button"
                                className="btn-rank-worship"
                                disabled={remainingWorships <= 0 || worshippingId === item.userId}
                                onClick={(e) => handleWorship(item.userId, item.nickname, e)}
                                title="膜拜大神，每日限10次，每次获赠 188 筹码"
                              >
                                🙏 膜拜
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
              </div>
            </section>
          </>
        ) : tab === 'daily' ? (
          <section className="rank-reward-full">
            <div className="reward-day-pill">统计日期：{dailyDay || '今日'} · 今日牌桌净赢分榜</div>
            <div className="rank-table-list">
              {dailyEntries.map((row, idx) => (
                <div
                  key={row.userId}
                  className={`rank-item-card ${row.userId === myUserId ? 'is-me' : ''} ${idx < 3 ? `is-top${idx + 1}` : ''}`}
                  onClick={() => setCardUserId(row.userId)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="rank-index-col">
                    <span className="rank-badge-num">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </span>
                  </div>
                  <div className="rank-user-col">
                    <strong>{row.nickname}</strong>
                    <span className="worship-mini-badge">今日有效局数 {row.rounds} 局 · 点击查看名片</span>
                  </div>
                  <div className="rank-balance-col">
                    <Chip size={16} />
                    <strong className={row.net >= 0 ? 'up' : 'down'}>
                      {row.net >= 0 ? `+${row.net.toLocaleString()}` : row.net.toLocaleString()}
                    </strong>
                  </div>
                </div>
              ))}
              {!loading && dailyEntries.length === 0 && (
                <p className="hint">今日暂未产生净赢分记录，快开一局争当今日榜首！</p>
              )}
            </div>
          </section>
        ) : tab === 'stock' ? (
          <section className="rank-reward-full">
            <div className="reward-day-pill">改命股市股神榜 · 按已实现盈亏 + 持仓浮盈排行</div>
            <div className="rank-table-list">
              {stockEntries.map((row) => (
                <div
                  key={row.userId}
                  className={`rank-item-card ${row.userId === myUserId ? 'is-me' : ''} ${row.rank <= 3 ? `is-top${row.rank}` : ''}`}
                  onClick={() => setCardUserId(row.userId)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="rank-index-col">
                    <span className="rank-badge-num">
                      {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}
                    </span>
                  </div>
                  <div className="rank-user-col">
                    <AvatarWithFrame
                      nickname={row.nickname}
                      avatar={row.avatar}
                      frameId={row.equippedFrame}
                      size={42}
                      showCrown={row.rank === 1}
                    />
                    <div className="rank-user-text">
                      <strong>{row.nickname}</strong>
                      <span className="worship-mini-badge">
                        持仓市值 {row.totalMarketValue.toLocaleString()} · 浮盈 {row.totalFloatingPnl >= 0 ? `+${row.totalFloatingPnl.toLocaleString()}` : row.totalFloatingPnl.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="rank-balance-col">
                    <strong className={row.totalStockScore >= 0 ? 'up' : 'down'}>
                      总战绩 {row.totalStockScore >= 0 ? `+${row.totalStockScore.toLocaleString()}` : row.totalStockScore.toLocaleString()} 豆
                    </strong>
                  </div>
                </div>
              ))}
              {!loading && stockEntries.length === 0 && (
                <p className="hint">股市风云初起，前往「改命股市」买入或做空即可上榜！</p>
              )}
            </div>
          </section>
        ) : (
          <section className="rank-reward-full">
            <div className="reward-day-pill">统计日期：{rewardDay || '今日'}</div>
            <div className="rank-table-list">
              {rewards.map((row) => (
                <div
                  key={row.userId}
                  className="rank-item-card"
                  onClick={() => setCardUserId(row.userId)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="rank-index-col">
                    <span className="rank-badge-num">{row.rank}</span>
                  </div>
                  <div className="rank-user-col">
                    <strong>{row.nickname}</strong>
                  </div>
                  <div className="rank-title-col">
                    <span className="title-pill">{titleOf(row.rank)}</span>
                  </div>
                  <div className="rank-balance-col">
                    <span className="reward-hint">获得头衔：{titleOf(row.rank)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* 膜拜浮动爱心 */}
      {flyingHearts.map((h) => (
        <div
          key={h.id}
          className="flying-worship-heart"
          style={{ left: h.x, top: h.y }}
        >
          💖 膜拜 +188!
        </div>
      ))}

      {cardUserId && (
        <PlayerCardModal
          userId={cardUserId}
          onClose={() => setCardUserId(null)}
          onWorshipDone={(newBal) => {
            if (typeof newBal === 'number' && onBalanceChange) onBalanceChange(newBal);
          }}
        />
      )}
    </div>
  );
}
