import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Square } from 'lucide-react';
import { useResonanceStore } from '@/stores/resonanceStore';
import { swordEngine } from '@/lib/swordAudioEngine';
import type { ResonanceParams } from '@/lib/swordResonance';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

/**
 * 剑鸣共鸣台 —— 全局可视化条。
 *
 * 画面完全由真实 AnalyserNode 数据驱动：
 * - 水墨涟漪：时域 RMS 能量越过阈值时扩散
 * - 声波扩散：时域波形（getByteTimeDomainData）
 * - 墨点：频谱（getByteFrequencyData）逐点映射
 *
 * 静音、停止或「减少动态效果」开启时，退化为一张静态波形图，
 * 不跑任何动画帧，画面保持静止。
 */

const PAPER = '#f5f0e6';
const INK = '#1a1a1a';
const INK_LINE = 'rgba(26, 26, 26, 0.14)';
const RIPPLE_INK = '45, 58, 74';
const CINNABAR = '196, 30, 58';
const DOT_COUNT = 42;
const DOT_MIN_HZ = 60;
const DOT_MAX_HZ = 12000;

interface Ripple {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

function fitCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** 静态波形图 —— 由推导参数确定性地绘制，一帧画完即静止 */
function drawStaticWaveform(canvas: HTMLCanvasElement, params: ResonanceParams | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  const mid = h / 2;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = INK_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  if (params) {
    const samples = Math.max(2, Math.floor(w));
    const decaySpan = Math.max(params.duration - params.attackTime, 0.001);
    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const t = (i / samples) * params.duration;
      const envelope =
        t < params.attackTime
          ? t / params.attackTime
          : (0.0001 / 0.5) ** ((t - params.attackTime) / decaySpan);
      const carrier =
        Math.sin(2 * Math.PI * params.baseFrequency * t) +
        0.35 * Math.sin(2 * Math.PI * params.baseFrequency * 2 * t);
      const y = mid - carrier * envelope * (h * 0.32);
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, h * 0.012);
    ctx.stroke();
  }

  // 静止的墨点基线 —— 不跳动
  for (let i = 0; i < DOT_COUNT; i += 1) {
    const x = ((i + 0.5) / DOT_COUNT) * w;
    ctx.beginPath();
    ctx.arc(x, h - h * 0.08, Math.max(1, h * 0.014), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(26, 26, 26, 0.18)';
    ctx.fill();
  }
}

export default function ResonanceStage() {
  const audioEnabled = useResonanceStore((s) => s.audioEnabled);
  const muted = useResonanceStore((s) => s.muted);
  const playing = useResonanceStore((s) => s.playing);
  const swordName = useResonanceStore((s) => s.swordName);
  const params = useResonanceStore((s) => s.params);
  const toggleMute = useResonanceStore((s) => s.toggleMute);
  const stop = useResonanceStore((s) => s.stop);
  const reducedMotion = usePrefersReducedMotion();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sizeTick, setSizeTick] = useState(0);

  const dynamic = audioEnabled && playing && !muted && !reducedMotion;

  useEffect(() => {
    const onResize = () => setSizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 动态模式：rAF 循环，全部数据来自真实 AnalyserNode
  useEffect(() => {
    if (!dynamic) return;
    const canvas = canvasRef.current;
    const analyser = swordEngine.getAnalyser();
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    fitCanvas(canvas);
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);
    const sampleRate = analyser.context.sampleRate;
    const ripples: Ripple[] = [];
    let raf = 0;
    let lastRippleAt = 0;

    const render = (now: number) => {
      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(timeData);

      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, w, h);

      // 时域 RMS 能量（真实数据）
      let sum = 0;
      let counted = 0;
      for (let i = 0; i < timeData.length; i += 4) {
        const v = (timeData[i] - 128) / 128;
        sum += v * v;
        counted += 1;
      }
      const rms = Math.sqrt(sum / Math.max(1, counted));

      // 水墨涟漪 —— 能量越阈时自中心扩散
      if (rms > 0.05 && now - lastRippleAt > 240) {
        ripples.push({ x: w / 2, y: mid, r: h * 0.06, alpha: 0.3 + Math.min(rms, 0.35) });
        lastRippleAt = now;
      }
      for (let i = ripples.length - 1; i >= 0; i -= 1) {
        const ripple = ripples[i];
        ripple.r += 1.4 + rms * 4;
        ripple.alpha *= 0.96;
        if (ripple.alpha < 0.02 || ripple.r > Math.max(w, h)) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${RIPPLE_INK}, ${ripple.alpha.toFixed(3)})`;
        ctx.lineWidth = 1 + rms * 5;
        ctx.stroke();
      }

      // 声波扩散 —— 真实时域波形
      const step = Math.max(1, Math.floor(timeData.length / w));
      ctx.beginPath();
      for (let x = 0; x < w; x += 1) {
        const v = timeData[Math.min(timeData.length - 1, x * step)] / 128 - 1;
        const y = mid + v * h * 0.36;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, h * 0.014);
      ctx.stroke();

      // 墨点 —— 真实频谱逐点驱动
      for (let i = 0; i < DOT_COUNT; i += 1) {
        const hz = DOT_MIN_HZ * (DOT_MAX_HZ / DOT_MIN_HZ) ** (i / (DOT_COUNT - 1));
        const bin = Math.min(
          frequencyData.length - 1,
          Math.round((hz / (sampleRate / 2)) * frequencyData.length),
        );
        const v = frequencyData[bin] / 255;
        const x = ((i + 0.5) / DOT_COUNT) * w;
        const y = h - h * 0.08 - v * h * 0.22;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, h * 0.012) + v * h * 0.05, 0, Math.PI * 2);
        ctx.fillStyle =
          i % 7 === 3
            ? `rgba(${CINNABAR}, ${(0.25 + v * 0.75).toFixed(3)})`
            : `rgba(26, 26, 26, ${(0.16 + v * 0.72).toFixed(3)})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [dynamic, sizeTick]);

  // 静态模式：静音 / 停止 / 减少动态效果 —— 画一帧静态波形后保持静止
  useEffect(() => {
    if (dynamic) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    fitCanvas(canvas);
    drawStaticWaveform(canvas, params);
  }, [dynamic, params, sizeTick, muted, reducedMotion, playing, audioEnabled]);

  if (!audioEnabled) return null;

  return (
    <>
      <div className="h-24" aria-hidden="true" />
      <div
        className="fixed bottom-0 inset-x-0 z-40 border-t-2 border-ink-800/20 bg-ink-100/95 backdrop-blur-sm"
        data-testid="resonance-stage"
        data-dynamic={dynamic ? 'true' : 'false'}
      >
        <div className="container mx-auto px-4 h-24 flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-start min-w-[9rem] shrink-0">
            <span className="seal-stamp text-xs mb-1.5">剑鸣</span>
            <span className="font-brush text-xl text-ink-900 leading-none">
              {swordName ?? '未鸣'}
            </span>
            {params && (
              <span className="font-song text-xs text-ink-500 mt-1.5 whitespace-nowrap">
                {params.baseFrequency}Hz · {params.duration}s · {params.harmonicCount}泛音
              </span>
            )}
          </div>

          <canvas
            ref={canvasRef}
            className="flex-1 h-16 md:h-20 min-w-0"
            data-testid="resonance-canvas"
            aria-label="剑鸣波形与频谱"
          />

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? '取消静音' : '静音'}
              data-testid="resonance-mute-toggle"
              className="p-2.5 bg-ink-50 border border-ink-200 text-ink-700 hover:border-cinnabar-500 hover:text-cinnabar-600 transition-colors"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={!playing}
              aria-label="停止剑鸣"
              data-testid="resonance-stop"
              className="p-2.5 bg-ink-50 border border-ink-200 text-ink-700 hover:border-cinnabar-500 hover:text-cinnabar-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Square className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
