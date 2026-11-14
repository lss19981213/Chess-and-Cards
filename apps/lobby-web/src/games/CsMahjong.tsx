import { useState } from 'react';
import { MahjongTile } from '../components/MahjongTile';
import { audio } from '../audio';
import { DEALER_MAIN } from '../assets';

interface MahjongTileData {
  id: string;
  suit: 'dot' | 'bamboo' | 'wan';
  val: number;
}

interface Meld {
  type: 'pong' | 'kong' | 'chow';
  tiles: MahjongTileData[];
}

interface CsMahjongSnapshot {
  phase: string;
  round: number;
  turn: string | null;
  remainingCount: number;
  lastDiscard: { playerId: string; tile: MahjongTileData } | null;
  myHand: MahjongTileData[];
  myDrawn: MahjongTileData | null;
  canHu: boolean;
  canPong: boolean;
  birds: MahjongTileData[];
  winners: string[];
  results: Array<{
    playerId: string;
    nickname: string;
    delta: number;
    huType: string;
    birds: MahjongTileData[];
  }>;
  players: Array<{
    playerId: string;
    nickname: string;
    seat: number;
    isBot: boolean;
    cardCount: number;
    melds: Meld[];
    discards: MahjongTileData[];
    hand: MahjongTileData[];
  }>;
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onAction: (cmd: string, payload?: Record<string, unknown>) => void;
}

export function CsMahjong({ snapshot, myId, status, balance: _balance, onAction }: Props) {
  const data = snapshot as unknown as CsMahjongSnapshot | undefined;
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);

  if (!data) return <div className="board-placeholder">正在进入长沙麻将雀局…</div>;

  const isMyTurn = data.turn === myId && status === 'playing';
  const showResults = data.results && data.results.length > 0;
  const me = data.players.find((p) => p.playerId === myId);

  const handleTileClick = (t: MahjongTileData) => {
    if (!isMyTurn) return;
    if (selectedTileId === t.id) {
      // 出牌
      audio.play('chip_clack');
      onAction('discard', { tileId: t.id });
      setSelectedTileId(null);
    } else {
      audio.play('click');
      setSelectedTileId(t.id);
    }
  };

  const handlePong = () => {
    audio.play('chip_clack');
    onAction('pong');
  };

  const handleHu = () => {
    audio.play('win');
    onAction('hu');
  };

  const handlePass = () => {
    audio.play('pass');
    onAction('pass');
  };

  // 找其他三位玩家 (按座位顺时针: 下家/右, 对家/上, 上家/左)
  const _mySeat = me?.seat ?? 0;
  const otherPlayers = data.players.filter((p) => p.playerId !== myId);

  return (
    <div className="lobby-game cs-mahjong-game">
      <div className="lobby-game__main">
        {/* 顶部状态栏 */}
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局 · 长沙麻将</span>
          <span className={`lobby-game__phase ${isMyTurn ? 'is-open' : 'is-idle'}`}>
            {isMyTurn ? '★ 轮到你出牌 ★' : '对手思考中…'}
          </span>
          <span className="lobby-game__mine">牌墙余: {data.remainingCount} 张</span>
        </div>

        {/* 荷官席位 */}
        <div className="table-dealer-host">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">{isMyTurn ? '请摸牌打牌' : '雀神争霸中'}</span>
          </div>
        </div>

        {/* 麻将大桌台面 */}
        <div className="mahjong-table">
          {/* 对家手牌与弃牌区 */}
          <div className="mahjong-opponents">
            {otherPlayers.map((p) => (
              <div key={p.playerId} className={`mahjong-player-seat ${data.turn === p.playerId ? 'is-turn' : ''}`}>
                <div className="mahjong-seat-header">
                  <span className="seat-name">{p.nickname}</span>
                  <span className="seat-count">{p.cardCount} 张</span>
                </div>
                {/* 碰牌面子 */}
                {p.melds.length > 0 && (
                  <div className="mahjong-melds">
                    {p.melds.map((m, mi) => (
                      <div key={mi} className="mahjong-meld">
                        {m.tiles.map((mt) => (
                          <MahjongTile key={mt.id} tile={`${mt.suit}${mt.val}`} size="sm" />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {/* 弃牌 */}
                <div className="mahjong-discards">
                  {p.discards.slice(-8).map((dt) => (
                    <MahjongTile key={dt.id} tile={`${dt.suit}${dt.val}`} size="sm" />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 牌桌中央：最新出牌展示 */}
          <div className="mahjong-center-pot">
            {data.lastDiscard ? (
              <div className="last-discard-box">
                <span className="last-discard-label">最新打出</span>
                <MahjongTile tile={`${data.lastDiscard.tile.suit}${data.lastDiscard.tile.val}`} size="md" />
              </div>
            ) : (
              <div className="mahjong-table-logo">🀄 长沙麻将</div>
            )}
          </div>

          {/* 结算结果 & 抓鸟展示 */}
          {showResults && (
            <div className="mahjong-settle-overlay">
              <div className="mahjong-settle-card">
                <h3>雀神结算 · 开门抓鸟</h3>
                {data.birds.length > 0 && (
                  <div className="birds-row">
                    <span className="birds-label">抓鸟 ({data.birds.length}张):</span>
                    {data.birds.map((b) => (
                      <MahjongTile key={b.id} tile={`${b.suit}${b.val}`} size="sm" />
                    ))}
                  </div>
                )}
                <div className="settle-players-list">
                  {data.results.map((r) => (
                    <div key={r.playerId} className="settle-row">
                      <span className="settle-name">{r.nickname}</span>
                      <span className="settle-type">{r.huType}</span>
                      <strong className={r.delta > 0 ? 'up' : 'down'}>
                        {r.delta > 0 ? `+${r.delta}` : r.delta}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 我的碰牌面子 */}
          {me?.melds && me.melds.length > 0 && (
            <div className="my-melds-row">
              {me.melds.map((m, mi) => (
                <div key={mi} className="mahjong-meld">
                  {m.tiles.map((mt) => (
                    <MahjongTile key={mt.id} tile={`${mt.suit}${mt.val}`} size="sm" />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* 我的手牌 (立牌 + 悬浮升起) */}
          <div className="my-mahjong-hand">
            {data.myHand.map((t) => (
              <MahjongTile
                key={t.id}
                tile={`${t.suit}${t.val}`}
                size="lg"
                active={selectedTileId === t.id}
                onClick={() => handleTileClick(t)}
                className="my-tile"
              />
            ))}
          </div>

          {/* 交互操作栏：胡、碰、过 */}
          {(data.canHu || data.canPong || isMyTurn) && !showResults && (
            <div className="mahjong-action-bar">
              {data.canHu && (
                <button type="button" className="mj-action-btn mj-btn-hu" onClick={handleHu}>
                  🀄 胡 牌
                </button>
              )}
              {data.canPong && (
                <button type="button" className="mj-action-btn mj-btn-pong" onClick={handlePong}>
                  碰
                </button>
              )}
              {(data.canHu || data.canPong) && (
                <button type="button" className="mj-action-btn mj-btn-pass" onClick={handlePass}>
                  过
                </button>
              )}
              {isMyTurn && (
                <span className="mj-action-hint">
                  {selectedTileId ? '再次点击选中牌打出' : '点击选择一张手牌打出'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CsMahjong;
