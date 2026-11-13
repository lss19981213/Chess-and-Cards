import { useEffect, useState } from 'react';
import { api, type PlayerMailView } from '../api';
import { audio } from '../audio';
import { Chip } from './Chip';
import { IconBack } from './Icons';

interface Props {
  onBack: () => void;
  onBalanceChange: (newBalance: number) => void;
}

export function MailView({ onBack, onBalanceChange }: Props) {
  const [mails, setMails] = useState<PlayerMailView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
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
      showToast(`🎉 成功领取 ${res.rewardCoins.toLocaleString()} 欢乐豆！`);
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
      showToast('邮件已删除');
    } catch {
      showToast('删除失败');
    }
  };

  const handleClaimAll = async () => {
    const claimable = mails.filter((m) => !m.isClaimed && m.rewardCoins > 0);
    if (claimable.length === 0) {
      showToast('暂无可领取的附件');
      return;
    }
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
    showToast(`🎉 一键领取完成，共入账 ${totalCoins.toLocaleString()} 欢乐豆！`);
  };

  const selectedMail = mails.find((m) => m.id === selectedId);

  return (
    <div className="full-screen-view mail-view">
      <header className="view-header">
        <button type="button" className="icon-btn" onClick={onBack} title="返回大厅">
          <IconBack />
        </button>
        <div className="view-title">
          <span className="mail-header-icon">📬</span>
          <h2>系统信箱</h2>
          <span className="view-subtitle">官方福利 · 筹码发放 · 游戏通报</span>
        </div>
        <div className="view-header__actions">
          <button type="button" className="btn btn--subtle" onClick={handleClaimAll}>
            🎁 一键全领
          </button>
        </div>
      </header>

      {toast && <div className="toast-float">{toast}</div>}

      <main className="view-main mail-layout">
        {loading ? (
          <div className="mail-empty">正在拉取您的信件...</div>
        ) : mails.length === 0 ? (
          <div className="mail-empty">
            <span className="mail-empty-icon">📭</span>
            <p>您的信箱目前空空如也</p>
            <small>有筹码发放或重要系统通报时会在这里送达～</small>
          </div>
        ) : (
          <div className="mail-split-container">
            {/* 左侧邮件列表 */}
            <aside className="mail-sidebar">
              <ul className="mail-list">
                {mails.map((m) => {
                  const isSel = m.id === selectedId;
                  return (
                    <li
                      key={m.id}
                      className={`mail-item ${isSel ? 'is-selected' : ''} ${!m.isRead ? 'is-unread' : ''}`}
                      onClick={() => handleSelect(m)}
                    >
                      <div className="mail-item__top">
                        <span className="mail-sender">{m.sender}</span>
                        <span className="mail-date">
                          {new Date(m.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="mail-item__title">{m.title}</div>
                      <div className="mail-item__footer">
                        {m.rewardCoins > 0 ? (
                          <span
                            className={`mail-coin-tag ${m.isClaimed ? 'is-claimed' : 'is-available'}`}
                          >
                            💰 {m.rewardCoins.toLocaleString()}
                            {m.isClaimed ? ' (已领)' : ''}
                          </span>
                        ) : (
                          <span className="mail-type-tag">通报</span>
                        )}
                        {!m.isRead && <span className="mail-unread-dot" />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* 右侧邮件详情阅读器 */}
            <section className="mail-detail-pane">
              {selectedMail ? (
                <div className="mail-paper">
                  <div className="mail-paper__head">
                    <h3 className="mail-paper__title">{selectedMail.title}</h3>
                    <div className="mail-paper__meta">
                      <span>发件人：<strong>{selectedMail.sender}</strong></span>
                      <span>时间：{new Date(selectedMail.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="mail-paper__body">{selectedMail.content}</div>

                  {/* 筹码附件卡 */}
                  {selectedMail.rewardCoins > 0 && (
                    <div className="mail-reward-box">
                      <div className="mail-reward-left">
                        <Chip size={32} />
                        <div>
                          <div className="mail-reward-label">随信附赠游戏筹码</div>
                          <div className="mail-reward-val">
                            +{selectedMail.rewardCoins.toLocaleString()} 欢乐豆
                          </div>
                        </div>
                      </div>
                      <div className="mail-reward-right">
                        {selectedMail.isClaimed ? (
                          <span className="mail-claimed-badge">✅ 已领取到账</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--gold mail-claim-btn"
                            disabled={claiming}
                            onClick={() => handleClaim(selectedMail)}
                          >
                            {claiming ? '领取中...' : '🎁 立即领取'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mail-paper__actions">
                    <button
                      type="button"
                      className="btn btn--danger-subtle"
                      onClick={() => handleDelete(selectedMail.id)}
                    >
                      🗑️ 删除此信件
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mail-empty">请在左侧选择一封邮件进行阅读</div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
