import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { audio } from '../audio';
import { DEALER_ASSISTANT } from '../assets';
import { IconAssistant, IconBack, IconSparkle } from './Icons';

interface ChatItem {
  role: 'user' | 'assistant';
  content: string;
  granted?: number;
}

interface Props {
  onBalanceChange: (balance: number) => void;
  onBack: () => void;
}

const GREETING: ChatItem = {
  role: 'assistant',
  content: '尊贵的牌友您好！我是您的专属荷官助手艾莉丝。注册认证、任务奖励、玩法细则、排行榜等任何疑问，我都可以为您解答。如果手气不佳筹码见底，也可以找我聊聊申请接济哦～',
};

const QUICK_ASKS = ['怎么注册账号？', '救济金怎么领？', '德州扑克怎么玩？', '我筹码快输光了'];

export function AssistantView({ onBalanceChange, onBack }: Props) {
  const [messages, setMessages] = useState<ChatItem[]>([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async (text: string): Promise<void> => {
    const question = text.trim();
    if (!question || loading) return;

    audio.play('click');
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);

    try {
      const history = messages
        .filter((item) => item.content.length > 0)
        .slice(-6)
        .map((item) => ({ role: item.role, content: item.content }));

      const result = await api.assistantChat(question, history);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.reply, granted: result.granted > 0 ? result.granted : undefined },
      ]);
      if (result.granted > 0) {
        audio.play('coin');
        onBalanceChange(result.balance);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: error instanceof Error ? error.message : '助手暂时开小差了，请稍后再试' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="full-screen-view assistant-view">
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconAssistant size={22} />
          <h2>牌桌智谋阁</h2>
          <span className="view-sub">智谱 GLM 智能引擎驱动 · 专属动漫荷官管家随时在侧</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      <main className="view-main assistant-layout">
        {/* 左侧动漫美女荷官管家展台 */}
        <aside className="assistant-hero-card assistant-hero-card--dealer">
          <div className="assistant-dealer-portrait">
            <img src={DEALER_ASSISTANT} alt="专属动漫荷官管家" />
            <div className="dealer-name-tag">
              <span className="dealer-name">荷官 · 艾莉丝 (Alice)</span>
              <span className="dealer-duty">专属管家</span>
            </div>
          </div>
          <p className="dealer-motto">
            “不仅是玩法百科，更是您的牌桌智囊。若您手气欠佳，我会竭诚为您核实救济金资格哦～”
          </p>

          <div className="quick-asks-title">快捷咨询</div>
          <div className="quick-asks-list">
            {QUICK_ASKS.map((q) => (
              <button
                key={q}
                type="button"
                className="quick-ask-pill"
                onClick={() => void send(q)}
              >
                <span>{q}</span>
                <IconSparkle size={10} />
              </button>
            ))}
          </div>
        </aside>

        {/* 右侧聊天窗口 */}
        <section className="assistant-chat-panel">
          <div className="chat-messages-container" ref={scrollRef}>
            {messages.map((item, idx) => (
              <div key={idx} className={`chat-bubble-row is-${item.role}`}>
                <div className="bubble-avatar">
                  {item.role === 'assistant' ? '👧' : '👤'}
                </div>
                <div className="bubble-content">
                  <p>{item.content}</p>
                  {item.granted && item.granted > 0 && (
                    <div className="granted-notice">
                      🎁 恭喜！荷官已为您成功发放 <strong>+{item.granted}</strong> 救济筹码！
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="chat-bubble-row is-assistant">
                <div className="bubble-avatar">👧</div>
                <div className="bubble-content is-thinking">
                  <span>艾莉丝正在查阅资料思考中…</span>
                </div>
              </div>
            )}
          </div>

          <form
            className="chat-input-bar"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              type="text"
              value={input}
              placeholder="向荷官艾莉丝提问或求助筹码…"
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="btn-send-chat" disabled={loading || !input.trim()}>
              发送
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
