import { useEffect, useRef, useState } from 'react';

/**
 * 百人常驻场（百家乐 / 21点 / 骰宝 / 斗牛 / 推筒子）统一平滑倒计时与进度条 Hook：
 * - 基于 performance.now() 本地 100ms 高帧率推进，即使期间无服务端快照推送也绝不卡顿停滞
 * - 切阶段 / 切局或与服务端误差 > 600ms 时自动校准，消除跳变与漂移
 * - 统一返回剩余秒数 leftSec 与平滑进度百分比 progressPct（100% -> 0%）
 */
export function usePhaseCountdown(
  remainMs: number | undefined,
  phaseDurationMs: number | undefined,
  phase: string | undefined,
  round: number | undefined,
  fallbackDurationMs = 30_000,
): { leftSec: number; progressPct: number } {
  const safeDuration = Math.max(1000, phaseDurationMs ?? fallbackDurationMs);
  const initialRemain = Math.max(0, remainMs ?? 0);

  const endPerfRef = useRef<number>(performance.now() + initialRemain);
  const phaseKeyRef = useRef<string>(`${round ?? 0}:${phase ?? ''}`);
  const [liveRemainMs, setLiveRemainMs] = useState<number>(initialRemain);

  useEffect(() => {
    if (remainMs === undefined || phase === undefined) return;
    const nowPerf = performance.now();
    const key = `${round ?? 0}:${phase}`;
    const targetEnd = nowPerf + Math.max(0, remainMs);
    const currentRemain = Math.max(0, endPerfRef.current - nowPerf);

    // 换局、换阶段、从 0 恢复或误差超过 600ms 时重新对齐截止时间
    if (key !== phaseKeyRef.current || Math.abs(currentRemain - remainMs) > 600) {
      phaseKeyRef.current = key;
      endPerfRef.current = targetEnd;
      setLiveRemainMs(Math.max(0, remainMs));
    }
  }, [remainMs, phase, round]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const rem = Math.max(0, endPerfRef.current - performance.now());
      setLiveRemainMs(rem);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const leftSec = Math.max(0, Math.ceil(liveRemainMs / 1000));
  const progressPct = Math.min(100, Math.max(0, (liveRemainMs / safeDuration) * 100));
  return { leftSec, progressPct };
}
