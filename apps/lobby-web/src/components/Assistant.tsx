import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { audio } from '../audio';

interface ChatItem {
  role: 'user' | 'assistant';
  content: string;
  granted?: number;
}

interface Props {
  onBalanceChange: (balance: number) => void;
}

const GREETING: ChatItem = {
  role: 'assistant',
  content: '牌友好，我是牌桌小助手。注册、任务、玩法、排行榜都能问我；输光筹码了也可以找我聊聊。',
};

const QUICK_ASKS = ['怎么注册登录？', '任务在哪里领？', '各游戏怎么玩？', '我没筹码了'];

export function Assistant({ onBalanceChange }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

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
        { role: 'assistant', content: error instanceof Error ? error.message : '我这会儿有点懵，稍后再问我。' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`assistant-fab ${open ? 'is-open' : ''}`}
        onClick={() => {
          audio.play('click');
          setOpen((prev) => !prev);
        }}
        title="AI 小助手"
      >
        {open ? '×' : '💬'}
      </button>

      {open && (
        <div className="assistant-panel">
          <div className="assistant-head">
            <span className="assistant-head__avatar">🤖</span>
            <div>
              <strong>牌桌小助手</strong>
              <span>AI 客服 · 在线</span>
            </div>
          </div>

          <div className="assistant-body" ref={scrollRef}>
            {messages.map((item, index) => (
              <div key={index} className={`bubble bubble--${item.role}`}>
                <p>{item.content}</p>
                {item.granted && <span className="bubble__grant">+{item.granted} 筹码已到账</span>}
              </div>
            ))}
            {loading && (
              <div className="bubble bubble--assistant">
                <p className="typing">正在思考…</p>
              </div>
            )}
          </div>

          <div className="assistant-quick">
            {QUICK_ASKS.map((ask) => (
              <button key={ask} type="button" disabled={loading} onClick={() => void send(ask)}>
                {ask}
              </button>
            ))}
          </div>

          <form
            className="assistant-input"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              maxLength={200}
              placeholder="问我点什么…"
              onChange={(event) => setInput(event.target.value)}
            />
            <button type="submit" disabled={loading || input.trim().length === 0}>
              发送
            </button>
          </form>
        </div>
      )}
    </>
  );
}
