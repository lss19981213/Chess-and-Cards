import { useEffect, useState } from 'react';
import { api, type PlayerMailView } from '../api';
import { audio } from '../audio';
import { Chip } from './Chip';
import { IconBack } from './Icons';

interface Props {
  onBack: () => void;
  onBalanceChange: (newBalance: number) => void;
}

type TabType = 'all' | 'unread' | 'rewards';

export function MailView({ onBack, onBalanceChange }: Props) {
  const [mails, setMails] = useState<PlayerMailView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<TabType>('all');

  const fetchMails = async () => {
    try {
      const res = await api.listMails();
      setMails(res.mails);
      if (res.mails.length > 0 && !selectedId) {
        setSelectedId(res.mails[0]!.id);
        if (!res.mails[0]!.isRead) {
          void api.readMail(res.mails[0]!.id);
          setMails((prev) =>
            prev.map((m) => (m.id === res.mails[0]!.id ? { ...m, isRead: true } : m)),
          );
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  };

  const handleSelect = (mail: PlayerMailView) => {
    setSelectedId(mail.id);
    if (!mail.isRead) {
      void api.readMail(mail.id);
      setMails((prev) => prev.map((m) => (m.id === mail.id ? { ...m, isRead: true } : m)));
    }
  };

  const handleClaim = async (mail: PlayerMailView) => {
    if (claiming || mail.isClaimed || mail.rewardCoins <= 0) return;
    setClaiming(true);
    try {
      const res = await api.claimMail(mail.id);
      audio.play('win');
      onBalanceChange(res.balance);
      setMails((prev) =>
        prev.map((m) =>
          m.id === mail.id ? { ...m, isClaimed: true, claimedAt: Date.now() } : m,
        ),
      );
      showToast(`🎉 成功领取 ${res.rewardCoins.toLocaleString()} 欢乐豆筹码！`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '领取失败');
    } finally {
      setClaiming(false);
    }
  };

  const handleDelete = async (mailId: string) => {
    try {
      await api.deleteMail(mailId);
      const remaining = mails.filter((m) => m.id !== mailId);
      setMails(remaining);
      if (selectedId === mailId) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      showToast('信件已从您的信箱中移除');
    } catch {
      showToast('删除失败');
    }
  };

  const handleDeleteAllRead = async () => {
    const readMails = mails.filter((m) => m.isRead && (m.rewardCoins === 0 || m.isClaimed));
    if (readMails.length === 0) {
      showToast('暂无已处理完毕的可清理信件');
      return;
    }
    for (const mail of readMails) {
      try {
        await api.deleteMail(mail.id);
      } catch {
        /* ignore */
      }
    }
    const remaining = mails.filter((m) => !readMails.some((r) => r.id === m.id));
    setMails(remaining);
    if (selectedId && !remaining.some((m) => m.id === selectedId)) {
      setSelectedId(remaining[0]?.id ?? null);
    }
    showToast(`已成功清理 ${readMails.length} 封已读信件`);
  };

  const handleClaimAll = async () => {
    const claimable = mails.filter((m) => !m.isClaimed && m.rewardCoins > 0);
    if (claimable.length === 0) {
      showToast('信箱中暂无待领取的筹码');
      return;
    }
    setClaiming(true);
    let totalCoins = 0;
    for (const mail of claimable) {
      try {
        const res = await api.claimMail(mail.id);
        totalCoins += res.rewardCoins;
        onBalanceChange(res.balance);
      } catch {
        /* ignore */
      }
    }
    audio.play('win');
    await fetchMails();
    setClaiming(false);
    showToast(`🎉 一键提取完成！共计入账 +${totalCoins.toLocaleString()} 欢乐豆！`);
  };

  // 筛选邮件
  const filteredMails = mails.filter((m) => {
    if (tab === 'unread') return !m.isRead;
    if (tab === 'rewards') return m.rewardCoins > 0 && !m.isClaimed;
    return true;
  });

  const unreadCount = mails.filter((m) => !m.isRead).length;
  const rewardsCount = mails.filter((m) => m.rewardCoins > 0 && !m.isClaimed).length;

  const selectedMail = mails.find((m) => m.id === selectedId);
  const selectedIdx = filteredMails.findIndex((m) => m.id === selectedId);

  const handlePrev = () => {
    if (selectedIdx > 0) {
      const prev = filteredMails[selectedIdx - 1];
      if (prev) handleSelect(prev);
    }
  };

  const handleNext = () => {
    if (selectedIdx < filteredMails.length - 1) {
      const next = filteredMails[selectedIdx + 1];
      if (next) handleSelect(next);
    }
  };

  return (
    <div className="full-screen-view mail-view">
      {/* 顶部高奢导航栏 */}
      <header className="mail-nav-header">
        <div className="mail-nav-left">
          <button type="button" className="mail-back-btn" onClick={onBack} title="返回大厅">
            <IconBack />
            <span>返回大厅</span>
          </button>
          <div className="mail-title-badge">
            <span className="mail-royal-crest">⚜️</span>
            <div>
              <h2 className="mail-main-heading">皇家事务信箱</h2>
              <span className="mail-sub-heading">ROYAL OFFICIAL INBOX · 官方福利与通报</span>
            </div>
          </div>
        </div>

        <div className="mail-nav-actions">
          {rewardsCount > 0 && (
            <button
              type="button"
              className="mail-btn-claim-all"
              onClick={handleClaimAll}
              disabled={claiming}
            >
              🎁 一键全领筹码 ({rewardsCount})
            </button>
          )}
          <button
            type="button"
            className="mail-btn-clean"
            onClick={handleDeleteAllRead}
            title="一键清理所有已领取或无附件的已读邮件"
          >
            🧹 清理已读
          </button>
        </div>
      </header>

      {toast && <div className="mail-toast-float">{toast}</div>}

      <div className="mail-body-layout">
        {/* 左侧邮件卡片栏 */}
        <aside className="mail-sidebar-pane">
          {/* 筛选标签栏 */}
          <div className="mail-filter-tabs">
            <button
              type="button"
              className={`mail-tab-btn ${tab === 'all' ? 'is-active' : ''}`}
              onClick={() => setTab('all')}
            >
              全部 ({mails.length})
            </button>
            <button
              type="button"
              className={`mail-tab-btn ${tab === 'unread' ? 'is-active' : ''}`}
              onClick={() => setTab('unread')}
            >
              未读 {unreadCount > 0 && <span className="mail-tab-bubble">{unreadCount}</span>}
            </button>
            <button
              type="button"
              className={`mail-tab-btn ${tab === 'rewards' ? 'is-active' : ''}`}
              onClick={() => setTab('rewards')}
            >
              待领筹码 {rewardsCount > 0 && <span className="mail-tab-bubble gold">{rewardsCount}</span>}
            </button>
          </div>

          {/* 列表渲染 */}
          <div className="mail-cards-scroll">
            {loading ? (
              <div className="mail-loading-box">
                <div className="mail-spinner" />
                <p>正在同步信箱数据...</p>
              </div>
            ) : filteredMails.length === 0 ? (
              <div className="mail-empty-cards">
                <span className="mail-empty-emblem">📭</span>
                <p>{tab === 'unread' ? '暂无未读信件' : tab === 'rewards' ? '暂无待领取筹码' : '信箱目前空空如也'}</p>
              </div>
            ) : (
              filteredMails.map((m) => {
                const isSel = m.id === selectedId;
                const hasReward = m.rewardCoins > 0;
                return (
                  <div
                    key={m.id}
                    className={`mail-card-item ${isSel ? 'is-selected' : ''} ${!m.isRead ? 'is-unread' : ''}`}
                    onClick={() => handleSelect(m)}
                  >
                    <div className="mail-card-head">
                      <div className="mail-card-sender-wrap">
                        <span className="mail-card-icon">
                          {hasReward && !m.isClaimed ? '🎁' : !m.isRead ? '💌' : m.isClaimed ? '✅' : '📜'}
                        </span>
                        <span className="mail-card-sender">{m.sender}</span>
                      </div>
                      <span className="mail-card-time">
                        {new Date(m.createdAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                      </span>
                    </div>

                    <div className="mail-card-title">{m.title}</div>

                    <div className="mail-card-foot">
                      {hasReward ? (
                        <span className={`mail-card-coin-pill ${m.isClaimed ? 'is-claimed' : 'is-unclaimed'}`}>
                          <Chip size={13} />
                          <strong>+{m.rewardCoins.toLocaleString()}</strong>
                          <small>{m.isClaimed ? '已领' : '待领'}</small>
                        </span>
                      ) : (
                        <span className="mail-card-tag-notice">系统通报</span>
                      )}
                      {!m.isRead && <span className="mail-card-glow-dot" title="未读信件" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* 右侧信件皇家详情阅读面板 */}
        <section className="mail-reader-pane">
          {selectedMail ? (
            <div className="mail-parchment-sheet">
              {/* 信件顶部 */}
              <div className="mail-parchment-header">
                <div className="mail-parchment-watermark">⚜️</div>
                <div className="mail-parchment-title-row">
                  <h3 className="mail-parchment-title">{selectedMail.title}</h3>
                  <div className="mail-parchment-seal">OFFICIAL SEAL</div>
                </div>

                <div className="mail-parchment-meta-row">
                  <div className="mail-meta-item">
                    <span className="mail-meta-label">发件人:</span>
                    <strong className="mail-meta-val is-official">✓ {selectedMail.sender} (官方认证)</strong>
                  </div>
                  <div className="mail-meta-item">
                    <span className="mail-meta-label">送达时间:</span>
                    <span className="mail-meta-val">{new Date(selectedMail.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* 华丽金线分割 */}
              <div className="mail-gold-divider" />

              {/* 信件主体内容 */}
              <div className="mail-parchment-content">
                <p className="mail-content-text">{selectedMail.content}</p>
                <div className="mail-signature-box">
                  <div className="mail-sig-title">棋牌娱乐运营管理总署</div>
                  <div className="mail-sig-stamp">OFFICIAL VERIFIED</div>
                </div>
              </div>

              {/* 筹码附件金库卡片 */}
              {selectedMail.rewardCoins > 0 && (
                <div className={`mail-vault-card ${selectedMail.isClaimed ? 'is-claimed' : 'is-active'}`}>
                  <div className="mail-vault-glow" />
                  <div className="mail-vault-content">
                    <div className="mail-vault-left">
                      <div className="mail-vault-chip-icon">
                        <Chip size={38} />
                      </div>
                      <div>
                        <div className="mail-vault-badge">随信附赠专属筹码</div>
                        <div className="mail-vault-amount">
                          +{selectedMail.rewardCoins.toLocaleString()} <span className="mail-vault-unit">欢乐豆</span>
                        </div>
                        <div className="mail-vault-hint">
                          {selectedMail.isClaimed ? '此筹码已于前序入账至您的游戏账户' : '点击右侧按钮即可即时存入账户余额'}
                        </div>
                      </div>
                    </div>

                    <div className="mail-vault-right">
                      {selectedMail.isClaimed ? (
                        <div className="mail-vault-claimed-pill">
                          <span>✅ 已成功领取到账</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mail-vault-claim-btn"
                          disabled={claiming}
                          onClick={() => handleClaim(selectedMail)}
                        >
                          {claiming ? '正在领取...' : '🎁 立即领取到账'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 底部功能栏 */}
              <div className="mail-parchment-footer">
                <div className="mail-pagination-arrows">
                  <button
                    type="button"
                    className="mail-page-btn"
                    disabled={selectedIdx <= 0}
                    onClick={handlePrev}
                  >
                    ‹ 上一封
                  </button>
                  <button
                    type="button"
                    className="mail-page-btn"
                    disabled={selectedIdx < 0 || selectedIdx >= filteredMails.length - 1}
                    onClick={handleNext}
                  >
                    下一封 ›
                  </button>
                </div>

                <button
                  type="button"
                  className="mail-delete-action"
                  onClick={() => handleDelete(selectedMail.id)}
                >
                  🗑️ 移除此信件
                </button>
              </div>
            </div>
          ) : (
            <div className="mail-reader-empty">
              <span className="mail-reader-empty-icon">✉️</span>
              <p>请在左侧列表中点击选择要查阅的信件</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
