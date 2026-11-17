import { useEffect, useState } from 'react';
import { api, type LeaderboardEntry, type LeaderboardRewardRow } from '../api';
import { audio } from '../audio';
import { AvatarWithFrame } from './AvatarWithFrame';
import { Chip } from './Chip';

interface Props {
  myUserId: string | null;
  onBalanceChange?: (newBalance: number) => void;
  onClose: () => void;
}

type Tab = 'total' | 'reward';

const RANK_TITLES = ['赌神', '赌圣', '赌侠', '赌王', '赌将', '豪侠', '名手', '高手', '老手', '新星'];

function titleOf(rank: number): string {
  return RANK_TITLES[rank - 1] ?? '座上宾';
}

export function LeaderboardModal({ myUserId, onBalanceChange, onClose }: Props) {
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

      // 若有余额变更回调，更新本地金币 (+188)
      if (onBalanceChange && res.reward > 0) {
        onBalanceChange((window as unknown as { __cc_last_bal?: number }).__cc_last_bal ? (window as unknown as { __cc_last_bal: number }).__cc_last_bal + res.reward : res.reward);
      }

      showToast(`🙏 膜拜【${targetNickname}】成功！获得筹码奖励 +${res.reward}！`);
    } catch (err) {
      audio.play('alert');
      showToast(err instanceof Error ? err.message : '膜拜失败');
    } finally {
      setWorshippingId(null);
    }
  };

  const rows =
    tab === 'total'
      ? entries.map((row) => ({
          key: row.userId,
          rank: row.rank,
          userId: row.userId,
          nickname: row.nickname,
          balance: row.balance,
          title: row.title || titleOf(row.rank),
          reward: row.reward,
          worshipCount: row.worshipCount ?? 0,
          equippedFrame: row.equippedFrame ?? 'frame_default',
          avatar: row.avatar ?? null,
        }))
      : rewards.map((row) => ({
          key: row.userId,
          rank: row.rank,
          userId: row.userId,
          nickname: row.nickname,
          balance: row.balance,
          title: titleOf(row.rank),
          reward: row.reward,
          worshipCount: 0,
          equippedFrame: 'frame_default',
          avatar: null,
        }));

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal rank-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head rank-modal__head">
          <div>
            <h2 className="rank-modal__heading">🏆 豪 强 富 豪 榜</h2>
            <p className="rank-modal__sub">每日 0 点结算发放筹码 · 点击大神头像膜拜即可获赠金币</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {toast && <div className="rank-toast-banner">{toast}</div>}

        <div className="rank-tabs">
          <button
            type="button"
            className={tab === 'total' ? 'is-active' : ''}
            onClick={() => setTab('total')}
          >
            筹码总榜
          </button>
          <button
            type="button"
            className={tab === 'reward' ? 'is-active' : ''}
            onClick={() => setTab('reward')}
          >
            上期奖励
          </button>
        </div>

        {tab === 'total' && (
          <div className="rank-modal__mine rank-modal__mine--enhanced">
            <div className="mine-rank-text">
              {myRank !== null ? (
                <>
                  我的名次 <b>第 {myRank} 名</b>
                  {myRank > 10 && <span>（进入前 10 可获每日丰厚奖励）</span>}
                </>
              ) : (
                <span>登录后可查看自己的榜单名次</span>
              )}
            </div>

            <div className="mine-worship-quota">
              <span>今日膜拜机会: </span>
              <b className={remainingWorships > 0 ? 'text-gold' : 'text-gray'}>
                {remainingWorships}/10
              </b>
              <span> 次</span>
              <span className="worship-tip-tag">（每次赠 +188 筹码）</span>
            </div>
          </div>
        )}

        {tab === 'reward' && rewardDay && (
          <div className="rank-modal__mine">
            {rewardDay} 结算 · 奖励已全数发放至玩家账户
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        {loading && <p className="hint">加载榜单中…</p>}

        {!loading && rows.length === 0 && (
          <p className="empty">{tab === 'total' ? '暂无数据' : '还没有结算记录，等待今日 0 点'}</p>
        )}

        <ol className="rank-board">
          {rows.map((row) => {
            const isMe = row.userId === myUserId;
            return (
              <li
                key={row.key}
                className={`rank-board__row${row.rank <= 3 ? ` is-top${row.rank}` : ''}${
                  isMe ? ' is-me' : ''
                }`}
              >
                <span className="rank-board__medal">
                  {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}
                </span>

                <div
                  className="rank-board-avatar-clickable"
                  onClick={(e) => !isMe && handleWorship(row.userId, row.nickname, e)}
                  title={!isMe ? '点击膜拜此玩家，获赠 +188 筹码' : '这是你自己'}
                >
                  <AvatarWithFrame
                    nickname={row.nickname}
                    avatar={row.avatar}
                    frameId={row.equippedFrame}
                    size={46}
                    showCrown={row.rank === 1}
                  />
                </div>

                <div className="rank-board__name">
                  <div className="name-title-row">
                    <b>{row.nickname}</b>
                    <em className={`rank-title-badge rank-title-${row.rank}`}>{row.title}</em>
                  </div>
                  {tab === 'total' && (
                    <div className="worship-counter-pill">
                      <span className="heart-icon">💖</span>
                      <span>已获膜拜 {row.worshipCount.toLocaleString()} 次</span>
                    </div>
                  )}
                </div>

                <span className="rank-board__bal">
                  <Chip size={15} />
                  {row.balance.toLocaleString()}
                </span>

                {tab === 'total' && !isMe && (
                  <button
                    type="button"
                    className="btn-rank-worship"
                    disabled={remainingWorships <= 0 || worshippingId === row.userId}
                    onClick={(e) => handleWorship(row.userId, row.nickname, e)}
                    title="膜拜大神，每日限10次，每次获赠 188 筹码"
                  >
                    🙏 膜拜
                  </button>
                )}

                {row.reward > 0 && <span className="rank-board__reward">+{row.reward}</span>}
              </li>
            );
          })}
        </ol>

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

        <p className="rank-modal__foot">
          {tab === 'total'
            ? '榜单每 30 秒刷新一次，0 点结算后按名次发放奖励。每日可膜拜榜单玩家 10 次并赢取回馈筹码。'
            : '上期奖励为每日 0 点结算时的榜单快照，奖励已直接发放到对应账户。'}
        </p>
      </div>
    </div>
  );
}
