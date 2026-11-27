import { useEffect, useState } from 'react';
import { api, type PlayerCardView } from '../api';
import { audio } from '../audio';
import { AvatarWithFrame } from './AvatarWithFrame';
import { Chip } from './Chip';

interface Props {
  userId: string;
  onClose: () => void;
  onWorshipDone?: (newBalance?: number) => void;
}

/**
 * 玩家个人名片轻量弹窗（用于牌桌点击头像、排行榜点击查看战绩、加好友与膜拜）
 */
export function PlayerCardModal({ userId, onClose, onWorshipDone }: Props) {
  const [card, setCard] = useState<PlayerCardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void api
      .playerCard(userId)
      .then((res) => {
        if (alive) setCard(res);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '加载玩家名片失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const handleAddFriend = async () => {
    if (!card || busy || card.isFriend || card.isSelf) return;
    audio.play('click');
    setBusy(true);
    try {
      await api.requestFriend(card.userId, '同桌交个朋友吧！');
      audio.play('coin');
      setMsg('✅ 好友申请已发送！');
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : '发送申请失败');
    } finally {
      setBusy(false);
    }
  };

  const handleWorship = async () => {
    if (!card || busy || card.isSelf) return;
    audio.play('worship');
    setBusy(true);
    try {
      const res = await api.worshipUser(card.userId);
      setCard((prev) => (prev ? { ...prev, worshipCount: res.newWorshipCount } : prev));
      setMsg(res.message || `🙏 膜拜成功！获得 +${res.reward} 筹码`);
      onWorshipDone?.();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : '膜拜失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="luxury-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="玩家名片">
      <div className="player-card-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="player-card-modal__close" onClick={onClose} aria-label="关闭名片">
          ✕
        </button>

        {loading && <div className="player-card-modal__state">正在读取牌友档案…</div>}
        {error && !loading && <div className="player-card-modal__state is-error">{error}</div>}

        {card && !loading && (
          <>
            <div className="player-card-modal__head">
              <AvatarWithFrame
                nickname={card.nickname}
                avatar={card.avatar}
                frameId={card.equippedFrame}
                size={68}
              />
              <div className="player-card-modal__title">
                <div className="player-card-modal__name-row">
                  <h3>{card.nickname}</h3>
                  <span className="app-level-pill">Lv.{card.level}</span>
                  {card.rank && card.rank <= 10 && <span className="player-card-rank-tag">全服 #{card.rank}</span>}
                </div>
                <p className="player-card-modal__bio">{card.bio || '这位高手很神秘，尚未留下签名~'}</p>
              </div>
            </div>

            <div className="player-card-modal__stats">
              <div className="pc-stat-item">
                <span>当前身家</span>
                <strong>
                  <Chip size={14} /> {card.balance.toLocaleString()}
                </strong>
              </div>
              <div className="pc-stat-item">
                <span>对局 / 胜率</span>
                <strong>
                  {card.played}局 · {card.winRate}%
                </strong>
              </div>
              <div className="pc-stat-item">
                <span>单局最高赢</span>
                <strong className="is-gold">+{card.bestWin.toLocaleString()}</strong>
              </div>
              <div className="pc-stat-item">
                <span>获膜拜人气</span>
                <strong>🙏 {card.worshipCount}</strong>
              </div>
            </div>

            {msg && <div className="player-card-modal__msg">{msg}</div>}

            {!card.isSelf && (
              <div className="player-card-modal__actions">
                <button
                  type="button"
                  className="pc-btn pc-btn--gold"
                  disabled={busy}
                  onClick={() => void handleWorship()}
                >
                  🙏 膜拜领福利
                </button>
                <button
                  type="button"
                  className="pc-btn pc-btn--ghost"
                  disabled={busy || card.isFriend}
                  onClick={() => void handleAddFriend()}
                >
                  {card.isFriend ? '✓ 已是好友' : '＋ 加为好友'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
