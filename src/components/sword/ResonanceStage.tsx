/**
 * 剑鸣 · 共鸣台（全局固定画台）
 *
 * 画面三要素全部由 AnalyserNode 的真实数据驱动：
 *  - 水墨涟漪：出声时荡开，扩散速度随真实 RMS 起伏；
 *  - 声波扩散：时域波形横贯画面；
 *  - 墨点：随真实频谱逐点跳动。
 * 静音 / 未开声 / 被暂停 / 发声结束 / 系统开启「减少动态效果」时，
 * 画面退化为一张静态波形图，不再有任何运动。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AudioLines, Volume2, VolumeX } from 'lucide-react';
import { soundEngine } from '@/audio/soundEngine';
import { hash, type ResonanceParams } from '@/audio/jianmingCore';

const PAPER = '#f5f0e6';
const INK = '26, 26, 26';
const DOTS = 40;

interface Ripple {
  x: number;
  y: number;
  r: number;
  maxR: number;
}

export default function ResonanceStage() {
  const state = useSyncExternalStore(soundEngine.subscribe, soundEngine.getState);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const rafRef = useRef(0);
  const dimsRef = useRef({ w: 0, h: 0 });
  const ripplesRef = useRef<Ripple[]>([]);
  const ensureLoopRef = useRef<() => void>(() => {});
  const spawnRipplesRef = useRef<() => void>(() => {});
  const lastRippleSeqRef = useRef(0);

  /* 「减少动态效果」系统设置变化 */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* 画布装配：尺寸、绘制函数、动画循环（全部只挂载一次，经 ref 读最新状态） */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;

    const td = new Uint8Array(2048);
    const fd = new Uint8Array(1024);

    const isActive = () => {
      const s = stateRef.current;
      const ctx = soundEngine.getContext();
      return (
        s.enabled &&
        !s.muted &&
        !reducedMotionRef.current &&
        !!ctx &&
        ctx.state === 'running' &&
        ctx.currentTime < soundEngine.getCurrentEnd()
      );
    };

    const drawStatic = () => {
      const { w, h } = dimsRef.current;
      if (!w || !h) return;
      c2d.fillStyle = PAPER;
      c2d.fillRect(0, 0, w, h);

      const midY = h * 0.52;
      c2d.strokeStyle = `rgba(${INK}, 0.18)`;
      c2d.lineWidth = 1;
      c2d.beginPath();
      c2d.moveTo(0, midY);
      c2d.lineTo(w, midY);
      c2d.stroke();

      const p: ResonanceParams | null = stateRef.current.currentParams;
      if (!p) {
        c2d.fillStyle = `rgba(${INK}, 0.4)`;
        c2d.font = '12px "Noto Serif SC", SimSun, serif';
        c2d.textAlign = 'center';
        c2d.fillText('点任意名剑 · 听其自鸣', w / 2, midY - 10);
        c2d.textAlign = 'left';
        return;
      }

      // 静态波形：由该剑泛音参数确定生成，无动画、无随机
      const cycles = Math.max(3, Math.round(p.baseFreq / 90));
      const used = Math.min(6, p.partials.length);
      c2d.beginPath();
      for (let x = 0; x <= w; x++) {
        const ph = (x / w) * Math.PI * 2 * cycles;
        let y = 0;
        let norm = 0;
        for (let k = 0; k < used; k++) {
          const g = p.partials[k].gain;
          y += g * Math.sin(ph * (k + 1));
          norm += g;
        }
        y = (y / norm) * h * 0.26 * Math.exp(-(x / w) * 2.2);
        if (x === 0) c2d.moveTo(x, midY + y);
        else c2d.lineTo(x, midY + y);
      }
      c2d.strokeStyle = `rgba(${INK}, 0.8)`;
      c2d.lineWidth = 1.4;
      c2d.stroke();

      c2d.fillStyle = `rgba(${INK}, 0.5)`;
      c2d.font = '11px "Noto Serif SC", SimSun, serif';
      c2d.fillText(`${p.swordName} · 静态波形`, 10, 16);
    };

    const drawFrame = () => {
      const analyser = soundEngine.getAnalyser();
      const { w, h } = dimsRef.current;
      if (!analyser || !w || !h) return;
      analyser.getByteTimeDomainData(td);
      analyser.getByteFrequencyData(fd);

      let sum = 0;
      for (let i = 0; i < td.length; i++) {
        const v = (td[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / td.length);

      // 宣纸拖影
      c2d.fillStyle = 'rgba(245, 240, 230, 0.38)';
      c2d.fillRect(0, 0, w, h);

      // 水墨涟漪：扩散速度随真实 RMS 起伏
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 1.1 + rms * 9;
        if (rp.r <= 0) continue;
        if (rp.r > rp.maxR) {
          ripples.splice(i, 1);
          continue;
        }
        const a = (1 - rp.r / rp.maxR) * 0.4;
        c2d.beginPath();
        c2d.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        c2d.strokeStyle = `rgba(${INK}, ${a})`;
        c2d.lineWidth = 1.4;
        c2d.stroke();
        c2d.beginPath();
        c2d.arc(rp.x, rp.y, rp.r * 0.8, 0, Math.PI * 2);
        c2d.strokeStyle = `rgba(${INK}, ${a * 0.5})`;
        c2d.lineWidth = 0.8;
        c2d.stroke();
      }

      // 声波：真实时域波形
      const midY = h * 0.44;
      c2d.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const v = (td[Math.floor((x / w) * (td.length - 1))] - 128) / 128;
        const y = midY + v * h * 0.3;
        if (x === 0) c2d.moveTo(x, y);
        else c2d.lineTo(x, y);
      }
      c2d.strokeStyle = `rgba(${INK}, 0.75)`;
      c2d.lineWidth = 1.3;
      c2d.stroke();

      // 墨点：随真实频谱跳动
      const baseY = h * 0.88;
      c2d.beginPath();
      c2d.moveTo(0, baseY);
      c2d.lineTo(w, baseY);
      c2d.strokeStyle = `rgba(${INK}, 0.22)`;
      c2d.lineWidth = 1;
      c2d.stroke();
      for (let i = 0; i < DOTS; i++) {
        const bin = 2 + Math.floor(Math.pow(i / DOTS, 1.6) * fd.length * 0.7);
        const v = fd[bin] / 255;
        const x = ((i + 0.5) / DOTS) * w;
        const dy = v * h * 0.34;
        c2d.beginPath();
        c2d.arc(x, baseY - dy, 1.6 + v * 2.6, 0, Math.PI * 2);
        c2d.fillStyle = `rgba(${INK}, ${0.22 + v * 0.68})`;
        c2d.fill();
      }
    };

    const tick = () => {
      rafRef.current = 0;
      if (!isActive()) {
        ripplesRef.current.length = 0;
        drawStatic();
        return;
      }
      drawFrame();
      rafRef.current = requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (rafRef.current) return;
      if (!isActive()) {
        drawStatic();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      dimsRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!isActive()) drawStatic();
    };

    ensureLoopRef.current = ensureLoop;
    spawnRipplesRef.current = () => {
      const s = stateRef.current;
      if (reducedMotionRef.current || s.muted || !s.currentSwordId) return;
      const { w, h } = dimsRef.current;
      if (!w || !h) return;
      // 涟漪落点由剑 id 确定推导，同剑同位
      const seed = hash(s.currentSwordId);
      const x = (0.25 + ((seed % 1000) / 1000) * 0.5) * w;
      const y = h * 0.44;
      for (let k = 0; k < 3; k++) {
        ripplesRef.current.push({ x, y, r: -k * 22, maxR: Math.max(w, h) * 0.95 });
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    // 画布在开声后才挂载，故依赖 state.enabled 重新装配
  }, [state.enabled]);

  /* 开声 / 静音 / 减少动态 变化 → 启动或静止画面 */
  useEffect(() => {
    ensureLoopRef.current();
  }, [state.enabled, state.muted, reducedMotion]);

  /* 新的播放 → 荡开涟漪 */
  useEffect(() => {
    if (state.playSeq === lastRippleSeqRef.current) return;
    lastRippleSeqRef.current = state.playSeq;
    spawnRipplesRef.current();
    ensureLoopRef.current();
  }, [state.playSeq]);

  const p = state.currentParams;

  /* 未开声：明确的「开声」按钮（浏览器策略下不自动出声） */
  if (!state.enabled) {
    return (
      <button
        key={state.enableNudge /* nudge 变化时重挂载以重放提示动画 */}
        type="button"
        onClick={() => soundEngine.enable()}
        className={`fixed bottom-5 right-5 z-40 flex items-center gap-2 px-5 py-3 bg-ink-900 text-ink-100 font-song text-sm tracking-[0.2em] shadow-ink-hover hover:bg-ink-800 transition-colors ${
          state.enableNudge > 0 ? 'animate-nudge' : ''
        }`}
      >
        <Volume2 className="w-4 h-4 text-gold-400" />
        开声 · 听剑
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[min(92vw,360px)] bg-ink-50 border border-ink-200 shadow-ink-hover">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-200">
        <div className="flex items-center gap-2 min-w-0">
          <AudioLines className="w-4 h-4 text-cinnabar-600 shrink-0" />
          <span className="font-brush text-lg text-ink-900 leading-none">剑鸣</span>
          <span className="font-song text-xs text-ink-500 truncate">
            {state.currentSwordName ?? '尚未出鞘'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => soundEngine.setMuted(!state.muted)}
          aria-pressed={state.muted}
          aria-label={state.muted ? '取消静音' : '静音'}
          className="p-1.5 text-ink-600 hover:text-ink-900 transition-colors"
        >
          {state.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      <canvas ref={canvasRef} className="block w-full h-28" aria-hidden="true" />

      <div className="flex items-center justify-between px-3 py-1.5 font-song text-[11px] text-ink-500 border-t border-ink-200/60">
        <span>基频 {p ? p.baseFreq.toFixed(1) : '—'} Hz</span>
        <span>时长 {p ? p.duration.toFixed(2) : '—'} s</span>
        <span>泛音 {p ? p.harmonics : '—'}</span>
        <span>颤音 ±{p ? p.vibratoDepth.toFixed(0) : '—'}</span>
      </div>

      {(reducedMotion || state.muted) && (
        <div className="px-3 pb-2 font-song text-[11px] text-cinnabar-600">
          {reducedMotion ? '已开启「减少动态效果」· 静态波形' : '已静音 · 静态波形'}
        </div>
      )}
    </div>
  );
}
