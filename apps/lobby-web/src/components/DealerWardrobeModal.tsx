import { useState } from 'react';
import { DEALER_SKINS, DEALER_VOICES, type DealerSkinMeta, type DealerVoiceMeta } from '@cc/protocol';
import { api, type User } from '../api';
import { DEALER_SKINS_ASSETS } from '../assets';
import { audio } from '../audio';
import { speakDealerQuote } from '../speech';

interface Props {
  user: User;
  onUserUpdate: (patch: Partial<User>) => void;
  onClose: () => void;
}

export function DealerWardrobeModal({ user, onUserUpdate, onClose }: Props) {
  const [tab, setTab] = useState<'skin' | 'voice'>('skin');
  const affection = user.dealerAffection ?? 0;
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

  const speakQuote = (text: string, voiceId?: string) => {
    const targetVoiceId = voiceId || selectedVoice.id;
    speakDealerQuote(text, targetVoiceId);
    showToast(`🎙️ “${text}”`);
  };

  // 判定好感度等级 (1-16 级全新升级)
  const getLevelInfo = (pts: number) => {
    if (pts >= 108000) return { lv: 16, name: '神圣爱神', next: 108000, max: 108000 };
    if (pts >= 90000) return { lv: 15, name: '帝尊龙皇', next: 108000, max: 18000 };
    if (pts >= 76000) return { lv: 14, name: '曜世星神', next: 90000, max: 14000 };
    if (pts >= 62000) return { lv: 13, name: '倾国花魁', next: 76000, max: 14000 };
    if (pts >= 50000) return { lv: 12, name: '堕天炽翼', next: 62000, max: 12000 };
    if (pts >= 40000) return { lv: 11, name: '绝恋夜魅', next: 50000, max: 10000 };
    if (pts >= 32000) return { lv: 10, name: '狂热极速', next: 40000, max: 8000 };
    if (pts >= 25000) return { lv: 9, name: '冷艳法老', next: 32000, max: 7000 };
    if (pts >= 20000) return { lv: 8, name: '深海塞壬', next: 25000, max: 5000 };
    if (pts >= 15000) return { lv: 7, name: '纯白倾心', next: 20000, max: 5000 };
    if (pts >= 10000) return { lv: 6, name: '誓约守护', next: 15000, max: 5000 };
    if (pts >= 7000) return { lv: 5, name: '眷恋不舍', next: 10000, max: 3000 };
    if (pts >= 3500) return { lv: 4, name: '深情款款', next: 7000, max: 3500 };
    if (pts >= 1000) return { lv: 3, name: '怦然心动', next: 3500, max: 2500 };
    if (pts >= 500) return { lv: 2, name: '熟稔交心', next: 1000, max: 500 };
    return { lv: 1, name: '初识相伴', next: 500, max: 500 };
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
                              setSelectedVoice(voice);
                              speakQuote(q, voice.id);
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
                            setSelectedVoice(voice);
                            void handleApply(currentSkinId, voice.id).then(() => {
                              const sample = voice.quotes.idle[0];
                              if (sample) speakDealerQuote(sample, voice.id);
                            });
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
