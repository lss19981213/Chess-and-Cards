import { useEffect, useState } from 'react';
import { api, type LeaderboardEntry, type LeaderboardRewardRow } from '../api';
import { audio } from '../audio';
import { AvatarWithFrame } from './AvatarWithFrame';
import { Chip } from './Chip';
import { IconBack, IconCrown, IconTrophy } from './Icons';

interface Props {
  myUserId: string | null;
  onBalanceChange?: (newBalance: number) => void;
  onBack: () => void;
}

type Tab = 'total' | 'reward';

const RANK_TITLES = ['赌神', '赌圣', '赌侠', '赌王', '赌将', '豪侠', '名手', '高手', '老手', '新星'];

function titleOf(rank: number): string {
  return RANK_TITLES[rank - 1] ?? '座上宾';
}

export function LeaderboardView({ myUserId, onBalanceChange, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('total');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [rewards, setRewards] = useState<LeaderboardRewardRow[]>([]);
  const [rewardDay, setRewardDay] = useState('');
  const [myRank, setMyRank] = useState<number | null>(null);
  const [remainingWorships, setRemainingWorships] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [worshippingId, setWorshippingId] = useState<string | null>(null);
  const [flyingHearts, setFlyingHearts] = useState<{ id: string; x: number; y: number }[]>([]);
  const [toast, setToast] = useState<string | null>(null);

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

      // 本地乐观更新目标玩家被膜拜次数
      setEntries((prev) =>
        prev.map((row) =>
          row.userId === targetUserId ? { ...row, worshipCount: res.newWorshipCount } : row,
        ),
      );

      // 更新筹码余额
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

  const topThree = entries.slice(0, 3);

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
          <span className="view-sub">筹码财富巅峰排行 · 每日结算尊贵头衔 · 膜拜赢金币</span>
        </div>
        <div className="view-tabs-group">
          <button
            type="button"
            className={`view-tab-btn ${tab === 'total' ? 'is-active' : ''}`}
            onClick={() => setTab('total')}
          >
            财富总榜
          </button>
          <button
            type="button"
            className={`view-tab-btn ${tab === 'reward' ? 'is-active' : ''}`}
            onClick={() => setTab('reward')}
          >
            昨日殊荣
          </button>
        </div>
      </header>

      {toast && <div className="rank-toast-banner">{toast}</div>}

      {/* 主体横向分栏 */}
      <main className="view-main rank-layout">
        {tab === 'total' ? (
          <>
            {/* 左侧前三甲神坛展台 */}
            <aside className="rank-podium-card">
              <div className="podium-header">
                <IconCrown size={28} />
                <h3>至尊三甲</h3>
              </div>
              <div className="podium-slots">
                {topThree.map((item, idx) => (
                  <div key={item.userId} className={`podium-slot slot--${idx + 1}`}>
                    <div className="podium-crown">{idx === 0 ? '👑' : idx === 1 ? '🥈' : '🥉'}</div>
                    <div
                      className="podium-avatar-box"
                      onClick={(e) => item.userId !== myUserId && handleWorship(item.userId, item.nickname, e)}
                      title={item.userId !== myUserId ? '点击膜拜大奖得主，获赠 +188 筹码' : '这是你自己'}
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
                    <span className="podium-title-tag">{titleOf(idx + 1)}</span>
                    <div className="podium-worship-tag">
                      ❤️ 膜拜 {item.worshipCount?.toLocaleString() ?? 0} 次
                    </div>
                    <div className="podium-chips">
                      <Chip size={14} />
                      <span>{item.balance.toLocaleString()}</span>
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
                {topThree.length === 0 && <p className="hint">虚位以待，等你登顶</p>}
              </div>

              <div className="my-rank-status-bar">
                <div className="rank-status-row">
                  <span>我的排名: <strong>{myRank ? `第 ${myRank} 名` : '未上榜'}</strong></span>
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
                {entries.map((item) => {
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
                        onClick={(e) => !isMe && handleWorship(item.userId, item.nickname, e)}
                        title={!isMe ? '点击膜拜该玩家' : '这是你自己'}
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
        ) : (
          <section className="rank-reward-full">
            <div className="reward-day-pill">统计日期：{rewardDay || '今日'}</div>
            <div className="rank-table-list">
              {rewards.map((row) => (
                <div key={row.userId} className="rank-item-card">
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
    </div>
  );
}
