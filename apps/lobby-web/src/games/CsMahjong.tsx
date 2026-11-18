import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MahjongTile } from '../components/MahjongTile';
import { audio } from '../audio';
import { speakDealerQuote } from '../speech';

interface MahjongTileData {
  id: string;
  suit: 'dot' | 'bamboo' | 'wan';
  val: number;
}

interface Meld {
  type: 'pong' | 'kong' | 'chow';
  tiles: MahjongTileData[];
}

interface MahjongActionEvent {
  seq: number;
  type: 'start' | 'discard' | 'pong' | 'kong' | 'hu' | 'zimo' | 'draw_game';
  playerId: string;
  nickname: string;
  tile?: MahjongTileData;
  huType?: string;
}

interface MahjongPlayer {
  playerId: string;
  nickname: string;
  seat: number;
  isBot: boolean;
  cardCount: number;
  melds: Meld[];
  discards: MahjongTileData[];
  hand: MahjongTileData[];
}

interface CsMahjongSnapshot {
  phase: string;
  round: number;
  variantId?: string;
  variantName?: string;
  bonusLabel?: string;
  baseWin?: number;
  dealerId?: string | null;
  turn: string | null;
  remainingCount: number;
  lastDiscard: { playerId: string; tile: MahjongTileData } | null;
  lastAction?: MahjongActionEvent | null;
  myHand: MahjongTileData[];
  myDrawn: MahjongTileData | null;
  canHu: boolean;
  canPong: boolean;
  canKong?: boolean;
  birds: MahjongTileData[];
  winners: string[];
  results: Array<{
    playerId: string;
    nickname: string;
    delta: number;
    huType: string;
    birds: MahjongTileData[];
  }>;
  players: MahjongPlayer[];
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onAction: (cmd: string, payload?: Record<string, unknown>) => void;
}

interface CenterFx {
  id: number;
  kind: 'banner' | 'pong' | 'kong' | 'hu' | 'zimo';
  title: string;
  subtitle?: string;
}

const WINDS: ReadonlyArray<{ cn: string; en: string; isEast: boolean }> = [
  { cn: '東', en: 'E', isEast: true },
  { cn: '南', en: 'S', isEast: false },
  { cn: '西', en: 'W', isEast: false },
  { cn: '北', en: 'N', isEast: false },
];

const SEAT_AVATARS = ['🤠', '👩‍🎤', '🧙‍♂️', '👸'];

const BURST_SPARKS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 16;
  const dist = 68 + (i % 3) * 26;
  const colors = ['#ffe58f', '#34d399', '#fbbf24', '#ffffff'];
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist),
    size: i % 3 === 0 ? 8 : 5,
    color: colors[i % colors.length]!,
  };
});

const HU_CONFETTI = Array.from({ length: 24 }, (_, i) => {
  const left = 6 + ((i * 37) % 88);
  const delay = ((i * 73) % 450) / 1000;
  const dur = 1.1 + ((i * 29) % 6) * 0.14;
  const colors = ['#ffd666', '#ff4d4f', '#34d399', '#fff1b8', '#f59e0b'];
  return {
    left: `${left}%`,
    delay: `${delay}s`,
    dur: `${dur}s`,
    rot: `${(i * 47) % 360}deg`,
    color: colors[i % colors.length]!,
  };
});

export function CsMahjong({ snapshot, myId, status, balance, onAction }: Props) {
  const data = snapshot as unknown as CsMahjongSnapshot | undefined;
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [autoPass, setAutoPass] = useState(false);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [centerFx, setCenterFx] = useState<CenterFx | null>(null);
  const [tableShake, setTableShake] = useState(false);
  const [showSettleCard, setShowSettleCard] = useState(false);
  const [tidyPulse, setTidyPulse] = useState(false);

  const lastSeqRef = useRef<number>(-1);
  const lastDrawnIdRef = useRef<string | null>(null);
  const localDiscardedIdRef = useRef<string | null>(null);
  const fxIdRef = useRef<number>(1);
  const fxTimerRef = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  // 卸载时清理所有动效计时器
  useEffect(() => {
    return () => {
      if (fxTimerRef.current !== null) window.clearTimeout(fxTimerRef.current);
      if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  const players = useMemo(
    () => (data?.players ? [...data.players].sort((a, b) => a.seat - b.seat) : []),
    [data?.players],
  );

  // 监听摸牌音效
  useEffect(() => {
    const drawnId = data?.myDrawn?.id ?? null;
    if (drawnId && drawnId !== lastDrawnIdRef.current && status === 'playing') {
      audio.play('mahjong_draw');
    }
    lastDrawnIdRef.current = drawnId;
  }, [data?.myDrawn?.id, status]);

  // 监听所有对局动作事件（发牌/出牌/碰/杠/胡/自摸/荒庄）并同步特效与音效
  useEffect(() => {
    if (!data) return;
    const act = data.lastAction;
    if (!act) return;
    const key = data.round * 10000 + act.seq;
    if (lastSeqRef.current === -1) {
      lastSeqRef.current = key;
      if (act.type === 'start') {
        const id = fxIdRef.current++;
        setCenterFx({
          id,
          kind: 'banner',
          title: '开局 · 雀神开战',
          subtitle: `${data.variantName || '长沙麻将'} · 第 ${data.round} 局`,
        });
        audio.play('card_shuffle');
        if (fxTimerRef.current !== null) window.clearTimeout(fxTimerRef.current);
        fxTimerRef.current = window.setTimeout(() => {
          setCenterFx((curr) => (curr?.id === id ? null : curr));
        }, 1350);
      }
      return;
    }

    if (key === lastSeqRef.current) return;
    lastSeqRef.current = key;

    const triggerFx = (fx: Omit<CenterFx, 'id'>, duration: number, shake = false) => {
      const id = fxIdRef.current++;
      if (fxTimerRef.current !== null) window.clearTimeout(fxTimerRef.current);
      setCenterFx({ id, ...fx });
      fxTimerRef.current = window.setTimeout(() => {
        setCenterFx((curr) => (curr?.id === id ? null : curr));
      }, duration);
      if (shake) {
        if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
        setTableShake(true);
        shakeTimerRef.current = window.setTimeout(() => setTableShake(false), 360);
      }
    };

    switch (act.type) {
      case 'start':
        audio.play('card_shuffle');
        triggerFx(
          {
            kind: 'banner',
            title: `第 ${data.round} 局开始`,
            subtitle: `${act.nickname} 坐庄先出`,
          },
          1350,
        );
        break;
      case 'discard': {
        // 避免自己点击出牌时重复播两次出牌音效
        const isLocalRepeat = act.playerId === myId && act.tile?.id === localDiscardedIdRef.current;
        if (!isLocalRepeat) {
          audio.play('mahjong_discard');
        }
        localDiscardedIdRef.current = null;
        break;
      }
      case 'pong':
        audio.play('mahjong_peng');
        if (audio.sfxOn) speakDealerQuote('碰！');
        triggerFx({ kind: 'pong', title: '碰', subtitle: act.nickname }, 1050);
        break;
      case 'kong':
        audio.play('mahjong_gang');
        if (audio.sfxOn) speakDealerQuote('杠！');
        triggerFx({ kind: 'kong', title: '杠', subtitle: `${act.nickname} · 补牌` }, 1200, true);
        break;
      case 'zimo':
        audio.play('mahjong_hu');
        if (audio.sfxOn) speakDealerQuote('恭喜自摸胡牌！');
        triggerFx(
          { kind: 'zimo', title: '自 摸', subtitle: `${act.nickname} · ${act.huType ?? '大胡'}` },
          1850,
          true,
        );
        break;
      case 'hu':
        audio.play('mahjong_hu');
        if (audio.sfxOn) speakDealerQuote('胡啦，好牌！');
        triggerFx(
          { kind: 'hu', title: '胡 了', subtitle: `${act.nickname} · ${act.huType ?? '胡牌'}` },
          1850,
          true,
        );
        break;
      case 'draw_game':
        audio.play('pass');
        triggerFx({ kind: 'banner', title: '荒 庄', subtitle: '海底无牌 · 本局流局' }, 1500);
        break;
    }
  }, [data, myId]);

  // 结算卡片略延迟展示，让玩家完整欣赏胡牌/自摸特效
  const hasResults = Boolean(data?.results && data.results.length > 0);
  useEffect(() => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    if (hasResults) {
      settleTimerRef.current = window.setTimeout(() => setShowSettleCard(true), 1050);
    } else {
      setShowSettleCard(false);
    }
  }, [hasResults, data?.round]);

  // 开启「自动过」时，仅自动跳过碰（绝不自动跳过胡牌）
  useEffect(() => {
    if (!data || !autoPass || hasResults) return;
    if (data.canPong && !data.canHu && !data.canKong) {
      const t = window.setTimeout(() => onAction('pass'), 220);
      return () => window.clearTimeout(t);
    }
  }, [data, autoPass, hasResults, onAction]);

  // 把最新摸到的牌独立排在最右侧（符合真实麻将手感）
  const orderedMyHand = useMemo(() => {
    const raw = data?.myHand ?? [];
    const drawnId = data?.myDrawn?.id;
    if (!drawnId) return raw.map((t) => ({ tile: t, isNew: false }));
    const idx = raw.findIndex((t) => t.id === drawnId);
    if (idx < 0) return raw.map((t) => ({ tile: t, isNew: false }));
    const rest = raw.filter((_, i) => i !== idx).map((t) => ({ tile: t, isNew: false }));
    rest.push({ tile: raw[idx]!, isNew: true });
    return rest;
  }, [data?.myHand, data?.myDrawn?.id]);

  if (!data) {
    return (
      <div className="mj3d-loading">
        <div className="mj3d-loading__pill">🀄 正在铺设 3D 全自动雀神牌桌…</div>
      </div>
    );
  }

  const variantName = data.variantName || '长沙麻将';
  const bonusLabel = data.bonusLabel || '鸟';
  const baseWin = data.baseWin ?? 100;
  const isMyTurn = data.turn === myId && status === 'playing';
  const canKong = Boolean(data.canKong);

  // 计算四家相对方位：自家(下) -> 下家(右) -> 对家(上) -> 上家(左)
  const myIndex = Math.max(
    0,
    players.findIndex((p) => p.playerId === myId),
  );
  const dealerIndex = Math.max(
    0,
    players.findIndex((p) => p.playerId === data.dealerId),
  );

  const playerAtOffset = (offset: number): MahjongPlayer | null => {
    if (players.length === 0) return null;
    if (offset >= players.length) return null;
    return players[(myIndex + offset) % players.length] ?? null;
  };

  const seatBottom = playerAtOffset(0);
  const seatRight = playerAtOffset(1);
  const seatTop = playerAtOffset(2);
  const seatLeft = playerAtOffset(3);

  const windOf = (player: MahjongPlayer | null) => {
    if (!player || players.length === 0) return WINDS[0]!;
    const idx = players.findIndex((p) => p.playerId === player.playerId);
    const windIdx = ((idx >= 0 ? idx : 0) - dealerIndex + 4) % 4;
    return WINDS[windIdx] ?? WINDS[0]!;
  };

  const windBottom = windOf(seatBottom);
  const windRight = windOf(seatRight);
  const windTop = windOf(seatTop);
  const windLeft = windOf(seatLeft);

  const activeSide: 'bottom' | 'right' | 'top' | 'left' | null =
    data.turn && seatBottom?.playerId === data.turn
      ? 'bottom'
      : data.turn && seatRight?.playerId === data.turn
        ? 'right'
        : data.turn && seatTop?.playerId === data.turn
          ? 'top'
          : data.turn && seatLeft?.playerId === data.turn
            ? 'left'
            : null;

  const fireDiscard = (tile: MahjongTileData) => {
    if (!isMyTurn) return;
    localDiscardedIdRef.current = tile.id;
    audio.play('mahjong_discard');
    onAction('discard', { tileId: tile.id });
    setSelectedTileId(null);
  };

  const handleTileClick = (t: MahjongTileData) => {
    if (!isMyTurn) {
      audio.play('mahjong_tile_click');
      setSelectedTileId((prev) => (prev === t.id ? null : t.id));
      return;
    }
    if (selectedTileId === t.id) {
      fireDiscard(t);
    } else {
      audio.play('mahjong_tile_click');
      setSelectedTileId(t.id);
    }
  };

  const handlePong = () => {
    setSelectedTileId(null);
    onAction('pong');
  };

  const handleKong = () => {
    setSelectedTileId(null);
    onAction('kong');
  };

  const handleHu = () => {
    setSelectedTileId(null);
    onAction('hu');
  };

  const handlePass = () => {
    audio.play('pass');
    onAction('pass');
  };

  const handleTidyHand = () => {
    audio.play('mahjong_tile_click');
    setSelectedTileId(null);
    setTidyPulse(true);
    window.setTimeout(() => setTidyPulse(false), 320);
  };

  const renderStandingWall = (count: number, orientation: 'top' | 'left' | 'right') => {
    const visibleCount = Math.max(0, Math.min(14, count));
    return (
      <div className={`mj3d-wall mj3d-wall--${orientation}`} aria-label={`手牌 ${count} 张`}>
        {Array.from({ length: visibleCount }).map((_, idx) => (
          <span key={idx} className="mj3d-wall-tile" />
        ))}
      </div>
    );
  };

  const renderMelds = (melds: Meld[] | undefined, pos: 'top' | 'left' | 'right' | 'bottom') => {
    if (!melds || melds.length === 0) return null;
    return (
      <div className={`mj3d-melds mj3d-melds--${pos}`}>
        {melds.map((m, mi) => (
          <div key={mi} className={`mj3d-meld is-${m.type}`}>
            {m.tiles.map((mt) => (
              <MahjongTile
                key={mt.id}
                tile={`${mt.suit}${mt.val}`}
                size={pos === 'bottom' ? 'sm' : 'xs'}
                className="mj3d-meld-tile"
              />
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderRiver = (
    player: MahjongPlayer | null,
    pos: 'top' | 'left' | 'right' | 'bottom',
  ) => {
    const discards = player?.discards ?? [];
    const lastId = data.lastDiscard?.playerId === player?.playerId ? data.lastDiscard?.tile.id : null;
    return (
      <div className={`mj3d-river mj3d-river--${pos}`}>
        {discards.slice(-18).map((dt) => {
          const isLatest = dt.id === lastId;
          return (
            <div key={dt.id} className={`mj3d-river-slot${isLatest ? ' is-latest' : ''}`}>
              <MahjongTile
                tile={`${dt.suit}${dt.val}`}
                size="xs"
                isLastDiscard={isLatest}
                className="mj3d-river-tile"
              />
              {isLatest && <span className="mj3d-latest-pointer" aria-hidden="true">▼</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const renderAvatarBadge = (
    player: MahjongPlayer | null,
    pos: 'top' | 'left' | 'right' | 'bottom',
    wind: { cn: string; en: string; isEast: boolean },
    seatVisualIndex: number,
  ) => {
    if (!player) return null;
    const isActive = data.turn === player.playerId && status === 'playing';
    const isDealer = data.dealerId === player.playerId;
    const displayCoins =
      pos === 'bottom' ? balance : 8000 + ((player.seat * 731 + data.round * 120) % 2600);
    return (
      <div className={`mj3d-avatar-card mj3d-avatar-card--${pos}${isActive ? ' is-active' : ''}`}>
        <div className="mj3d-avatar-portrait">
          <span className="mj3d-avatar-emoji" aria-hidden="true">
            {SEAT_AVATARS[seatVisualIndex % SEAT_AVATARS.length]}
          </span>
          <span className={`mj3d-wind-chip${wind.isEast ? ' is-east' : ''}`}>{wind.cn}</span>
          {isDealer && <span className="mj3d-dealer-tag">庄</span>}
        </div>
        <div className="mj3d-avatar-meta">
          <span className="mj3d-avatar-name" title={player.nickname}>
            {player.nickname}
          </span>
          <span className="mj3d-avatar-coins">
            <i className="mj3d-coin-dot">¥</i>
            {displayCoins.toLocaleString()}
          </span>
        </div>
      </div>
    );
  };

  const hasCallButtons = (data.canHu || data.canPong || canKong) && !hasResults;

  return (
    <div className={`mj3d-arena${tableShake ? ' is-shaking' : ''}`}>
      {/* 顶部左上角倍率/局数信息 + 右上角信号/音效指示（呼应参考图） */}
      <div className="mj3d-hud-top">
        <div className="mj3d-hud-rate">
          <span className="mj3d-hud-rate__mult">倍率:{baseWin}</span>
          <span className="mj3d-hud-rate__sep">·</span>
          <span className="mj3d-hud-rate__title">{variantName}</span>
          <span className="mj3d-hud-rate__round">第 {data.round} 局</span>
        </div>
        <div className="mj3d-hud-tools">
          <div className="mj3d-signal-bars" title="实时联机状态极佳">
            <span className="b1" />
            <span className="b2" />
            <span className="b3" />
          </div>
          <button
            type="button"
            className={`mj3d-tool-gear${sfxOn ? ' is-on' : ''}`}
            onClick={() => setSfxOn(audio.toggleSfx())}
            title={sfxOn ? '关闭麻将音效' : '开启麻将音效'}
          >
            {sfxOn ? '🔊' : '🔇'}
          </button>
        </div>
      </div>

      {/* 3D 透视全自动祖母绿绒布麻将桌面 */}
      <div className="mj3d-perspective-stage">
        <div className="mj3d-table-surface">
          {/* 桌面精致暗绿绒布几何刻线（精确复刻参考图八角/回字线条与对角折线） */}
          <svg className="mj3d-felt-lines" viewBox="0 0 1000 660" preserveAspectRatio="none" aria-hidden="true">
            {/* 外围牌墙框线 */}
            <rect x="112" y="54" width="776" height="552" fill="none" stroke="rgba(4,34,23,0.52)" strokeWidth="2.4" />
            {/* 内围出牌区八角切角框 */}
            <polygon
              points="265,134 735,134 776,174 776,486 735,526 265,526 224,486 224,174"
              fill="none"
              stroke="rgba(4,34,23,0.48)"
              strokeWidth="2.2"
            />
            {/* 四角对角引导折线 */}
            <line x1="265" y1="134" x2="404" y2="238" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            <line x1="735" y1="134" x2="596" y2="238" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            <line x1="265" y1="526" x2="404" y2="422" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            <line x1="735" y1="526" x2="596" y2="422" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            {/* 底部暗角折线装饰 */}
            <polyline points="224,526 254,554 746,554 776,526" fill="none" stroke="rgba(4,34,23,0.34)" strokeWidth="1.8" />
          </svg>

          {/* 对家（上方）绿背立牌墙 + 副露 */}
          <div className="mj3d-seat-top">
            {renderStandingWall(seatTop?.cardCount ?? 13, 'top')}
            {renderMelds(seatTop?.melds, 'top')}
          </div>

          {/* 上家（左侧）3D 透视立牌列 + 副露 */}
          <div className="mj3d-seat-left">
            {renderStandingWall(seatLeft?.cardCount ?? 13, 'left')}
            {renderMelds(seatLeft?.melds, 'left')}
          </div>

          {/* 下家（右侧）3D 透视立牌列 + 副露 */}
          <div className="mj3d-seat-right">
            {renderStandingWall(seatRight?.cardCount ?? 13, 'right')}
            {renderMelds(seatRight?.melds, 'right')}
          </div>

          {/* 四向牌河（紧贴中央罗盘四周） */}
          {renderRiver(seatTop, 'top')}
          {renderRiver(seatLeft, 'left')}
          {renderRiver(seatRight, 'right')}
          {renderRiver(seatBottom, 'bottom')}

          {/* 中央全自动麻将机风位罗盘 */}
          <div className={`mj3d-compass${activeSide ? ` is-turn-${activeSide}` : ''}`}>
            {/* 四边轮次指示发光条 */}
            <span className={`mj3d-compass-edge is-top${activeSide === 'top' ? ' is-lit' : ''}`} />
            <span className={`mj3d-compass-edge is-right${activeSide === 'right' ? ' is-lit' : ''}`} />
            <span className={`mj3d-compass-edge is-bottom${activeSide === 'bottom' ? ' is-lit' : ''}`} />
            <span className={`mj3d-compass-edge is-left${activeSide === 'left' ? ' is-lit' : ''}`} />

            {/* 四角风位铭牌（東 E / 南 S / 西 W / 北 N，东位红底醒目高亮） */}
            <div className={`mj3d-compass-corner is-tl${windLeft.isEast ? ' is-east' : ''}`}>
              <strong>{windLeft.cn}</strong>
              <em>{windLeft.en}</em>
            </div>
            <div className={`mj3d-compass-corner is-tr${windTop.isEast ? ' is-east' : ''}`}>
              <strong>{windTop.cn}</strong>
              <em>{windTop.en}</em>
            </div>
            <div className={`mj3d-compass-corner is-bl${windBottom.isEast ? ' is-east' : ''}`}>
              <strong>{windBottom.cn}</strong>
              <em>{windBottom.en}</em>
            </div>
            <div className={`mj3d-compass-corner is-br${windRight.isEast ? ' is-east' : ''}`}>
              <strong>{windRight.cn}</strong>
              <em>{windRight.en}</em>
            </div>

            {/* 中央黑色数码液晶屏：余牌数 + 当前状态 */}
            <div className="mj3d-compass-core">
              <span className="mj3d-compass-label">余牌</span>
              <strong className="mj3d-compass-num">{data.remainingCount}</strong>
              <span className={`mj3d-compass-turn${isMyTurn ? ' is-mine' : ''}`}>
                {isMyTurn ? '请出牌' : '对局中'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 四方玩家头像与金币铭牌（固定屏幕层，清晰锐利不畸变） */}
      {renderAvatarBadge(seatTop, 'top', windTop, 2)}
      {renderAvatarBadge(seatLeft, 'left', windLeft, 3)}
      {renderAvatarBadge(seatRight, 'right', windRight, 1)}
      {renderAvatarBadge(seatBottom, 'bottom', windBottom, 0)}

      {/* 左下角半透明翠绿快捷工具条（呼应参考图「理/花/鸣/切」竖条） */}
      <div className="mj3d-quick-strip">
        <button type="button" className="mj3d-quick-btn" onClick={handleTidyHand} title="整理手牌">
          理
        </button>
        <button
          type="button"
          className={`mj3d-quick-btn${autoPass ? ' is-on' : ''}`}
          onClick={() => {
            audio.play('click');
            setAutoPass((v) => !v);
          }}
          title={autoPass ? '已开启自动过碰（胡牌不自动过）' : '开启自动过碰'}
        >
          过
        </button>
        <button
          type="button"
          className={`mj3d-quick-btn${sfxOn ? ' is-on' : ''}`}
          onClick={() => setSfxOn(audio.toggleSfx())}
          title={sfxOn ? '关闭音效' : '开启音效'}
        >
          声
        </button>
      </div>

      {/* 自家底部明牌副露 + 操作按钮 + 3D 高清实体立牌手牌区 */}
      <div className="mj3d-bottom-dock">
        {/* 吃碰杠胡动作条 */}
        {(hasCallButtons || (isMyTurn && !hasResults)) && (
          <div className="mj3d-action-float">
            {data.canHu && (
              <button type="button" className="mj3d-call-btn is-hu" onClick={handleHu}>
                <span>胡</span>
                <small>赢牌</small>
              </button>
            )}
            {canKong && (
              <button type="button" className="mj3d-call-btn is-kong" onClick={handleKong}>
                <span>杠</span>
                <small>补牌</small>
              </button>
            )}
            {data.canPong && (
              <button type="button" className="mj3d-call-btn is-pong" onClick={handlePong}>
                <span>碰</span>
                <small>刻子</small>
              </button>
            )}
            {hasCallButtons && (
              <button type="button" className="mj3d-call-btn is-pass" onClick={handlePass}>
                <span>过</span>
              </button>
            )}
            {isMyTurn && !hasCallButtons && (
              <div className="mj3d-turn-pill">
                <span className="mj3d-turn-dot" />
                {selectedTileId ? '再次点击选中牌打出（或双击直出）' : '轮到你出牌 · 点击选牌，再点打出'}
              </div>
            )}
          </div>
        )}

        <div className="mj3d-my-deck-row">
          {/* 我的手牌（绿顶象牙白 3D 实体大牌） */}
          <div className={`mj3d-my-hand${tidyPulse ? ' is-tidying' : ''}`}>
            {orderedMyHand.map(({ tile, isNew }) => (
              <MahjongTile
                key={tile.id}
                tile={`${tile.suit}${tile.val}`}
                size="lg"
                active={selectedTileId === tile.id}
                isNew={isNew}
                onClick={() => handleTileClick(tile)}
                onDoubleClick={() => fireDiscard(tile)}
                className="mj3d-hand-tile"
              />
            ))}
          </div>

          {/* 我的碰/杠明牌区 */}
          {renderMelds(seatBottom?.melds, 'bottom')}
        </div>
      </div>

      {/* 中央动作横幅 & 碰/杠/胡/自摸华丽特效层 */}
      {centerFx && (
        <div key={`mj-fx-${centerFx.id}`} className={`mj3d-fx-layer mj3d-fx-layer--${centerFx.kind}`}>
          {centerFx.kind === 'banner' ? (
            <div className="mj3d-glass-banner">
              <strong>{centerFx.title}</strong>
              {centerFx.subtitle && <span>{centerFx.subtitle}</span>}
            </div>
          ) : (
            <div className={`mj3d-call-burst is-${centerFx.kind}`}>
              {/* 双层扩散震波 */}
              <span className="mj3d-burst-ring mj3d-burst-ring--1" />
              <span className="mj3d-burst-ring mj3d-burst-ring--2" />
              {/* 放射光点火花 */}
              {BURST_SPARKS.map((sp, i) => (
                <span
                  key={i}
                  className="mj3d-burst-spark"
                  style={
                    {
                      '--sx': `${sp.dx}px`,
                      '--sy': `${sp.dy}px`,
                      width: `${sp.size}px`,
                      height: `${sp.size}px`,
                      background: sp.color,
                    } as CSSProperties
                  }
                />
              ))}
              {/* 书法大字印章 */}
              <div className="mj3d-burst-glyph">{centerFx.title}</div>
              {centerFx.subtitle && <div className="mj3d-burst-sub">{centerFx.subtitle}</div>}
            </div>
          )}

          {/* 胡牌 / 自摸漫天喜庆金红彩带 */}
          {(centerFx.kind === 'hu' || centerFx.kind === 'zimo') && (
            <div className="mj3d-confetti-rain" aria-hidden="true">
              {HU_CONFETTI.map((c, idx) => (
                <span
                  key={idx}
                  className="mj3d-confetti-piece"
                  style={
                    {
                      left: c.left,
                      animationDelay: c.delay,
                      animationDuration: c.dur,
                      background: c.color,
                      '--rot': c.rot,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 华丽结算弹窗（胡牌牌型 + 抓鸟/买马高亮 + 四家输赢明细） */}
      {hasResults && showSettleCard && (
        <div className="mj3d-settle-overlay">
          <div className="mj3d-settle-card">
            <div className="mj3d-settle-header">
              <span className="mj3d-settle-emblem">🀄</span>
              <h3>
                {variantName} · 本局结算
                {data.birds.length > 0 ? `（开门抓${bonusLabel}）` : ''}
              </h3>
            </div>

            {data.birds.length > 0 && (
              <div className="mj3d-settle-birds">
                <span className="mj3d-settle-birds__label">
                  {bonusLabel === '马' ? '买马开牌' : `抓${bonusLabel}开牌`}（1/5/9 中{bonusLabel}）：
                </span>
                <div className="mj3d-settle-birds__tiles">
                  {data.birds.map((b) => {
                    const hit = b.val === 1 || b.val === 5 || b.val === 9;
                    return (
                      <div key={b.id} className={`mj3d-bird-item${hit ? ' is-hit' : ''}`}>
                        <MahjongTile tile={`${b.suit}${b.val}`} size="sm" />
                        {hit && <em className="mj3d-bird-tag">中{bonusLabel}</em>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mj3d-settle-rows">
              {data.results.map((r) => {
                const isWinner = data.winners.includes(r.playerId);
                return (
                  <div key={r.playerId} className={`mj3d-settle-row${isWinner ? ' is-winner' : ''}`}>
                    <div className="mj3d-settle-player">
                      {isWinner && <span className="mj3d-win-crown">👑</span>}
                      <span className="mj3d-settle-name">{r.nickname}</span>
                    </div>
                    <span className="mj3d-settle-type">{r.huType}</span>
                    <strong className={`mj3d-settle-delta ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}`}>
                      {r.delta > 0 ? `+${r.delta}` : r.delta}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CsMahjong;
