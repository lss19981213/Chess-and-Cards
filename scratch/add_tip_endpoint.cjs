const fs = require('fs');
let code = fs.readFileSync('apps/api-server/src/index.ts', 'utf8');
const target = '    return { reward: task.reward, balance: newBalance, tasks: await buildTasks(claims.sub, newBalance) };\n  });';
const addition = `    return { reward: task.reward, balance: newBalance, tasks: await buildTasks(claims.sub, newBalance) };
  });

  /** 玩家打赏荷官接口 */
  app.post('/api/tip-dealer', async (req, reply) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Number(body.amount);
    const giftName = typeof body.giftName === 'string' ? body.giftName : '心意';
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000) {
      return reply.status(400).send({ error: '打赏金额不合法' });
    }
    const bizId = \`tip:\${claims.sub}:\${Date.now()}\`;
    try {
      const balance = await repo.adjustBet({
        userId: claims.sub,
        amount,
        action: 'debit',
        bizId,
      });
      return { ok: true, balance, amount, giftName };
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return reply.status(400).send({ error: '筹码不足，快去领取福利或赢几局吧～' });
      }
      throw e;
    }
  });`;

if (!code.includes('/api/tip-dealer')) {
  code = code.replace(target, addition);
  fs.writeFileSync('apps/api-server/src/index.ts', code, 'utf8');
  console.log('Added /api/tip-dealer endpoint successfully');
} else {
  console.log('Already has /api/tip-dealer');
}
