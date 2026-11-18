import { useEffect, useState } from 'react';
import { AVATAR_FRAMES, type AvatarFrameMeta, type FrameRarity } from '@cc/protocol';
import { api, type User } from '../api';
import { audio } from '../audio';
import { AvatarWithFrame } from './AvatarWithFrame';
import { Chip } from './Chip';

interface Props {
  user: User;
  onUserUpdate: (updatedUser: Partial<User>) => void;
  onClose: () => void;
}

const RARITY_MAP: Record<FrameRarity, { label: string; color: string; fxDesc: string }> = {
  common: { label: '普通', color: '#94a3b8', fxDesc: '简约经典镶边' },
  rare: { label: '稀有', color: '#38bdf8', fxDesc: '柔光呼吸光晕' },
  epic: { label: '史诗', color: '#c084fc', fxDesc: '流光旋转能量环 + 呼吸辉光' },
  legendary: { label: '传说', color: '#fbbf24', fxDesc: '流光涡环 + 双星轨绕行 + 专属徽章' },
  mythic: { label: '神话', color: '#f43f5e', fxDesc: '三重神辉光环 + 双向星轨法阵 + 浮空神徽 + 脉冲神波' },
};

export function AvatarFrameModal({ user, onUserUpdate, onClose }: Props) {
  const [selectedFrame, setSelectedFrame] = useState<AvatarFrameMeta>(
    AVATAR_FRAMES.find((f) => f.id === user.equippedFrame) || AVATAR_FRAMES[0]!,
  );
  const [ownedFrames, setOwnedFrames] = useState<string[]>([
    'frame_default',
    ...(user.equippedFrame ? [user.equippedFrame] : []),
  ]);
  const [activeRarity, setActiveRarity] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .avatarFramesCatalog()
      .then((res) => {
        if (cancelled) return;
        setOwnedFrames(res.ownedFrames);
        if (res.equippedFrame) {
          const match = AVATAR_FRAMES.find((f) => f.id === res.equippedFrame);
          if (match) setSelectedFrame(match);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const handleEquip = async (frame: AvatarFrameMeta) => {
    if (loading) return;
    setLoading(true);
    try {
      audio.play('click');
      await api.equipAvatarFrame(frame.id);
      audio.play('shunzi');
      onUserUpdate({ equippedFrame: frame.id });
      showToast(`已成功佩戴【${frame.name}】头像框！`);
    } catch (e) {
      audio.play('alert');
      showToast(e instanceof Error ? e.message : '佩戴失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async (frame: AvatarFrameMeta) => {
    if (loading) return;
    if (user.balance < frame.price) {
      audio.play('alert');
      showToast(`筹码不足！需要 ${frame.price.toLocaleString()} 筹码`);
      return;
    }
    setLoading(true);
    try {
      audio.play('coin');
      const res = await api.buyAvatarFrame(frame.id);
      audio.play('win');
      setOwnedFrames(res.ownedFrames);
      onUserUpdate({ balance: res.balance, equippedFrame: res.equippedFrame });
      showToast(`🎉 成功解锁并佩戴【${frame.name}】头像框！`);
    } catch (e) {
      audio.play('alert');
      showToast(e instanceof Error ? e.message : '购买失败');
    } finally {
      setLoading(false);
    }
  };

  const isEquipped = (frameId: string) => user.equippedFrame === frameId;
  const isOwned = (frameId: string) => frameId === 'frame_default' || ownedFrames.includes(frameId);

  const filteredFrames = AVATAR_FRAMES.filter((f) => {
    if (activeRarity === 'all') return true;
    return f.rarity === activeRarity;
  });

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal avatar-frame-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head avatar-frame-modal__head">
          <div className="frame-modal-title-wrap">
            <h2 className="avatar-frame-modal__title">
              <span className="frame-title-icon">🖼️</span> 头像框商城与更衣室
            </h2>
            <p className="avatar-frame-modal__sub">
              内置 {AVATAR_FRAMES.length} 款尊享动态特效头像框 · 全平台大厅、个人中心、排行榜、好友、牌桌同步闪耀
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {toast && <div className="avatar-frame-toast">{toast}</div>}

        <div className="avatar-frame-body">
          {/* 左侧：当前预览区 */}
          <div className="avatar-frame-preview-panel">
            <div className="preview-stage-box">
              <AvatarWithFrame
                nickname={user.nickname}
                avatar={user.avatar}
                frameId={selectedFrame.id}
                size={112}
              />
              <span className="preview-nickname">{user.nickname}</span>
              <span
                className="preview-rarity-badge"
                style={{
                  background: `${RARITY_MAP[selectedFrame.rarity].color}22`,
                  borderColor: RARITY_MAP[selectedFrame.rarity].color,
                  color: RARITY_MAP[selectedFrame.rarity].color,
                }}
              >
                {RARITY_MAP[selectedFrame.rarity].label}
              </span>
              <span className="preview-fx-caption">✦ {RARITY_MAP[selectedFrame.rarity].fxDesc}</span>
            </div>

            <div className="preview-meta-box">
              <h3 className="preview-frame-name">
                {selectedFrame.badge} {selectedFrame.name}
              </h3>
              <p className="preview-frame-desc">{selectedFrame.description}</p>

              <div className="preview-price-row">
                <span className="price-label">售价:</span>
                {selectedFrame.price === 0 ? (
                  <span className="price-free">默认初始拥有</span>
                ) : (
                  <span className="price-val">
                    <Chip size={16} />
                    <b>{selectedFrame.price.toLocaleString()}</b>
                  </span>
                )}
              </div>

              <div className="preview-action-row">
                {isEquipped(selectedFrame.id) ? (
                  <button type="button" className="btn-frame-action is-equipped" disabled>
                    ✓ 正在佩戴中
                  </button>
                ) : isOwned(selectedFrame.id) ? (
                  <button
                    type="button"
                    className="btn-frame-action is-equip"
                    onClick={() => handleEquip(selectedFrame)}
                    disabled={loading}
                  >
                    立即佩戴
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-frame-action is-buy"
                    onClick={() => handleBuy(selectedFrame)}
                    disabled={loading || user.balance < selectedFrame.price}
                  >
                    {user.balance < selectedFrame.price ? '筹码不足' : '筹码购买'}
                  </button>
                )}
              </div>

              <div className="preview-wallet-balance">
                <span>当前可用筹码: </span>
                <Chip size={14} />
                <b>{user.balance.toLocaleString()}</b>
              </div>
            </div>
          </div>

          {/* 右侧：分类与头像框网格 */}
          <div className="avatar-frame-catalog-panel">
            <div className="frame-rarity-tabs">
              <button
                type="button"
                className={`rarity-tab ${activeRarity === 'all' ? 'is-active' : ''}`}
                onClick={() => setActiveRarity('all')}
              >
                全部 ({AVATAR_FRAMES.length})
              </button>
              {(['mythic', 'legendary', 'epic', 'rare'] as FrameRarity[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`rarity-tab ${activeRarity === r ? 'is-active' : ''}`}
                  onClick={() => setActiveRarity(r)}
                  style={{ color: activeRarity === r ? RARITY_MAP[r].color : undefined }}
                >
                  {RARITY_MAP[r].label}
                </button>
              ))}
            </div>

            <div className="frame-items-grid">
              {filteredFrames.map((frame) => {
                const owned = isOwned(frame.id);
                const equipped = isEquipped(frame.id);
                const selected = selectedFrame.id === frame.id;
                return (
                  <div
                    key={frame.id}
                    className={`frame-card-item ${selected ? 'is-selected' : ''} ${
                      equipped ? 'is-equipped' : ''
                    }`}
                    onClick={() => {
                      audio.play('click');
                      setSelectedFrame(frame);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="frame-card-avatar-wrap">
                      <AvatarWithFrame
                        nickname={user.nickname}
                        avatar={user.avatar}
                        frameId={frame.id}
                        size={56}
                        showCrown={frame.rarity === 'mythic'}
                      />
                    </div>
                    <span className="frame-card-name">
                      {frame.badge} {frame.name}
                    </span>
                    <span
                      className="frame-card-badge"
                      style={{ color: RARITY_MAP[frame.rarity].color }}
                    >
                      {RARITY_MAP[frame.rarity].label}
                    </span>
                    <div className="frame-card-footer">
                      {equipped ? (
                        <span className="tag-status tag-status--equipped">佩戴中</span>
                      ) : owned ? (
                        <span className="tag-status tag-status--owned">已拥有</span>
                      ) : (
                        <span className="frame-card-cost">
                          <Chip size={11} />
                          {frame.price.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
