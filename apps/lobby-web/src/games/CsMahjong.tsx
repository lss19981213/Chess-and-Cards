import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AvatarWithFrame } from '../components/AvatarWithFrame';
import { MahjongTile } from '../components/MahjongTile';
import { audio } from '../audio';
import { speakDealerQuote } from '../speech';
import {
  analyzeMahjongHand,
  suitLabel,
  tileLabel,
  type AdvisorNumericSuit,
  type AdvisorSuit,
} from './mahjongAdvisor';

interface MahjongTileData {
  id: string;
  suit: AdvisorSuit;
  val: number;
}

interface Meld {
  type: 'pong' | 'kong' | 'chow';
  concealed?: boolean;
  tiles: MahjongTileData[];
}

interface ChowOption {
  tileIds: [string, string];
  tiles: MahjongTileData[];
}

interface MahjongActionEvent {
  seq: number;
  type: 'start' | 'start_bonus' | 'dingque_done' | 'discard' | 'chow' | 'pong' | 'kong' | 'hu' | 'zimo' | 'draw_game';
  playerId: string;
  nickname: string;
  tile?: MahjongTileData;
  huType?: string;
  detail?: string;
}

interface MahjongPlayer {
  playerId: string;
  nickname: string;
  seat: number;
  isBot: boolean;
  cardCount: number;
  melds: Meld[];
  discards: MahjongTileData[];
  dingqueSuit?: AdvisorNumericSuit | null;
  huDone?: boolean;
  huType?: string | null;
  gangScore?: number;
  startBonuses?: string[];
  hand: MahjongTileData[];
}

interface CsMahjongSnapshot {
  phase: 'dingque' | 'playing' | 'settled';
  round: number;
  variantId?: string;
  variantName?: string;
  bonusLabel?: string;
  baseWin?: number;
  includeHonors?: boolean;
  wildCard?: { suit: AdvisorSuit; val: number } | null;
  zimoOnly?: boolean;
  allowChow?: boolean;
  hasDingque?: boolean;
  bloodBattle?: boolean;
  minHuFan?: number;
  is258Strict?: boolean;
  dealerId?: string | null;
  turn: string | null;
  remainingCount: number;
  lastDiscard: { playerId: string; tile: MahjongTileData } | null;
  claimPending?: boolean;
  claimTile?: MahjongTileData | null;
  claimFromNickname?: string | null;
  claimIsRobKong?: boolean;
  lastAction?: MahjongActionEvent | null;
  myHand: MahjongTileData[];
  myDrawn: MahjongTileData | null;
  myDingque?: AdvisorNumericSuit | null;
  recommendedDingque?: AdvisorNumericSuit | null;
  canHu: boolean;
  canPong: boolean;
  canKong?: boolean;
  canChow?: boolean;
  chowOptions?: ChowOption[];
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
  playerMedia?: Record<string, { avatar?: string | null; equippedFrame?: string }>;
  onAction: (cmd: string, payload?: Record<string, unknown>) => void;
}

interface CenterFx {
  id: number;
  kind: 'banner' | 'chow' | 'pong' | 'kong' | 'hu' | 'zimo';
  title: string;
  subtitle?: string;
}

const WINDS: ReadonlyArray<{ cn: string; en: string; isEast: boolean }> = [
  { cn: '東', en: 'E', isEast: true },
  { cn: '南', en: 'S', isEast: false },
  { cn: '西', en: 'W', isEast: false },
  { cn: '北', en: 'N', isEast: false },
];

const VARIANT_HIGHLIGHTS: Record<string, { badge: string; rules: string[] }> = {
  'cs-mahjong': {
    badge: '108张 · 258硬将 · 起手胡 · 可吃碰杠 · 抓2鸟',
    rules: [
      '起手胡（不影响继续打牌）：大四喜(4张同牌)、板板胡(无2/5/8)、缺一色、六六顺(2副刻子)即时收喜钱！',
      '小胡须 2/5/8 硬将；大胡（将将胡/清一色/碰碰胡/七小对/豪华七对/全求人/杠上开花/海底捞月）不限将牌。',
      '可吃上家顺子、可碰、可明暗补杠；胡牌后翻 2 张鸟牌，中鸟收益直接翻倍！',
    ],
  },
  'sc-mahjong': {
    badge: '108张 · 开局定缺 · 禁吃 · 刮风下雨 · 血战到底',
    rules: [
      '开局定缺：必须选择一门花色打缺，胡牌时手牌绝不能含定缺花色，流局未打缺判「花猪」重罚！',
      '血战到底：一家胡牌后牌局继续，直至 3 家胡牌或牌墙摸完，流局执行查花猪、查大叫与退税。',
      '刮风下雨：明杠/补杠(刮风)、暗杠(下雨)即时收豆；番型含对对胡、清一色、带幺九、金钩钓、龙七对与根加番。',
    ],
  },
  'gd-mahjong': {
    badge: '136张含字牌 · 禁吃 · 杠分 · 十三幺/三元 · 买4马',
    rules: [
      '采用 136 张全牌（万/条/筒 + 东南西北 + 中发白），不可吃牌，只能碰牌、明杠、暗杠与补杠。',
      '任意对子均可做将极速推倒胡，支持鸡胡、碰碰胡、混一色、清一色、七对、字一色、大小三元、大小四喜与十三幺！',
      '胡牌后豪买 4 匹马，翻出 1/5/9/东风/红中即中马，每中 1 马总赢分额外翻倍！',
    ],
  },
  'guobiao-mahjong': {
    badge: '136张含字牌 · 可吃碰杠 · 8番起胡 · 国标计分',
    rules: [
      '采用 136 张全牌，严格遵循国标 8 番起胡：多番种可叠加累计（满 8 番方可宣告和牌）。',
      '常见凑番组合：清一色(24)、七对(24)、清龙(16)、三暗刻(16)、碰碰和(6)、混一色(6)、五门齐(6)、全带幺(4)、不求人(4)、断幺(2)、平和(2)、箭刻(2)、门风刻(2)、门清(2)。',
      '采用国标底分 8 + 总番数计分：自摸三家全付（底分+番数），点和由放炮者包番且三家各出底分。',
    ],
  },
  'hz-mahjong': {
    badge: '112张 · 红中万能癞子 · 四红中秒胡 · 禁吃 · 自摸/抢杠 · 扎4码',
    rules: [
      '112 张牌（万/条/筒 108 张 + 4 张红中）：红中是万能百搭牌（赖），可替代任意牌组成顺子、刻子、将牌或七小对！',
      '四红中秒胡：手牌凑齐全部 4 张红中可直接宣布胡牌（4 番）；若胡牌时手中不含红中，享【无红中硬胡】+2 番翻倍！',
      '不可吃牌，仅可碰、明/暗/补杠；普通出牌不可点炮，须自摸或抢杠胡；胡牌后翻 4 张码牌，1/5/9/红中全算中码，每中 1 码总收益翻倍！',
    ],
  },
};

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

export function CsMahjong({ snapshot, myId, status, balance, playerMedia, onAction }: Props) {
  const data = snapshot as unknown as CsMahjongSnapshot | undefined;
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [autoPass, setAutoPass] = useState(false);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [advisorOpen, setAdvisorOpen] = useState(true);
  const [keepPanelOpen, setKeepPanelOpen] = useState(false);
  const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
  const [chowPickerOpen, setChowPickerOpen] = useState(false);
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

  // 摸牌音效
  useEffect(() => {
    const drawnId = data?.myDrawn?.id ?? null;
    if (drawnId && drawnId !== lastDrawnIdRef.current && status === 'playing' && data?.phase === 'playing') {
      audio.play('mahjong_draw');
    }
    lastDrawnIdRef.current = drawnId;
  }, [data?.myDrawn?.id, data?.phase, status]);

  // 监听对局全部动作事件（发牌/起手胡/定缺完成/出牌/吃/碰/杠/胡/自摸/荒庄）
  useEffect(() => {
    if (!data) return;
    const act = data.lastAction;
    if (!act) return;
    const key = data.round * 10000 + act.seq;

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

    if (lastSeqRef.current === -1) {
      lastSeqRef.current = key;
      if (act.type === 'start_bonus') {
        audio.play('coin');
        triggerFx({ kind: 'banner', title: '起手胡 · 喜从天降', subtitle: act.detail }, 2100);
      } else if (act.type === 'start') {
        audio.play('card_shuffle');
        triggerFx(
          {
            kind: 'banner',
            title: '开局 · 四方雀神就位',
            subtitle: `${data.variantName || '长沙麻将'} · 第 ${data.round} 局`,
          },
          1350,
        );
      }
      return;
    }

    if (key === lastSeqRef.current) return;
    lastSeqRef.current = key;
    setChowPickerOpen(false);

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
      case 'start_bonus':
        audio.play('coin');
        if (audio.sfxOn) speakDealerQuote('哇，起手胡喜从天降！');
        triggerFx({ kind: 'banner', title: '起手胡 · 喜钱到账', subtitle: act.detail }, 2200);
        break;
      case 'dingque_done':
        audio.play('join');
        triggerFx({ kind: 'banner', title: '定缺完成', subtitle: act.detail || '血战到底 · 正式开打' }, 1350);
        break;
      case 'discard': {
        const isLocalRepeat = act.playerId === myId && act.tile?.id === localDiscardedIdRef.current;
        if (!isLocalRepeat) {
          audio.play('mahjong_discard');
          if (audio.sfxOn && act.tile) {
            speakDealerQuote(tileLabel(act.tile.suit, act.tile.val));
          }
        }
        localDiscardedIdRef.current = null;
        break;
      }
      case 'chow':
        audio.play('mahjong_peng');
        if (audio.sfxOn) speakDealerQuote('吃！');
        triggerFx({ kind: 'chow', title: '吃', subtitle: act.nickname }, 1000);
        break;
      case 'pong':
        audio.play('mahjong_peng');
        if (audio.sfxOn) speakDealerQuote('碰！');
        triggerFx({ kind: 'pong', title: '碰', subtitle: act.nickname }, 1050);
        break;
      case 'kong':
        audio.play('mahjong_gang');
        if (audio.sfxOn) speakDealerQuote(act.detail?.includes('下雨') ? '下雨啦，杠！' : '杠！');
        triggerFx(
          { kind: 'kong', title: '杠', subtitle: `${act.nickname} · ${act.detail ?? '补牌'}` },
          1250,
          true,
        );
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
        if (audio.sfxOn) speakDealerQuote('胡啦，太精彩了！');
        triggerFx(
          { kind: 'hu', title: '胡 了', subtitle: `${act.nickname} · ${act.huType ?? '胡牌'}` },
          1850,
          true,
        );
        break;
      case 'draw_game':
        audio.play('pass');
        triggerFx({ kind: 'banner', title: '荒 庄', subtitle: '海底无牌 · 本局结算' }, 1500);
        break;
    }
  }, [data, myId]);

  const hasResults = Boolean(data?.results && data.results.length > 0);
  useEffect(() => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    if (hasResults) {
      settleTimerRef.current = window.setTimeout(() => setShowSettleCard(true), 1050);
    } else {
      setShowSettleCard(false);
    }
  }, [hasResults, data?.round]);

  // 自动过（绝不自动跳过胡牌与杠牌）
  useEffect(() => {
    if (!data || !autoPass || hasResults || data.phase !== 'playing') return;
    if ((data.canPong || data.canChow) && !data.canHu && !data.canKong) {
      const t = window.setTimeout(() => onAction('pass'), 220);
      return () => window.clearTimeout(t);
    }
  }, [data, autoPass, hasResults, onAction]);

  // 把最新摸到的牌独立排在最右侧
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

  // 实时智能牌局军师计算（向听数、听牌活张、推荐舍牌、留牌胜率攻略）
  const mePlayer = useMemo(() => players.find((p) => p.playerId === myId) ?? null, [players, myId]);
  const isMyTurn = Boolean(data && data.phase === 'playing' && data.turn === myId && status === 'playing');

  const advisor = useMemo(() => {
    if (!data || data.phase !== 'playing' || !data.myHand.length || mePlayer?.huDone) return null;
    const visible: MahjongTileData[] = [];
    for (const p of players) {
      for (const d of p.discards) visible.push(d);
      for (const m of p.melds) {
        for (const t of m.tiles) visible.push(t);
      }
    }
    return analyzeMahjongHand({
      myHand: data.myHand,
      myMelds: mePlayer?.melds ?? [],
      allVisibleTiles: visible,
      isMyTurn,
      variantId: data.variantId ?? 'cs-mahjong',
      includeHonors: Boolean(data.includeHonors),
      is258Strict: Boolean(data.is258Strict),
      dingqueSuit: data.myDingque ?? null,
      wildCard: data.wildCard ?? null,
    });
  }, [data, players, mePlayer, isMyTurn]);

  // 计算每门花色张数（供四川定缺浮层展示，必须放在所有条件 return 之前，遵循 React Hooks 顺序规则）
  const suitCounts = useMemo(() => {
    const cnt: Record<AdvisorNumericSuit, number> = { wan: 0, bamboo: 0, dot: 0 };
    for (const t of data?.myHand ?? []) {
      if (t.suit === 'wan' || t.suit === 'bamboo' || t.suit === 'dot') cnt[t.suit] += 1;
    }
    return cnt;
  }, [data?.myHand]);

  if (!data) {
    return (
      <div className="mj3d-loading">
        <div className="mj3d-loading__pill">🀄 正在铺设 3D 全自动雀神牌桌…</div>
      </div>
    );
  }

  const variantId = data.variantId || 'cs-mahjong';
  const variantName = data.variantName || '长沙麻将';
  const bonusLabel = data.bonusLabel || '鸟';
  const baseWin = data.baseWin ?? 100;
  const variantMeta = VARIANT_HIGHLIGHTS[variantId] ?? VARIANT_HIGHLIGHTS['cs-mahjong']!;
  const canKong = Boolean(data.canKong);
  const canChow = Boolean(data.canChow && (data.chowOptions?.length ?? 0) > 0);
  const chowOptions = data.chowOptions ?? [];

  const myIndex = Math.max(
    0,
    players.findIndex((p) => p.playerId === myId),
  );
  const dealerIndex = Math.max(
    0,
    players.findIndex((p) => p.playerId === data.dealerId),
  );

  const playerAtOffset = (offset: number): MahjongPlayer | null => {
    if (players.length === 0 || offset >= players.length) return null;
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
    data.phase === 'playing' && data.turn
      ? seatBottom?.playerId === data.turn
        ? 'bottom'
        : seatRight?.playerId === data.turn
          ? 'right'
          : seatTop?.playerId === data.turn
            ? 'top'
            : seatLeft?.playerId === data.turn
              ? 'left'
              : null
      : null;

  const fireDiscard = (tile: MahjongTileData) => {
    if (!isMyTurn) return;
    localDiscardedIdRef.current = tile.id;
    audio.play('mahjong_discard');
    if (audio.sfxOn) speakDealerQuote(tileLabel(tile.suit, tile.val));
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

  const handleChowClick = () => {
    if (chowOptions.length === 1) {
      setSelectedTileId(null);
      onAction('chow', { tileIds: chowOptions[0]!.tileIds });
    } else if (chowOptions.length > 1) {
      audio.play('click');
      setChowPickerOpen((v) => !v);
    }
  };

  const handleSelectChow = (opt: ChowOption) => {
    setChowPickerOpen(false);
    setSelectedTileId(null);
    onAction('chow', { tileIds: opt.tileIds });
  };

  const handleTidyHand = () => {
    audio.play('mahjong_tile_click');
    setSelectedTileId(null);
    setTidyPulse(true);
    window.setTimeout(() => setTidyPulse(false), 320);
  };

  const selectedTileObj = selectedTileId ? data.myHand.find((t) => t.id === selectedTileId) ?? null : null;
  const selectedEval =
    selectedTileObj && advisor?.mode === 'discard'
      ? advisor.byTileKey.get(`${selectedTileObj.suit}_${selectedTileObj.val}`) ?? null
      : null;
  const recommendedTileKey =
    advisorOpen && advisor?.mode === 'discard' && advisor.bestDiscard
      ? `${advisor.bestDiscard.tile.suit}_${advisor.bestDiscard.tile.val}`
      : null;

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
            {m.tiles.map((mt, idx) => (
              <MahjongTile
                key={mt.id}
                tile={`${mt.suit}${mt.val}`}
                isBack={Boolean(m.concealed && pos !== 'bottom' && idx > 0 && idx < 3)}
                size={pos === 'bottom' ? 'md' : 'sm'}
                className="mj3d-meld-tile"
              />
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderRiver = (player: MahjongPlayer | null, pos: 'top' | 'left' | 'right' | 'bottom') => {
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
                size="sm"
                isLastDiscard={isLatest}
                className="mj3d-river-tile"
              />
              {isLatest && (
                <span className="mj3d-latest-pointer" aria-hidden="true">
                  ▼
                </span>
              )}
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
    _seatVisualIndex: number,
  ) => {
    if (!player) return null;
    const isActive = data.phase === 'playing' && data.turn === player.playerId && status === 'playing';
    const isDealer = data.dealerId === player.playerId;
    const displayCoins =
      pos === 'bottom' ? balance : 8000 + ((player.seat * 731 + data.round * 120) % 2600);
    const dqLabel = player.dingqueSuit
      ? `缺${player.dingqueSuit === 'wan' ? '万' : player.dingqueSuit === 'bamboo' ? '条' : '筒'}`
      : null;

    const media = playerMedia?.[player.playerId];
    return (
      <div className={`mj3d-avatar-card mj3d-avatar-card--${pos}${isActive ? ' is-active' : ''}`}>
        <div className="mj3d-avatar-portrait mj3d-avatar-portrait--framed">
          <AvatarWithFrame
            nickname={player.nickname}
            avatar={media?.avatar}
            frameId={media?.equippedFrame ?? 'frame_default'}
            size={54}
          />
          <span className={`mj3d-wind-chip${wind.isEast ? ' is-east' : ''}`}>{wind.cn}</span>
          {isDealer && <span className="mj3d-dealer-tag">庄</span>}
          {player.huDone && <span className="mj3d-hudone-tag">已胡👑</span>}
        </div>
        <div className="mj3d-avatar-meta">
          <span className="mj3d-avatar-name" title={player.nickname}>
            {player.nickname}
          </span>
          <span className="mj3d-avatar-coins">
            <i className="mj3d-coin-dot">¥</i>
            {displayCoins.toLocaleString()}
          </span>
          <div className="mj3d-avatar-pills">
            {dqLabel && <em className="mj3d-pill-dq">{dqLabel}</em>}
            {typeof player.gangScore === 'number' && player.gangScore !== 0 && (
              <em className={`mj3d-pill-gang ${player.gangScore > 0 ? 'is-pos' : 'is-neg'}`}>
                杠{player.gangScore > 0 ? `+${player.gangScore}` : player.gangScore}
              </em>
            )}
            {player.startBonuses && player.startBonuses.length > 0 && (
              <em className="mj3d-pill-bonus">{player.startBonuses[0]}</em>
            )}
          </div>
        </div>
      </div>
    );
  };

  const hasCallButtons = (data.canHu || canKong || data.canPong || canChow) && !hasResults && data.phase === 'playing';
  const needsMyDingque = data.phase === 'dingque' && data.hasDingque && !data.myDingque;

  return (
    <div className={`mj3d-arena${tableShake ? ' is-shaking' : ''}`}>
      {/* 顶部左上角倍率 + 玩法核心特色规则徽标（右上留给荷官席，零遮挡） */}
      <div className="mj3d-hud-top">
        <div className="mj3d-hud-rate">
          <span className="mj3d-hud-rate__mult">底分:{baseWin}</span>
          <span className="mj3d-hud-rate__sep">·</span>
          <span className="mj3d-hud-rate__title">{variantName}</span>
          <span className="mj3d-hud-rate__round">第 {data.round} 局</span>
        </div>
        <div className="mj3d-hud-feature-pill" title="点击查看当前玩法完整规则与番型">
          <button
            type="button"
            className="mj3d-hud-feature-btn"
            onClick={() => {
              audio.play('click');
              setRulesDrawerOpen((v) => !v);
            }}
          >
            <span>✨ {variantMeta.badge}</span>
          </button>
        </div>
      </div>

      {/* 3D 透视全自动祖母绿绒布麻将桌面 */}
      <div className="mj3d-perspective-stage">
        <div className="mj3d-table-surface">
          <svg className="mj3d-felt-lines" viewBox="0 0 1000 660" preserveAspectRatio="none" aria-hidden="true">
            <rect x="112" y="54" width="776" height="552" fill="none" stroke="rgba(4,34,23,0.52)" strokeWidth="2.4" />
            <polygon
              points="265,134 735,134 776,174 776,486 735,526 265,526 224,486 224,174"
              fill="none"
              stroke="rgba(4,34,23,0.48)"
              strokeWidth="2.2"
            />
            <line x1="265" y1="134" x2="404" y2="238" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            <line x1="735" y1="134" x2="596" y2="238" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            <line x1="265" y1="526" x2="404" y2="422" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            <line x1="735" y1="526" x2="596" y2="422" stroke="rgba(4,34,23,0.42)" strokeWidth="2" />
            <polyline points="224,526 254,554 746,554 776,526" fill="none" stroke="rgba(4,34,23,0.34)" strokeWidth="1.8" />
          </svg>

          <div className="mj3d-seat-top">
            {renderStandingWall(seatTop?.cardCount ?? 13, 'top')}
            {renderMelds(seatTop?.melds, 'top')}
          </div>
          <div className="mj3d-seat-left">
            {renderStandingWall(seatLeft?.cardCount ?? 13, 'left')}
            {renderMelds(seatLeft?.melds, 'left')}
          </div>
          <div className="mj3d-seat-right">
            {renderStandingWall(seatRight?.cardCount ?? 13, 'right')}
            {renderMelds(seatRight?.melds, 'right')}
          </div>

          {renderRiver(seatTop, 'top')}
          {renderRiver(seatLeft, 'left')}
          {renderRiver(seatRight, 'right')}
          {renderRiver(seatBottom, 'bottom')}

          {/* 中央全自动麻将机风位罗盘 */}
          <div className={`mj3d-compass${activeSide ? ` is-turn-${activeSide}` : ''}`}>
            <span className={`mj3d-compass-edge is-top${activeSide === 'top' ? ' is-lit' : ''}`} />
            <span className={`mj3d-compass-edge is-right${activeSide === 'right' ? ' is-lit' : ''}`} />
            <span className={`mj3d-compass-edge is-bottom${activeSide === 'bottom' ? ' is-lit' : ''}`} />
            <span className={`mj3d-compass-edge is-left${activeSide === 'left' ? ' is-lit' : ''}`} />

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

            <div className="mj3d-compass-core">
              <span className="mj3d-compass-label">余牌</span>
              <strong className="mj3d-compass-num">{data.remainingCount}</strong>
              <span className={`mj3d-compass-turn${isMyTurn || data.claimPending ? ' is-mine' : ''}`}>
                {data.phase === 'dingque'
                  ? '定缺中'
                  : data.claimPending
                    ? '可响应!'
                    : isMyTurn
                      ? '请出牌'
                      : '对局中'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 四方玩家头像与状态铭牌 */}
      {renderAvatarBadge(seatTop, 'top', windTop, 2)}
      {renderAvatarBadge(seatLeft, 'left', windLeft, 3)}
      {renderAvatarBadge(seatRight, 'right', windRight, 1)}
      {renderAvatarBadge(seatBottom, 'bottom', windBottom, 0)}

      {/* 底部自家手牌区：吃碰杠胡动作 + 智能军师胜率建议 + 手牌上方功能按钮 + 3D立体手牌 */}
      <div className="mj3d-bottom-dock">
        {/* 吃/碰/杠/胡 华丽动作按钮（浮于工具栏上方；响应他人出牌时附带大号目标牌预览） */}
        {hasCallButtons && (
          <div className="mj3d-action-float">
            {data.claimPending && data.claimTile && (
              <div className="mj3d-claim-preview">
                <MahjongTile tile={`${data.claimTile.suit}${data.claimTile.val}`} size="sm" />
                <div className="mj3d-claim-preview__meta">
                  <strong>{data.claimIsRobKong ? '可抢杠胡！' : `${data.claimFromNickname || '对手'}打出`}</strong>
                  <span>{tileLabel(data.claimTile.suit, data.claimTile.val)}</span>
                </div>
              </div>
            )}
            {data.canHu && (
              <button
                type="button"
                className="mj3d-call-btn is-hu"
                onClick={() => {
                  setSelectedTileId(null);
                  onAction('hu');
                }}
              >
                <span>胡</span>
                <small>{data.claimIsRobKong ? '抢杠胡' : isMyTurn ? '自摸' : '赢牌'}</small>
              </button>
            )}
            {canKong && (
              <button
                type="button"
                className="mj3d-call-btn is-kong"
                onClick={() => {
                  setSelectedTileId(null);
                  onAction('kong');
                }}
              >
                <span>杠</span>
                <small>补牌</small>
              </button>
            )}
            {data.canPong && (
              <button
                type="button"
                className="mj3d-call-btn is-pong"
                onClick={() => {
                  setSelectedTileId(null);
                  onAction('pong');
                }}
              >
                <span>碰</span>
                <small>刻子</small>
              </button>
            )}
            {canChow && (
              <button type="button" className="mj3d-call-btn is-chow" onClick={handleChowClick}>
                <span>吃</span>
                <small>顺子</small>
              </button>
            )}
            <button
              type="button"
              className="mj3d-call-btn is-pass"
              onClick={() => {
                audio.play('pass');
                setChowPickerOpen(false);
                onAction('pass');
              }}
            >
              <span>过</span>
            </button>
          </div>
        )}

        {/* 多吃牌组合选择器 */}
        {chowPickerOpen && chowOptions.length > 1 && (
          <div className="mj3d-chow-picker">
            <span className="mj3d-chow-picker__title">选择吃牌组合：</span>
            {chowOptions.map((opt, idx) => (
              <button
                key={idx}
                type="button"
                className="mj3d-chow-option"
                onClick={() => handleSelectChow(opt)}
              >
                {opt.tiles.map((t) => (
                  <MahjongTile key={t.id} tile={`${t.suit}${t.val}`} size="xs" />
                ))}
              </button>
            ))}
          </div>
        )}

        {/* 智能牌局军师条 + 听牌预览（紧贴手牌上方） */}
        {advisorOpen && advisor && !hasResults && (
          <div className="mj3d-advisor-bar">
            {selectedEval ? (
              <div className="mj3d-advisor-main">
                <span className="mj3d-advisor-tag is-preview">选牌预判</span>
                <span className="mj3d-advisor-text">
                  若打<strong>【{tileLabel(selectedEval.tile.suit, selectedEval.tile.val)}】</strong>：
                  {selectedEval.reason}
                </span>
                <span className="mj3d-advisor-rate">胜率 {selectedEval.winRatePct}%</span>
                {selectedEval.shanten <= 0 && selectedEval.waits.length > 0 && (
                  <div className="mj3d-advisor-waits">
                    {selectedEval.waits.slice(0, 5).map((w) => (
                      <span key={`${w.suit}_${w.val}`} className="mj3d-wait-chip">
                        <MahjongTile tile={`${w.suit}${w.val}`} size="xs" />
                        <em>余{w.remaining}</em>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : advisor.mode === 'discard' && advisor.bestDiscard ? (
              <div className="mj3d-advisor-main">
                <span className="mj3d-advisor-tag">🧭 智能军师</span>
                <span className="mj3d-advisor-text">{advisor.summary}</span>
                <span className="mj3d-advisor-rate">胜率 {advisor.bestDiscard.winRatePct}%</span>
                <button
                  type="button"
                  className="mj3d-advisor-apply"
                  onClick={() => fireDiscard(advisor.bestDiscard!.tile)}
                  title="采纳军师推荐，一键打出最优牌"
                >
                  打【{tileLabel(advisor.bestDiscard.tile.suit, advisor.bestDiscard.tile.val)}】
                </button>
              </div>
            ) : (
              <div className="mj3d-advisor-main">
                <span className={`mj3d-advisor-tag${advisor.isTenpai ? ' is-tenpai' : ''}`}>
                  {advisor.isTenpai ? '🔥 已听牌' : '🧭 牌局军师'}
                </span>
                <span className="mj3d-advisor-text">{advisor.summary}</span>
                {advisor.isTenpai && advisor.tenpaiWaits.length > 0 && (
                  <div className="mj3d-advisor-waits">
                    {advisor.tenpaiWaits.slice(0, 5).map((w) => (
                      <span key={`${w.suit}_${w.val}`} className="mj3d-wait-chip">
                        <MahjongTile tile={`${w.suit}${w.val}`} size="xs" />
                        <em>余{w.remaining}</em>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 展开留牌攻略气泡 */}
            {keepPanelOpen && (
              <div className="mj3d-keep-tips-pop">
                <div className="mj3d-keep-tips-head">
                  <strong>💡 高胜率留牌攻略</strong>
                  <button type="button" onClick={() => setKeepPanelOpen(false)}>
                    ✕
                  </button>
                </div>
                <ul>
                  {advisor.keepTips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 手牌正上方横向快捷辅助工具条（彻底移出手牌左下角，不再与 💬 重叠！） */}
        <div className="mj3d-hand-toolbar">
          <button
            type="button"
            className={`mj3d-tb-btn${advisorOpen ? ' is-on' : ''}`}
            onClick={() => {
              audio.play('click');
              setAdvisorOpen((v) => !v);
            }}
            title="开启/关闭智能出牌推荐与听牌提示"
          >
            🧭 军师{advisorOpen ? '开' : '关'}
          </button>
          <button
            type="button"
            className={`mj3d-tb-btn${keepPanelOpen ? ' is-on' : ''}`}
            onClick={() => {
              audio.play('click');
              setAdvisorOpen(true);
              setKeepPanelOpen((v) => !v);
            }}
            title="查看当前手牌留牌攻略"
          >
            💡 留牌攻略
          </button>
          <button type="button" className="mj3d-tb-btn" onClick={handleTidyHand} title="整理排序手牌">
            ✨ 理牌
          </button>
          <button
            type="button"
            className={`mj3d-tb-btn${autoPass ? ' is-on' : ''}`}
            onClick={() => {
              audio.play('click');
              setAutoPass((v) => !v);
            }}
            title={autoPass ? '已开启自动过吃碰（胡/杠仍提示）' : '开启自动过吃碰'}
          >
            ⏭ 自动过
          </button>
          <button
            type="button"
            className={`mj3d-tb-btn${sfxOn ? ' is-on' : ''}`}
            onClick={() => setSfxOn(audio.toggleSfx())}
            title={sfxOn ? '关闭麻将音效' : '开启麻将音效'}
          >
            {sfxOn ? '🔊 音效' : '🔇 静音'}
          </button>
          <button
            type="button"
            className={`mj3d-tb-btn${rulesDrawerOpen ? ' is-on' : ''}`}
            onClick={() => {
              audio.play('click');
              setRulesDrawerOpen((v) => !v);
            }}
            title="查看当前玩法番型与正宗规则"
          >
            📜 玩法番型
          </button>
        </div>

        {/* 自家 3D 立体手牌 + 明牌副露 */}
        <div className="mj3d-my-deck-row">
          <div className={`mj3d-my-hand${tidyPulse ? ' is-tidying' : ''}`}>
            {orderedMyHand.map(({ tile, isNew }) => {
              const tKey = `${tile.suit}_${tile.val}`;
              const isRec = recommendedTileKey === tKey;
              const isDq = Boolean(data.myDingque && tile.suit === data.myDingque);
              const isWild = Boolean(data.wildCard && tile.suit === data.wildCard.suit && tile.val === data.wildCard.val);
              return (
                <MahjongTile
                  key={tile.id}
                  tile={`${tile.suit}${tile.val}`}
                  size="lg"
                  active={selectedTileId === tile.id}
                  isNew={isNew}
                  recommended={isRec}
                  isDingque={isDq}
                  isWild={isWild}
                  onClick={() => handleTileClick(tile)}
                  onDoubleClick={() => fireDiscard(tile)}
                  className="mj3d-hand-tile"
                />
              );
            })}
          </div>
          {renderMelds(seatBottom?.melds, 'bottom')}
        </div>
      </div>

      {/* 四川血战开局定缺选择浮层 */}
      {needsMyDingque && (
        <div className="mj3d-dingque-overlay">
          <div className="mj3d-dingque-card">
            <h3>🌶️ 四川血战 · 请选择定缺花色</h3>
            <p>血战规则须打缺一门花色方能胡牌；建议选择手牌最少的花色定缺：</p>
            <div className="mj3d-dingque-choices">
              {(['wan', 'bamboo', 'dot'] as const).map((suit) => {
                const isRec = data.recommendedDingque === suit;
                const sampleTile = suit === 'wan' ? 'wan5' : suit === 'bamboo' ? 'bamboo5' : 'dot5';
                return (
                  <button
                    key={suit}
                    type="button"
                    className={`mj3d-dq-choice${isRec ? ' is-rec' : ''}`}
                    onClick={() => {
                      audio.play('mahjong_peng');
                      onAction('dingque', { suit });
                    }}
                  >
                    {isRec && <span className="mj3d-dq-rec-tag">军师推荐</span>}
                    <MahjongTile tile={sampleTile} size="md" />
                    <strong>定缺{suitLabel(suit)}</strong>
                    <small>当前手牌 {suitCounts[suit]} 张</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 局内快捷玩法与番型速查抽屉 */}
      {rulesDrawerOpen && (
        <div className="mj3d-rules-drawer">
          <div className="mj3d-rules-drawer__head">
            <strong>📜 {variantName} · 正宗规则速查</strong>
            <button type="button" onClick={() => setRulesDrawerOpen(false)}>
              ✕
            </button>
          </div>
          <ul>
            {variantMeta.rules.map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 中央动作横幅 & 吃/碰/杠/胡/自摸华丽特效层 */}
      {centerFx && (
        <div key={`mj-fx-${centerFx.id}`} className={`mj3d-fx-layer mj3d-fx-layer--${centerFx.kind}`}>
          {centerFx.kind === 'banner' ? (
            <div className="mj3d-glass-banner">
              <strong>{centerFx.title}</strong>
              {centerFx.subtitle && <span>{centerFx.subtitle}</span>}
            </div>
          ) : (
            <div className={`mj3d-call-burst is-${centerFx.kind}`}>
              <span className="mj3d-burst-ring mj3d-burst-ring--1" />
              <span className="mj3d-burst-ring mj3d-burst-ring--2" />
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
              <div className="mj3d-burst-glyph">{centerFx.title}</div>
              {centerFx.subtitle && <div className="mj3d-burst-sub">{centerFx.subtitle}</div>}
            </div>
          )}

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

      {/* 豪华结算弹窗 */}
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
                  {bonusLabel === '马'
                    ? '买马开牌（1/5/9/东风/红中中马）'
                    : bonusLabel === '码'
                      ? '扎码开牌（1/5/9/红中全中码）'
                      : `抓${bonusLabel}开牌（1/5/9中${bonusLabel}）`}
                  ：
                </span>
                <div className="mj3d-settle-birds__tiles">
                  {data.birds.map((b) => {
                    const hit =
                      ((b.suit === 'wan' || b.suit === 'bamboo' || b.suit === 'dot') &&
                        (b.val === 1 || b.val === 5 || b.val === 9)) ||
                      (bonusLabel === '马' && ((b.suit === 'wind' && b.val === 1) || (b.suit === 'dragon' && b.val === 1))) ||
                      (bonusLabel === '码' && b.suit === 'dragon' && b.val === 1);
                    return (
                      <div key={b.id} className={`mj3d-bird-item${hit ? ' is-hit' : ''}`}>
                        <MahjongTile
                          tile={`${b.suit}${b.val}`}
                          size="md"
                          isWild={Boolean(data.wildCard && b.suit === data.wildCard.suit && b.val === data.wildCard.val)}
                        />
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
