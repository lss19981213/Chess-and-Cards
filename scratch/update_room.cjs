const fs = require('fs');
let code = fs.readFileSync('apps/lobby-web/src/components/Room.tsx', 'utf8');

// 1. Replace SettlePanel import with SettleBubble, WinCelebration, DealerTipWidget
code = code.replace(
  "import { SettlePanel, type ResultRow } from './SettlePanel';",
  "import { SettleBubble, type ResultRow } from './SettleBubble';\nimport { WinCelebration } from './WinCelebration';\nimport { DealerTipWidget } from './DealerTipWidget';"
);

// 2. Add onBalanceChange to Props
code = code.replace(
  "  /** 平台坐庄的常驻玩法 */\n  persistent: boolean;\n}",
  "  /** 平台坐庄的常驻玩法 */\n  persistent: boolean;\n  onBalanceChange?: (newBalance: number) => void;\n}"
);

// 3. Destructure onBalanceChange in Room
code = code.replace(
  "  onEmote,\n  persistent,\n}: Props) {",
  "  onEmote,\n  persistent,\n  onBalanceChange,\n}: Props) {"
);

// 4. Add customDealerTip state
code = code.replace(
  "  const [cheerEffect, setCheerEffect] = useState(false);",
  "  const [cheerEffect, setCheerEffect] = useState(false);\n  const [customDealerTip, setCustomDealerTip] = useState<string | null>(null);"
);

// 5. Update dealerTip
const oldDealerTip = `  const dealerTip = useMemo(() => {
    if (room.status === 'waiting') return '各位牌友请就绪，精彩马上开启～';
    if (room.status === 'playing') return '艾莉丝发牌中，祝主人好运连连！';
    if (room.status === 'settled') return '本局结算完毕，手气真棒～';
    return '艾莉丝陪伴为您服务';
  }, [room.status]);`;

const newDealerTip = `  const dealerTip = useMemo(() => {
    if (customDealerTip) return customDealerTip;
    if (myDelta > 0 && (room.status === 'settled' || !persistent)) {
      return \`哇！恭喜主人大获全胜～赢了 +\${myDelta.toLocaleString()} 筹码！🎉\`;
    }
    if (myDelta < 0 && (room.status === 'settled' || !persistent)) {
      return '主人别灰心，下一局一定通天大顺翻倍赢回来！💪';
    }
    if (room.status === 'waiting') return '各位牌友请就绪，精彩马上开启～';
    if (room.status === 'playing') return '艾莉丝发牌中，祝主人好运连连！';
    if (room.status === 'settled') return '本局结算完毕，手气真棒～';
    return '艾莉丝陪伴为您服务';
  }, [customDealerTip, myDelta, room.status, persistent]);`;

code = code.replace(oldDealerTip, newDealerTip);

// 6. Replace CoinBurst & SettlePanel with WinCelebration & SettleBubble
const oldSettleJSX = `      {settlement && myDelta > 0 && <CoinBurst key={\`\${room.roomId}-\${room.round}\`} />}

      {/* 胜利/局结弹窗 */}
      {showPanel && (
        <SettlePanel
          gameId={room.gameId}
          round={room.round}
          rows={resultRows}
          myId={myId}
          balance={balance}
          persistent={isPersistentGame}
          onContinue={() => {
            setDismissedKey(resultKey);
            onReady(true);
          }}
          onClose={() => setDismissedKey(resultKey)}
        />
      )}`;

const newSettleJSX = `      {settlement && myDelta > 0 && <WinCelebration key={\`win-\${room.roomId}-\${room.round}\`} delta={myDelta} />}

      {/* 战报气泡 HUD (轻量浮动，零遮挡，非阻断) */}
      {showPanel && (
        <SettleBubble
          gameId={room.gameId}
          round={room.round}
          rows={resultRows}
          myId={myId}
          balance={balance}
          persistent={isPersistentGame}
          onContinue={() => {
            setDismissedKey(resultKey);
            onReady(true);
          }}
          onClose={() => setDismissedKey(resultKey)}
        />
      )}`;

code = code.replace(oldSettleJSX, newSettleJSX);

// 7. Add DealerTipWidget inside room-dealer-companion
const oldDealerCompanion = `            <div className="room-dealer-speech">
              <div className="room-dealer-header">
                <span className="room-dealer-name">荷官 · 艾莉丝</span>
                {cheerEffect && <span className="dealer-heart-float">💖</span>}
              </div>
              <span className="room-dealer-text">{dealerTip}</span>
            </div>
          </aside>`;

const newDealerCompanion = `            <div className="room-dealer-speech">
              <div className="room-dealer-header">
                <span className="room-dealer-name">荷官 · 艾莉丝</span>
                {cheerEffect && <span className="dealer-heart-float">💖</span>}
              </div>
              <span className="room-dealer-text">{dealerTip}</span>
            </div>

            {/* 玩家打赏荷官组件 */}
            <DealerTipWidget
              balance={balance}
              onBalanceChange={onBalanceChange ?? (() => {})}
              onAliceSpeak={(txt) => setCustomDealerTip(txt)}
              className="room-dealer-tip-slot"
            />
          </aside>`;

code = code.replace(oldDealerCompanion, newDealerCompanion);

fs.writeFileSync('apps/lobby-web/src/components/Room.tsx', code, 'utf8');
console.log('Room.tsx updated successfully');
