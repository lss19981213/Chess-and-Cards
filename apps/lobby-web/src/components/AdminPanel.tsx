import { useCallback, useEffect, useState } from 'react';
import { BASE_PATH } from '../api';

interface RoomRow {
  roomId: string;
  gameId: string;
  roomName: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  status: string;
  persistent: boolean;
}

interface AdminEventRow {
  at: number;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  detail?: Record<string, unknown>;
}

interface OverviewData {
  dayKey: string;
  summary: {
    rooms: number;
    platformRooms: number;
    playerRooms: number;
    online: number;
    humans: number;
    bots: number;
    games: number;
  };
  rooms: RoomRow[];
  daily: Array<{ userId: string; nickname: string; net: number; rounds: number }>;
}

const STORAGE_KEY = 'cc.adminToken';

export function AdminPanel() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [input, setInput] = useState('');
  const [data, setData] = useState<OverviewData | null>(null);
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (key: string) => {
      if (!key) return;
      setLoading(true);
      try {
        const [overviewRes, eventsRes] = await Promise.all([
          fetch(`${BASE_PATH}/api/admin/overview?token=${encodeURIComponent(key)}`),
          fetch(`${BASE_PATH}/api/admin/events?token=${encodeURIComponent(key)}&limit=60`),
        ]);
        const body = (await overviewRes.json()) as OverviewData & { message?: string };
        if (!overviewRes.ok) throw new Error(body.message ?? '加载失败');
        setData(body);
        if (eventsRes.ok) {
          const eventBody = (await eventsRes.json()) as { events: AdminEventRow[] };
          setEvents(eventBody.events ?? []);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(token);
  }, [token, load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(token), 8000);
    return () => window.clearInterval(timer);
  }, [token, load]);

  if (!token) {
    return (
      <div className="admin">
        <div className="admin__gate">
          <h1>运营后台</h1>
          <p className="hint">请输入后台口令</p>
          <input
            type="password"
            value={input}
            placeholder="ADMIN_TOKEN"
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="button"
            className="primary"
            onClick={() => {
              localStorage.setItem(STORAGE_KEY, input);
              setToken(input);
            }}
          >
            进入
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="admin__head">
        <h1>运营后台</h1>
        <span className="hint">{data?.dayKey ?? ''} · 每 8 秒自动刷新</span>
        <button type="button" className="ghost" onClick={() => void load(token)}>
          刷新
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setToken('');
            setData(null);
          }}
        >
          退出
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}
      {loading && !data && <p className="hint">加载中…</p>}

      {data && (
        <>
          <div className="admin__stats">
            <div>
              <span>房间总数</span>
              <strong>{data.summary.rooms}</strong>
            </div>
            <div>
              <span>平台台</span>
              <strong>{data.summary.platformRooms}</strong>
            </div>
            <div>
              <span>玩家房</span>
              <strong>{data.summary.playerRooms}</strong>
            </div>
            <div>
              <span>真人在线</span>
              <strong className="is-live">{data.summary.humans ?? 0}</strong>
            </div>
            <div>
              <span>氛围机器人</span>
              <strong className="is-bot">{data.summary.bots ?? 0}</strong>
            </div>
            <div>
              <span>已上线游戏</span>
              <strong>{data.summary.games}</strong>
            </div>
          </div>

          <section className="admin__section">
            <h2>房间实时状态</h2>
            <table className="admin__table">
              <thead>
                <tr>
                  <th>房间</th>
                  <th>游戏</th>
                  <th>类型</th>
                  <th>人数</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.rooms.map((room) => (
                  <tr key={room.roomId}>
                    <td>{room.roomName}</td>
                    <td>{room.gameId}</td>
                    <td>{room.persistent ? '平台台' : '玩家房'}</td>
                    <td>
                      {room.players}/{room.maxPlayers}
                    </td>
                    <td>{room.status}</td>
                  </tr>
                ))}
                {data.rooms.length === 0 && (
                  <tr>
                    <td colSpan={5} className="hint">
                      暂无房间
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="admin__section">
            <h2>实时事件流</h2>
            <div className="admin__events">
              {events.map((event, index) => (
                <div key={`${event.at}-${index}`} className={`admin__event is-${event.level}`}>
                  <span className="admin__event-time">
                    {new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                  <span className="admin__event-level">{event.level.toUpperCase()}</span>
                  <span className="admin__event-scope">{event.scope}</span>
                  <span className="admin__event-msg">{event.message}</span>
                  {event.detail?.durationMs !== undefined && (
                    <span className="admin__event-cost">{String(event.detail.durationMs)}ms</span>
                  )}
                </div>
              ))}
              {events.length === 0 && <p className="hint">暂无事件，等待新的请求或结算</p>}
            </div>
          </section>

          <section className="admin__section">
            <h2>今日红榜</h2>
            <table className="admin__table">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>局数</th>
                  <th>净收益</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.nickname}</td>
                    <td>{row.rounds}</td>
                    <td className="up">+{row.net.toLocaleString()}</td>
                  </tr>
                ))}
                {data.daily.length === 0 && (
                  <tr>
                    <td colSpan={3} className="hint">
                      今天还没有盈利记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
