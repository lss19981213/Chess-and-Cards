import { useState } from 'react';
import { api } from '../api';
import { audio } from '../audio';
import { Chip } from './Chip';

export interface GiftOption {
  id: string;
  name: string;
  icon: string;
  cost: number;
  quote: string;
}

export const DEALER_GIFTS: GiftOption[] = [
  { id: 'flower', name: '送鲜花', icon: '🌹', cost: 10, quote: '“哇！谢谢主人的鲜花～艾莉丝心里甜甜的！🌸”' },
  { id: 'heart', name: '比个心', icon: '💖', cost: 50, quote: '“收到主人的爱心啦～艾莉丝给主人比大大的心心！(≧▽≦)～💖”' },
  { id: 'champagne', name: '开香槟', icon: '🍾', cost: 100, quote: '“嘭！开香槟庆祝～祝主人财运通天，局局暴富！🍾✨”' },
  { id: 'supercar', name: '送超跑', icon: '🏎️', cost: 500, quote: '“天呐！豪华超跑！主人太帅太阔气了～艾莉丝永远是您的专属荷官！🏎️👑💖”' },
];

interface Props {
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  onAliceSpeak?: (text: string) => void;
  className?: string;
}

export function DealerTipWidget({ balance, onBalanceChange, onAliceSpeak, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [flyingGift, setFlyingGift] = useState<{ icon: string; name: string } | null>(null);
  const [tipToast, setTipToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTip = async (gift: GiftOption, e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;

    if (balance < gift.cost) {
      audio.play('alert');
      showTipNotice('筹码不足，快去领每日福利或在对局中大赢一把吧～');
      return;
    }

    setLoading(true);
    try {
      audio.play('coin');
      const res = await api.tipDealer(gift.cost, gift.name);
      // 服务端确认扣款成功后才播放庆祝动画，避免"假打赏"
      triggerFlyAnimation(gift);
      if (onAliceSpeak) onAliceSpeak(gift.quote);
      onBalanceChange(res.balance);
      showTipNotice(`感谢打赏 ${gift.name}！艾莉丝好感度 +${gift.cost} 💖`);
      audio.play('shunzi');
      setOpen(false);
    } catch (error) {
      audio.play('alert');
      showTipNotice(error instanceof Error ? error.message : '打赏失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const triggerFlyAnimation = (gift: GiftOption) => {
    setFlyingGift({ icon: gift.icon, name: gift.name });
    window.setTimeout(() => setFlyingGift(null), 1600);
  };

  const showTipNotice = (msg: string) => {
    setTipToast(msg);
    window.setTimeout(() => setTipToast(null), 2800);
  };

  return (
    <div className={`dealer-tip-widget ${className}`}>
      {/* 打赏触发主按钮 */}
      <button
        type="button"
        className="btn-tip-dealer-gold"
        onClick={(e) => {
          e.stopPropagation();
          audio.play('click');
          setOpen(!open);
        }}
        title="给美女荷官艾莉丝打赏礼物"
      >
        <span className="tip-btn-icon">💖</span>
        <span className="tip-btn-text">打赏荷官</span>
      </button>

      {/* 弹出的轻量打赏气泡菜单 (非阻断式) */}
      {open && (
        <div className="tip-menu-bubble" onClick={(e) => e.stopPropagation()}>
          <div className="tip-menu-header">
            <span>🎁 打赏荷官 · 艾莉丝</span>
            <button type="button" className="tip-menu-close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="tip-gifts-grid">
            {DEALER_GIFTS.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`tip-gift-card ${balance < g.cost ? 'is-disabled' : ''}`}
                onClick={(e) => handleTip(g, e)}
                disabled={loading}
                title={`${g.name} (消耗 ${g.cost} 筹码)`}
              >
                <span className="gift-icon">{g.icon}</span>
                <span className="gift-name">{g.name}</span>
                <div className="gift-price">
                  <Chip size={12} />
                  <span>{g.cost}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="tip-menu-footer">
            <span>当前可用: <strong>{balance.toLocaleString()}</strong> 欢乐豆</span>
          </div>
        </div>
      )}

      {/* 飞行动画粒子 */}
      {flyingGift && (
        <div className="flying-gift-fx">
          <span className="flying-gift-icon">{flyingGift.icon}</span>
          <span className="flying-gift-heart">💖</span>
          <span className="flying-gift-sparkle">✨</span>
        </div>
      )}

      {/* 轻量打赏提示条 */}
      {tipToast && <div className="tip-feedback-toast">{tipToast}</div>}
    </div>
  );
}
