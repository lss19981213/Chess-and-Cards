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
  { id: 'flower', name: '送鲜花', icon: '🌹', cost: 10, quote: '“哇！谢谢老板的鲜花喔～爱丽丝心里甜甜的呢！🌸”' },
  { id: 'heart', name: '比个心', icon: '💖', cost: 50, quote: '“收到老板的爱心啦～爱丽丝给你比大大的心心喔！💖”' },
  { id: 'champagne', name: '开香槟', icon: '🍾', cost: 100, quote: '“嘭！开香槟庆祝啦～祝老板财运通天，把把都大赢喔！🍾✨”' },
  { id: 'supercar', name: '送超跑', icon: '🏎️', cost: 500, quote: '“天呐！豪华超跑耶！老板太帅太阔气了啦～爱丽丝永远陪在你身边喔！🏎️👑”' },
  { id: 'yacht', name: '豪华游艇', icon: '🛥️', cost: 1000, quote: '“哇塞！私人豪华游艇！爱丽丝好感动喔～愿为老板献上最甜蜜的陪伴！🛥️👑💖”' },
  { id: 'sportscar', name: '跑车', icon: '🚘', cost: 2000, quote: '“哇塞！至尊限量跑车耶～老板真的太宠人家了啦，爱丽丝要坐你副驾兜风喔！🚘✨💖”' },
  { id: 'carnival', name: '嘉年华', icon: '🎡', cost: 5000, quote: '“天呐！！梦幻至尊嘉年华！！烟花绽放全场沸腾啦～老板就是爱丽丝心中最闪耀的超级男神喔！🎡🎆👑💖”' },
];

const QTY_PRESETS = [1, 5, 10, 52, 99] as const;
const MAX_TIP_QTY = 999;

interface Props {
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  onAffectionChange?: (newAffection: number) => void;
  onAliceSpeak?: (text: string) => void;
  className?: string;
}

export function DealerTipWidget({ balance, onBalanceChange, onAffectionChange, onAliceSpeak, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
  const [qtyInput, setQtyInput] = useState<string>('1');
  const [flyingGift, setFlyingGift] = useState<{ icon: string; name: string; qty: number } | null>(null);
  const [tipToast, setTipToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const applyQuantity = (next: number) => {
    const clamped = Math.max(1, Math.min(MAX_TIP_QTY, Math.floor(next) || 1));
    setQuantity(clamped);
    setQtyInput(String(clamped));
  };

  const handleQtyInputChange = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '').slice(0, 3);
    setQtyInput(digits);
    if (digits) {
      const parsed = Math.max(1, Math.min(MAX_TIP_QTY, Number(digits)));
      setQuantity(parsed);
    }
  };

  const handleQtyInputBlur = () => {
    applyQuantity(Number(qtyInput) || 1);
  };

  const closeMenu = () => {
    setOpen(false);
    applyQuantity(1);
  };

  const handleTip = async (gift: GiftOption, e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;

    const safeQty = Math.max(1, Math.min(MAX_TIP_QTY, Math.floor(quantity) || 1));
    const totalCost = gift.cost * safeQty;

    if (balance < totalCost) {
      audio.play('alert');
      showTipNotice(`筹码不足！打赏 ${gift.name} ×${safeQty} 需要 ${totalCost.toLocaleString()} 欢乐豆～`);
      return;
    }

    setLoading(true);
    try {
      audio.play('coin');
      const res = await api.tipDealer(totalCost, gift.name, safeQty);
      // 服务端确认扣款成功后才播放庆祝动画，避免"假打赏"
      triggerFlyAnimation(gift, safeQty);
      if (onAliceSpeak) onAliceSpeak(gift.quote);
      onBalanceChange(res.balance);
      if (onAffectionChange && typeof res.affection === 'number') {
        onAffectionChange(res.affection);
      }
      const qtyLabel = safeQty > 1 ? ` ×${safeQty}` : '';
      showTipNotice(
        `感谢打赏 ${gift.name}${qtyLabel}！艾莉丝好感度 +${totalCost.toLocaleString()}（当前 ${(res.affection ?? 0).toLocaleString()}）💖`,
      );
      audio.play('shunzi');
      closeMenu();
    } catch (error) {
      audio.play('alert');
      showTipNotice(error instanceof Error ? error.message : '打赏失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const triggerFlyAnimation = (gift: GiftOption, qty: number) => {
    setFlyingGift({ icon: gift.icon, name: gift.name, qty });
    window.setTimeout(() => setFlyingGift(null), 1600);
  };

  const showTipNotice = (msg: string) => {
    setTipToast(msg);
    window.setTimeout(() => setTipToast(null), 3000);
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
          if (open) closeMenu();
          else setOpen(true);
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
            <button type="button" className="tip-menu-close" onClick={closeMenu}>
              ✕
            </button>
          </div>

          {/* 道具打赏数量选择器 */}
          <div className="tip-qty-panel">
            <div className="tip-qty-top">
              <span className="tip-qty-label">打赏数量</span>
              <div className="tip-qty-stepper">
                <button
                  type="button"
                  className="tip-qty-step-btn"
                  onClick={() => {
                    audio.play('click');
                    applyQuantity(quantity - 1);
                  }}
                  disabled={quantity <= 1}
                  aria-label="减少数量"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  className="tip-qty-input"
                  value={qtyInput}
                  onChange={(e) => handleQtyInputChange(e.target.value)}
                  onBlur={handleQtyInputBlur}
                  aria-label="自定义打赏数量"
                />
                <button
                  type="button"
                  className="tip-qty-step-btn"
                  onClick={() => {
                    audio.play('click');
                    applyQuantity(quantity + 1);
                  }}
                  disabled={quantity >= MAX_TIP_QTY}
                  aria-label="增加数量"
                >
                  +
                </button>
              </div>
            </div>
            <div className="tip-qty-presets">
              {QTY_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`tip-qty-pill ${quantity === n ? 'is-active' : ''}`}
                  onClick={() => {
                    audio.play('click');
                    applyQuantity(n);
                  }}
                >
                  ×{n}
                </button>
              ))}
            </div>
          </div>

          <div className="tip-gifts-grid">
            {DEALER_GIFTS.map((g) => {
              const totalCost = g.cost * quantity;
              const affordable = balance >= totalCost;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`tip-gift-card ${g.id === 'carnival' ? 'tip-gift-card--grand' : ''} ${!affordable ? 'is-disabled' : ''}`}
                  onClick={(e) => handleTip(g, e)}
                  disabled={loading}
                  title={`${g.name} ×${quantity} (共消耗 ${totalCost.toLocaleString()} 筹码，好感度 +${totalCost.toLocaleString()})`}
                >
                  {quantity > 1 && <span className="gift-qty-badge">×{quantity}</span>}
                  <span className="gift-icon">{g.icon}</span>
                  <span className="gift-name">{g.name}</span>
                  <div className="gift-price">
                    <Chip size={12} />
                    <span>{totalCost.toLocaleString()}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="tip-menu-footer">
            <span>
              当前可用: <strong>{balance.toLocaleString()}</strong> 欢乐豆
            </span>
          </div>
        </div>
      )}

      {/* 飞行动画粒子 */}
      {flyingGift && (
        <div className="flying-gift-fx">
          <span className="flying-gift-icon">{flyingGift.icon}</span>
          {flyingGift.qty > 1 && <span className="flying-gift-qty">×{flyingGift.qty}</span>}
          <span className="flying-gift-heart">💖</span>
          <span className="flying-gift-sparkle">✨</span>
        </div>
      )}

      {/* 轻量打赏提示条 */}
      {tipToast && <div className="tip-feedback-toast">{tipToast}</div>}
    </div>
  );
}
