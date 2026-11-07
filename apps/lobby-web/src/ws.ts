import { BASE_PATH } from './api';

type Handler = (data: unknown) => void;

/** 带自动重连与房间恢复的 WebSocket 客户端 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly pending: Array<{ t: string; d: unknown }> = [];
  private manualClose = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private roomRef: { roomId: string; playerId: string } | null = null;

  constructor(private readonly token: string) {
    this.on('server:hello', () => {
      if (this.roomRef) this.send('client:reconnect', this.roomRef);
    });
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}${BASE_PATH}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ t: 'client:hello', d: { token: this.token }, ts: Date.now() }));
      // 认证消息之后按序冲刷排队消息
      while (this.pending.length > 0) {
        const item = this.pending.shift();
        if (!item) break;
        ws.send(JSON.stringify({ t: item.t, d: item.d, ts: Date.now() }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { t?: unknown; d?: unknown };
        if (typeof msg.t === 'string') this.emit(msg.t, msg.d);
      } catch {
        /* 忽略非法消息 */
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.manualClose) this.scheduleReconnect();
    };
  }

  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  send(type: string, data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: type, d: data, ts: Date.now() }));
      return;
    }
    // 未连接时排队，连上并完成认证后自动补发
    if (this.pending.length < 20) this.pending.push({ t: type, d: data });
  }

  setRoomRef(ref: { roomId: string; playerId: string } | null): void {
    this.roomRef = ref;
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private emit(type: string, data: unknown): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch (error) {
        console.error('[ws] 处理器异常', error);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.attempt += 1;
    const delay = Math.min(1000 * 2 ** Math.min(this.attempt, 5), 15000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
