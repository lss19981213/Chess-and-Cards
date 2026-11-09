const fs = require('fs');

function updateFile(file) {
  if (!fs.existsSync(file)) return;
  let code = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (code.includes('庄家每局开三张牌算牛点，押中对应的牛数就赢。')) {
    code = code.replace(
      '庄家每局开三张牌算牛点，押中对应的牛数就赢。',
      '百人极速斗牛：庄家每局开三张牌快速算牛（三张点数之和取尾数定牛点），押中对应的牛数或无牛即可斩获高倍筹码！'
    );
    changed = true;
  }

  if (code.includes('楚汉对决，王将争锋')) {
    code = code.replace(
      '楚汉对决，王将争锋',
      '六十四格西洋棋，兵升变与王车易位的智慧博弈'
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, code, 'utf8');
    console.log('Updated:', file);
  } else {
    console.log('No matches in:', file);
  }
}

updateFile('apps/lobby-web/src/components/RulesModal.tsx');
updateFile('apps/lobby-web/src/components/RulesView.tsx');
