const fs = require('fs');
let code = fs.readFileSync('apps/lobby-web/src/components/Lobby.tsx', 'utf8');

// 1. Import DealerTipWidget
code = code.replace(
  "import { Chip } from './Chip';",
  "import { Chip } from './Chip';\nimport { DealerTipWidget } from './DealerTipWidget';"
);

// 2. Add onBalanceChange to Props
code = code.replace(
  "  onAssistant: () => void;\n  onRules: () => void;\n}",
  "  onAssistant: () => void;\n  onRules: () => void;\n  onBalanceChange?: (newBalance: number) => void;\n}"
);

// 3. Destructure onBalanceChange in Lobby
code = code.replace(
  "  onAssistant,\n  onRules,\n}: Props) {",
  "  onAssistant,\n  onRules,\n  onBalanceChange,\n}: Props) {\n  const [customQuote, setCustomQuote] = useState<string | null>(null);"
);

// 4. Update speech bubble content
const oldBubble = `<p className="bubble-content">
              {activeTab === 'live'
                ? '百人推筒子、骰宝正在火爆下注，主人要试试手气吗？'
                : activeTab === 'cards'
                  ? '经典斗地主秒匹秒开，AI陪玩随叫随到，祝您把把通天顺！'
                  : '国粹象棋楚汉争霸，静候主人排兵布阵～'}
            </p>`;

const newBubble = `<p className="bubble-content">
              {customQuote ?? (activeTab === 'live'
                ? '百人推筒子、骰宝正在火爆下注，主人要试试手气吗？'
                : activeTab === 'cards'
                  ? '经典斗地主秒匹秒开，AI陪玩随叫随到，祝您把把通天顺！'
                  : '国粹象棋楚汉争霸，静候主人排兵布阵～')}
            </p>`;

code = code.replace(oldBubble, newBubble);

// 5. Add DealerTipWidget in companion-footer-actions
const oldFooter = `          <div className="companion-footer-actions">
            <button type="button" className="btn-random-match" onClick={handleRandomPlay}>
              <span>🎲 随机幸运开局</span>
            </button>
          </div>`;

const newFooter = `          <div className="companion-footer-actions">
            <button type="button" className="btn-random-match" onClick={handleRandomPlay}>
              <span>🎲 随机幸运开局</span>
            </button>
            <DealerTipWidget
              balance={user?.balance ?? 0}
              onBalanceChange={onBalanceChange ?? (() => {})}
              onAliceSpeak={(txt) => setCustomQuote(txt)}
            />
          </div>`;

code = code.replace(oldFooter, newFooter);

fs.writeFileSync('apps/lobby-web/src/components/Lobby.tsx', code, 'utf8');
console.log('Lobby.tsx updated successfully');
