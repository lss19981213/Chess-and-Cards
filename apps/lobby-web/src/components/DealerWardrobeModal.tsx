import { useState } from 'react';
import { DEALER_SKINS, DEALER_VOICES, type DealerSkinMeta, type DealerVoiceMeta } from '@cc/protocol';
import { api, type User } from '../api';
import { DEALER_SKINS_ASSETS } from '../assets';
import { audio } from '../audio';

interface Props {
  user: User;
  onUserUpdate: (patch: Partial<User>) => void;
  onClose: () => void;
}

export function DealerWardrobeModal({ user, onUserUpdate, onClose }: Props) {
  const [tab, setTab] = useState<'skin' | 'voice'>('skin');
  const affection = user.worshipCount ? user.worshipCount * 50 : 680; // Calculated or mock base affection
  const currentSkinId = user.dealerSkin || 'classic';
  const currentVoiceId = user.dealerVoice || 'classic';

  const [selectedSkin, setSelectedSkin] = useState<DealerSkinMeta>(
    DEALER_SKINS.find((s) => s.id === currentSkinId) || DEALER_SKINS[0]!,
  );
  const [selectedVoice, setSelectedVoice] = useState<DealerVoiceMeta>(
    DEALER_VOICES.find((v) => v.id === currentVoiceId) || DEALER_VOICES[0]!,
  );
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const handleApply = async (newSkinId: string, newVoiceId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      audio.play('click');
      await api.customizeDealer(newSkinId, newVoiceId);
      audio.play('shunzi');
      onUserUpdate({ dealerSkin: newSkinId, dealerVoice: newVoiceId });
      showToast('✨ 荷官装扮与个性台词已成功换新！');
    } catch (e) {
      audio.play('alert');
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const speakQuote = (text: string) => {
    audio.play('worship');
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'zh-CN';
        utter.rate = 1.05;
        utter.pitch = selectedVoice.id === 'sweet' ? 1.3 : selectedVoice.id === 'tsundere' ? 1.2 : 1.0;
        window.speechSynthesis.speak(utter);
      } catch {
        /* 忽略语音异常 */
      }
    }
    showToast(`“${text}”`);
  };

  // 判定好感度等级
  const getLevelInfo = (pts: number) => {
    if (pts >= 10000) return { lv: 5, name: '誓约', next: 10000, max: 10000 };
    if (pts >= 5000) return { lv: 4, name: '挚友', next: 10000, max: 5000 };
    if (pts >= 2000) return { lv: 3, name: '亲密', next: 5000, max: 3000 };
    if (pts >= 500) return { lv: 2, name: '熟稔', next: 2000, max: 1500 };
    return { lv: 1, name: '初识', next: 500, max: 500 };
  };

  const levelInfo = getLevelInfo(affection);

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal dealer-wardrobe-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head wardrobe-modal-head">
          <div>
            <h2 className="wardrobe-title">👗 荷官爱丽丝 · 专属换装与个性台词</h2>
            <p className="wardrobe-sub">
              提升爱丽丝好感度，解锁多款精美皮肤与特色语音台词性格！
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {/* 顶部好感度卡片 */}
        <div className="dealer-affection-card">
          <div className="affection-level-badge">
            <span className="affection-heart">💖</span>
            <b>Lv.{levelInfo.lv} {levelInfo.name}</b>
          </div>
          <div className="affection-bar-wrap">
            <div className="affection-text-row">
              <span>好感度进度: <b>{affection.toLocaleString()}</b> pts</span>
              <span>距离下一等级: {Math.max(0, levelInfo.next - affection)} pts</span>
            </div>
            <div className="affection-progress-track">
              <div
                className="affection-progress-fill"
                style={{
                  width: `${Math.min(100, Math.round((affection / levelInfo.next) * 100))}%`,
                }}
              />
            </div>
          </div>
          <div className="affection-tip-hint">
            💡 打赏礼物即可快速提升好感度！
          </div>
        </div>

        {toast && <div className="wardrobe-toast">{toast}</div>}

        <div className="wardrobe-tabs">
          <button
            type="button"
            className={`wardrobe-tab-btn ${tab === 'skin' ? 'is-active' : ''}`}
            onClick={() => setTab('skin')}
          >
            🎨 荷官皮肤换装 ({DEALER_SKINS.length})
          </button>
          <button
            type="button"
            className={`wardrobe-tab-btn ${tab === 'voice' ? 'is-active' : ''}`}
            onClick={() => setTab('voice')}
          >
            🎙️ 自定义个性语言 ({DEALER_VOICES.length})
          </button>
        </div>

        {/* 皮肤选择页 */}
        {tab === 'skin' && (
          <div className="wardrobe-content-skin">
            <div className="skin-preview-stage">
              <img
                src={DEALER_SKINS_ASSETS[selectedSkin.id] || DEALER_SKINS_ASSETS.classic}
                alt={selectedSkin.name}
                className="skin-preview-img"
              />
              <div className="skin-preview-overlay">
                <h3>{selectedSkin.name}</h3>
                <p>{selectedSkin.description}</p>
                <div className="skin-preview-actions">
                  {currentSkinId === selectedSkin.id ? (
                    <button type="button" className="btn-wardrobe is-active" disabled>
                      ✓ 正在穿戴中
                    </button>
                  ) : affection >= selectedSkin.requiredAffection ? (
                    <button
                      type="button"
                      className="btn-wardrobe is-equip"
                      onClick={() => handleApply(selectedSkin.id, currentVoiceId)}
                      disabled={loading}
                    >
                      立即换装
                    </button>
                  ) : (
                    <button type="button" className="btn-wardrobe is-locked" disabled>
                      🔒 需好感度达到 {selectedSkin.requiredAffection}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="skin-selector-list">
              {DEALER_SKINS.map((skin) => {
                const unlocked = affection >= skin.requiredAffection;
                const active = currentSkinId === skin.id;
                const isSelected = selectedSkin.id === skin.id;
                return (
                  <div
                    key={skin.id}
                    className={`skin-card-thumb ${isSelected ? 'is-selected' : ''} ${
                      !unlocked ? 'is-locked' : ''
                    }`}
                    onClick={() => {
                      audio.play('click');
                      setSelectedSkin(skin);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <img
                      src={DEALER_SKINS_ASSETS[skin.id] || DEALER_SKINS_ASSETS.classic}
                      alt={skin.name}
                      className="skin-thumb-pic"
                    />
                    <div className="skin-thumb-info">
                      <span className="skin-thumb-name">{skin.name}</span>
                      {active ? (
                        <span className="tag-skin-status is-active">穿戴中</span>
                      ) : unlocked ? (
                        <span className="tag-skin-status is-unlocked">已解锁</span>
                      ) : (
                        <span className="tag-skin-status is-locked">
                          Lv.{getLevelInfo(skin.requiredAffection).lv} 解锁
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 语言性格选择页 */}
        {tab === 'voice' && (
          <div className="wardrobe-content-voice">
            <div className="voice-list-grid">
              {DEALER_VOICES.map((voice) => {
                const unlocked = affection >= voice.requiredAffection;
                const active = currentVoiceId === voice.id;
                const isSelected = selectedVoice.id === voice.id;
                return (
                  <div
                    key={voice.id}
                    className={`voice-card-item ${isSelected ? 'is-selected' : ''} ${
                      !unlocked ? 'is-locked' : ''
                    }`}
                    onClick={() => {
                      audio.play('click');
                      setSelectedVoice(voice);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="voice-card-header">
                      <span className="voice-name">🎙️ {voice.name}</span>
                      {active ? (
                        <span className="tag-voice-status is-active">使用中</span>
                      ) : unlocked ? (
                        <span className="tag-voice-status is-unlocked">已解锁</span>
                      ) : (
                        <span className="tag-voice-status is-locked">
                          好感度 {voice.requiredAffection}
                        </span>
                      )}
                    </div>
                    <p className="voice-tagline">{voice.tagline}</p>

                    <div className="voice-samples-box">
                      <span className="samples-title">精选台词试听:</span>
                      <div className="samples-tags">
                        {voice.quotes.idle.slice(0, 2).map((q, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="btn-sample-speech"
                            onClick={(e) => {
                              e.stopPropagation();
                              speakQuote(q);
                            }}
                            title="点击试听此句语音"
                          >
                            🔊 {q}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="voice-card-footer">
                      {active ? (
                        <span className="voice-status-tip">✓ 当前性格语言</span>
                      ) : unlocked ? (
                        <button
                          type="button"
                          className="btn-set-voice"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApply(currentSkinId, voice.id);
                          }}
                          disabled={loading}
                        >
                          切换为此性格
                        </button>
                      ) : (
                        <span className="voice-lock-tip">好感度不足</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
