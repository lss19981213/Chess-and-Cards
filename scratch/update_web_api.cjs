const fs = require('fs');
let code = fs.readFileSync('apps/lobby-web/src/api.ts', 'utf8');
const addition = `  tipDealer: (amount: number, giftName?: string) =>
    request<{ ok: boolean; balance: number; amount: number; giftName: string }>('/api/tip-dealer', {
      method: 'POST',
      body: JSON.stringify({ amount, giftName }),
    }),\n`;

if (!code.includes('tipDealer:')) {
  code = code.replace('  claimTask: (key: string) =>', addition + '  claimTask: (key: string) =>');
  fs.writeFileSync('apps/lobby-web/src/api.ts', code, 'utf8');
  console.log('Added tipDealer to api.ts successfully');
}
