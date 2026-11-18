import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type FeedbackTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type User,
} from '../api';
import { audio } from '../audio';

interface Props {
  user: User;
  onClose: () => void;
  onUnreadChange?: (count: number) => void;
}

const CATEGORIES: Array<{ id: TicketCategory; icon: string; label: string; hint: string }> = [
  { id: 'bug', icon: '🐛', label: 'Bug 异常', hint: '界面错乱、卡死、音效/流程异常' },
  { id: 'gameplay', icon: '🎮', label: '游戏玩法', hint: '牌型判定、规则细节、结算疑问' },
  { id: 'wallet', icon: '💰', label: '筹码/账务', hint: '筹码变动、奖励未到账、任务异常' },
  { id: 'suggestion', icon: '💡', label: '功能建议', hint: '新玩法、新皮肤、体验改进建议' },
  { id: 'account', icon: '👤', label: '账号/安全', hint: '登录、绑定、密码或邮箱问题' },
  { id: 'report', icon: '📢', label: '投诉/举报', hint: '违规昵称、异常行为举报' },
  { id: 'other', icon: '📝', label: '其他问题', hint: '其他需要客服协助的事项' },
];

const PRIORITIES: Array<{ id: TicketPriority; label: string }> = [
  { id: 'low', label: '一般' },
  { id: 'normal', label: '普通' },
  { id: 'high', label: '重要' },
  { id: 'urgent', label: '紧急' },
];

const STATUS_META: Record<TicketStatus, { label: string; cls: string }> = {
  open: { label: '待处理', cls: 'is-open' },
  in_progress: { label: '处理中', cls: 'is-progress' },
  replied: { label: '官方已回复', cls: 'is-replied' },
  resolved: { label: '已解决', cls: 'is-resolved' },
  closed: { label: '已关闭', cls: 'is-closed' },
};

function categoryLabel(cat: TicketCategory): string {
  const found = CATEGORIES.find((c) => c.id === cat);
  return found ? `${found.icon} ${found.label}` : '📝 其他问题';
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '-';
  }
}

export function FeedbackModal({ user, onClose, onUnreadChange }: Props) {
  const [tab, setTab] = useState<'create' | 'list'>('create');
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [activeTicket, setActiveTicket] = useState<FeedbackTicket | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 新建工单表单状态
  const [category, setCategory] = useState<TicketCategory>('bug');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState(user.email ?? '');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 工单详情回复与大图预览
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const showNotice = useCallback((type: 'ok' | 'err', text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  const loadTickets = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.listTickets();
      setTickets(res.tickets);
      onUnreadChange?.(res.unreadCount);
    } catch (err) {
      showNotice('err', err instanceof Error ? err.message : '加载工单列表失败');
    } finally {
      setLoadingList(false);
    }
  }, [onUnreadChange, showNotice]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const openTicketDetail = useCallback(
    async (ticketId: string) => {
      setLoadingDetail(true);
      try {
        const res = await api.ticketDetail(ticketId);
        setActiveTicket(res.ticket);
        setTickets((prev) => {
          const next = prev.map((t) =>
            t.id === ticketId
              ? { ...t, hasUnreadReply: false, status: res.ticket.status, replyCount: res.ticket.replyCount }
              : t,
          );
          onUnreadChange?.(next.filter((t) => t.hasUnreadReply).length);
          return next;
        });
        window.setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
      } catch (err) {
        showNotice('err', err instanceof Error ? err.message : '加载工单详情失败');
      } finally {
        setLoadingDetail(false);
      }
    },
    [onUnreadChange, showNotice],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(file.type)) {
      audio.play('alert');
      showNotice('err', '仅支持 PNG / JPG / WebP / GIF 格式图片');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      audio.play('alert');
      showNotice('err', '截图大小不能超过 2MB，请压缩后再上传');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAttachment(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const t = title.trim();
    const c = content.trim();
    if (t.length < 2) {
      audio.play('alert');
      showNotice('err', '请填写至少 2 个字的工单标题');
      return;
    }
    if (c.length < 5) {
      audio.play('alert');
      showNotice('err', '请详细描述遇到的问题或建议（至少 5 个字）');
      return;
    }

    setSubmitting(true);
    try {
      const clientInfo = `${window.innerWidth}x${window.innerHeight} · ${navigator.userAgent.slice(0, 140)}`;
      const res = await api.createTicket({
        category,
        priority,
        title: t,
        content: c,
        contact: contact.trim(),
        attachment,
        clientInfo,
      });
      audio.play('shunzi');
      setTitle('');
      setContent('');
      setAttachment(null);
      showNotice('ok', `工单 [${res.ticket.id}] 已提交成功，GM 运营团队将尽快为您处理！`);
      await loadTickets();
      setTab('list');
      setActiveTicket(res.ticket);
    } catch (err) {
      audio.play('alert');
      showNotice('err', err instanceof Error ? err.message : '工单提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || replying) return;
    const text = replyText.trim();
    if (!text) return;

    setReplying(true);
    try {
      const res = await api.replyTicket(activeTicket.id, text);
      audio.play('click');
      setReplyText('');
      if (res.ticket) {
        setActiveTicket(res.ticket);
      } else {
        await openTicketDetail(activeTicket.id);
      }
      await loadTickets();
      window.setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (err) {
      audio.play('alert');
      showNotice('err', err instanceof Error ? err.message : '发送回复失败');
    } finally {
      setReplying(false);
    }
  };

  const handleCloseTicket = async () => {
    if (!activeTicket || closing) return;
    setClosing(true);
    try {
      const res = await api.closeTicket(activeTicket.id);
      audio.play('click');
      if (res.ticket) setActiveTicket(res.ticket);
      await loadTickets();
      showNotice('ok', `工单 [${activeTicket.id}] 已标记关闭，感谢您的反馈！`);
    } catch (err) {
      audio.play('alert');
      showNotice('err', err instanceof Error ? err.message : '关闭工单失败');
    } finally {
      setClosing(false);
    }
  };

  const unreadCount = tickets.filter((t) => t.hasUnreadReply).length;
  const activeCatMeta = CATEGORIES.find((c) => c.id === category);

  return (
    <div className="modal-mask feedback-modal-mask" onClick={onClose} role="presentation">
      <div className="modal feedback-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* 顶栏 */}
        <div className="feedback-modal__head">
          <div className="feedback-modal__title-wrap">
            <h2>🛠️ 问题反馈与工单中心</h2>
            <p>遇到任何 Bug、筹码异常或有精彩创意建议？提交工单直达 GM 运营中台，回复同步推送至您的信箱！</p>
          </div>
          <button type="button" className="feedback-close-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* 选项卡 */}
        <div className="feedback-tabs">
          <button
            type="button"
            className={`feedback-tab ${tab === 'create' ? 'is-active' : ''}`}
            onClick={() => {
              audio.play('click');
              setTab('create');
            }}
          >
            <span>✍️ 提交新工单</span>
          </button>
          <button
            type="button"
            className={`feedback-tab ${tab === 'list' ? 'is-active' : ''}`}
            onClick={() => {
              audio.play('click');
              setTab('list');
              void loadTickets();
            }}
          >
            <span>📋 我的工单 ({tickets.length})</span>
            {unreadCount > 0 && <span className="feedback-unread-pill">{unreadCount} 新回复</span>}
          </button>
        </div>

        {notice && (
          <div className={`feedback-notice ${notice.type === 'err' ? 'is-error' : 'is-ok'}`}>
            {notice.type === 'err' ? '⚠️ ' : '✨ '}
            {notice.text}
          </div>
        )}

        {/* Tab 1: 提交新工单 */}
        {tab === 'create' && (
          <form className="feedback-form" onSubmit={(e) => void handleSubmit(e)}>
            <div className="feedback-field">
              <label className="feedback-label">问题分类</label>
              <div className="feedback-cat-grid">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`feedback-cat-pill ${category === c.id ? 'is-active' : ''}`}
                    onClick={() => {
                      audio.play('click');
                      setCategory(c.id);
                    }}
                  >
                    <span>{c.icon}</span>
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
              {activeCatMeta && <span className="feedback-field-hint">💡 {activeCatMeta.hint}</span>}
            </div>

            <div className="feedback-row-2">
              <div className="feedback-field feedback-field--grow">
                <label className="feedback-label" htmlFor="tk-title">
                  工单标题 <span className="req">*</span>
                </label>
                <input
                  id="tk-title"
                  type="text"
                  className="feedback-input"
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="一句话概括您遇到的问题或建议（2~80字）"
                />
              </div>

              <div className="feedback-field feedback-field--priority">
                <label className="feedback-label">紧急程度</label>
                <div className="feedback-priority-group">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`feedback-pri-btn pri--${p.id} ${priority === p.id ? 'is-active' : ''}`}
                      onClick={() => {
                        audio.play('click');
                        setPriority(p.id);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="feedback-field">
              <div className="feedback-label-row">
                <label className="feedback-label" htmlFor="tk-content">
                  详细描述 <span className="req">*</span>
                </label>
                <span className="feedback-char-count">{content.length} / 2000</span>
              </div>
              <textarea
                id="tk-content"
                className="feedback-textarea"
                rows={4}
                maxLength={2000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="请尽量说明发生的游戏名称、操作步骤或具体建议内容，以便 GM 第一时间为您核查解决..."
              />
            </div>

            <div className="feedback-row-2">
              <div className="feedback-field feedback-field--grow">
                <label className="feedback-label" htmlFor="tk-contact">
                  联系方式（选填）
                </label>
                <input
                  id="tk-contact"
                  type="text"
                  className="feedback-input"
                  maxLength={80}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="QQ / 微信 / 邮箱（便于紧急问题联系您）"
                />
              </div>

              <div className="feedback-field feedback-field--upload">
                <label className="feedback-label">问题截图（选填，≤2MB）</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                {attachment ? (
                  <div className="feedback-attach-preview">
                    <img
                      src={attachment}
                      alt="附件预览"
                      onClick={() => setPreviewImg(attachment)}
                      title="点击放大查看"
                    />
                    <button
                      type="button"
                      className="feedback-attach-remove"
                      onClick={() => setAttachment(null)}
                    >
                      移除截图
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="feedback-upload-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📎 上传截图凭证
                  </button>
                )}
              </div>
            </div>

            <div className="feedback-form-footer">
              <span className="feedback-submitter-info">
                提交账号：<b>{user.nickname}</b>（ID: {user.id.slice(0, 8)}）
              </span>
              <button type="submit" className="feedback-submit-btn" disabled={submitting}>
                {submitting ? '正在提交至 GM 中台...' : '🚀 提交问题工单'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: 我的工单与会话详情 */}
        {tab === 'list' && (
          <div className="feedback-list-layout">
            {/* 左侧工单列表 */}
            <aside className="feedback-ticket-sidebar">
              <div className="feedback-sidebar-head">
                <span>历史记录 ({tickets.length})</span>
                <button
                  type="button"
                  className="feedback-refresh-mini"
                  onClick={() => void loadTickets()}
                  disabled={loadingList}
                >
                  ↻ 刷新
                </button>
              </div>
              {loadingList && tickets.length === 0 ? (
                <div className="feedback-empty">加载中...</div>
              ) : tickets.length === 0 ? (
                <div className="feedback-empty">
                  <p>暂无提交记录</p>
                  <button
                    type="button"
                    className="feedback-go-create-btn"
                    onClick={() => setTab('create')}
                  >
                    去提交第一条工单
                  </button>
                </div>
              ) : (
                <div className="feedback-ticket-items">
                  {tickets.map((t) => {
                    const st = STATUS_META[t.status] ?? STATUS_META.open;
                    const isSelected = activeTicket?.id === t.id;
                    return (
                      <div
                        key={t.id}
                        className={`feedback-ticket-item ${isSelected ? 'is-selected' : ''} ${t.hasUnreadReply ? 'has-unread' : ''}`}
                        onClick={() => {
                          audio.play('click');
                          void openTicketDetail(t.id);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="tk-item-top">
                          <span className="tk-item-id">
                            {t.hasUnreadReply && <span className="tk-unread-dot" />}
                            #{t.id}
                          </span>
                          <span className={`tk-status-tag ${st.cls}`}>{st.label}</span>
                        </div>
                        <div className="tk-item-title">{t.title}</div>
                        <div className="tk-item-meta">
                          <span>{categoryLabel(t.category)}</span>
                          <span>💬 {t.replyCount}</span>
                          <span>{formatTime(t.updatedAt)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </aside>

            {/* 右侧工单会话详情 */}
            <section className="feedback-detail-pane">
              {loadingDetail ? (
                <div className="feedback-empty">正在读取工单详情...</div>
              ) : !activeTicket ? (
                <div className="feedback-empty">
                  <div className="feedback-empty-ico">🎫</div>
                  <p>请在左侧点击一条工单查看处理进度与官方回复</p>
                </div>
              ) : (
                <>
                  <div className="tk-detail-head">
                    <div>
                      <div className="tk-detail-badges">
                        <span className="tk-detail-id">#{activeTicket.id}</span>
                        <span className={`tk-status-tag ${(STATUS_META[activeTicket.status] ?? STATUS_META.open).cls}`}>
                          {(STATUS_META[activeTicket.status] ?? STATUS_META.open).label}
                        </span>
                        <span className="tk-cat-chip">{categoryLabel(activeTicket.category)}</span>
                      </div>
                      <h3 className="tk-detail-title">{activeTicket.title}</h3>
                      <span className="tk-detail-time">提交于 {formatTime(activeTicket.createdAt)}</span>
                    </div>
                    {activeTicket.status !== 'closed' && (
                      <button
                        type="button"
                        className="tk-close-action-btn"
                        onClick={() => void handleCloseTicket()}
                        disabled={closing}
                      >
                        ✓ 确认已解决并关闭
                      </button>
                    )}
                  </div>

                  {/* 对话时间线 */}
                  <div className="tk-thread-scroll">
                    {/* 初始工单内容 */}
                    <div className="tk-msg tk-msg--player">
                      <div className="tk-msg__meta">
                        <b>{activeTicket.nickname}（我）</b>
                        <span>{formatTime(activeTicket.createdAt)}</span>
                      </div>
                      <div className="tk-msg__body">{activeTicket.content}</div>
                      {activeTicket.attachment && activeTicket.attachment.startsWith('data:image/') && (
                        <img
                          className="tk-msg__img"
                          src={activeTicket.attachment}
                          alt="工单截图"
                          onClick={() => setPreviewImg(activeTicket.attachment)}
                          title="点击查看大图"
                        />
                      )}
                    </div>

                    {/* 后续回复列表 */}
                    {(activeTicket.replies ?? []).map((r) => (
                      <div
                        key={r.id}
                        className={`tk-msg ${r.senderRole === 'gm' ? 'tk-msg--gm' : 'tk-msg--player'}`}
                      >
                        <div className="tk-msg__meta">
                          <b>
                            {r.senderRole === 'gm' ? '👑 ' : ''}
                            {r.senderName}
                          </b>
                          <span>{formatTime(r.createdAt)}</span>
                        </div>
                        <div className="tk-msg__body">{r.content}</div>
                      </div>
                    ))}
                    <div ref={threadEndRef} />
                  </div>

                  {/* 追加回复栏 */}
                  {activeTicket.status === 'closed' ? (
                    <div className="tk-closed-hint">该工单已关闭。若仍有新问题，欢迎随时提交新工单。</div>
                  ) : (
                    <form className="tk-reply-bar" onSubmit={(e) => void handleReply(e)}>
                      <input
                        type="text"
                        className="feedback-input tk-reply-input"
                        maxLength={1500}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="补充更多信息或回复客服..."
                      />
                      <button
                        type="submit"
                        className="tk-reply-send-btn"
                        disabled={replying || !replyText.trim()}
                      >
                        {replying ? '发送中...' : '追加回复'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </div>

      {/* 截图放大灯箱 */}
      {previewImg && (
        <div
          className="feedback-img-lightbox"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewImg(null);
          }}
        >
          <img src={previewImg} alt="截图原图" />
          <span>点击任意处关闭预览</span>
        </div>
      )}
    </div>
  );
}
