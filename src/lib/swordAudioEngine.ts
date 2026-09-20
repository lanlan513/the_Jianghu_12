import type { ResonanceParams } from './swordResonance';

/**
 * 剑鸣音频引擎 —— 纯 Web Audio 现场合成。
 *
 * 不加载任何音频文件、不引入音频库：
 * - 泛音列全部由 OscillatorNode（正弦）叠加
 * - 出鞘金属擦片由确定性噪声（mulberry32 种子）经带通滤波生成
 * - 包络全部由 GainNode 参数自动化绘制
 *
 * 同一时刻只允许一段剑鸣：切换时旧声部先快速淡出再销毁，
 * 末端接 DynamicsCompressor 防止快速连击时爆音。
 */

const FADE_OUT_SECONDS = 0.08;
const PEAK_GAIN = 0.5;

interface Voice {
  id: number;
  bus: GainNode;
  tone: BiquadFilterNode;
  oscillators: OscillatorNode[];
  lfo: OscillatorNode;
  lfoGain: GainNode;
  noise: AudioBufferSourceNode | null;
}

/** 确定性伪随机序列 —— 同一种子永远生成同一段噪声 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SwordAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voice: Voice | null = null;
  private voiceSeq = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private noiseBuffers = new Map<number, AudioBuffer>();
  private listeners = new Set<() => void>();
  private mutedState = false;
  private playingState = false;
  private currentParams: ResonanceParams | null = null;

  get enabled(): boolean {
    return this.ctx !== null;
  }

  get muted(): boolean {
    return this.mutedState;
  }

  get playing(): boolean {
    return this.playingState;
  }

  get params(): ResonanceParams | null {
    return this.currentParams;
  }

  /** 必须在用户手势中调用（浏览器自动播放策略） */
  async enable(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.mutedState ? 0 : 1;

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.24;

      this.master.connect(this.analyser);
      this.analyser.connect(this.compressor);
      this.compressor.connect(ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    return this.ctx.state === 'running';
  }

  setMuted(muted: boolean): void {
    this.mutedState = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
    }
    this.notify();
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** 奏响一段剑鸣；若上一段未结束，先将其淡出 */
  play(params: ResonanceParams): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;

    this.fadeOutVoice(now);
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }

    const id = ++this.voiceSeq;

    // 声部总线：包络绘制在这里
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);

    // 锋利度 → 明亮度（低通截止）
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = params.brightnessHz;
    tone.Q.value = 0.5;
    bus.connect(tone);
    tone.connect(master);

    // 韧性 → 颤音（LFO 调制各振荡器频率，深度即幅度）
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = params.vibratoRateHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = params.vibratoDepthHz;
    lfo.connect(lfoGain);
    lfo.start(now);
    lfo.stop(now + params.duration + 0.3);

    // 泛音列 —— 数量与分布由锋利度决定
    const norm = 1 / Math.sqrt(params.harmonicCount);
    const oscillators = params.partials.map((partial) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = partial.frequency;
      lfoGain.connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = partial.gain * norm;
      osc.connect(gain);
      gain.connect(bus);
      osc.start(now);
      osc.stop(now + params.duration + 0.3);
      return osc;
    });

    // 包络 —— 工艺决定起音与段数（段数越多衰减曲线越细腻）
    const envelope = bus.gain;
    envelope.exponentialRampToValueAtTime(PEAK_GAIN, now + params.attackTime);
    const decaySpan = Math.max(params.duration - params.attackTime, 0.05);
    for (let i = 1; i <= params.envelopeSegments; i += 1) {
      const frac = i / params.envelopeSegments;
      const value = Math.max(PEAK_GAIN * (0.0001 / PEAK_GAIN) ** frac, 0.0001);
      envelope.exponentialRampToValueAtTime(value, now + params.attackTime + decaySpan * frac);
    }

    // 出鞘擦片 —— 确定性种子噪声经带通滤波
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(params.noiseSeed);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = params.noiseBurst.centerHz;
    band.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(params.noiseBurst.gain, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + params.noiseBurst.duration);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(now);
    noise.stop(now + params.noiseBurst.duration + 0.05);

    const voice: Voice = { id, bus, tone, oscillators, lfo, lfoGain, noise };
    this.voice = voice;
    this.currentParams = params;
    this.playingState = true;

    this.endTimer = setTimeout(() => {
      if (this.voice?.id === id) {
        this.voice = null;
        this.playingState = false;
      }
      this.teardown(voice);
      this.notify();
    }, params.duration * 1000 + 150);

    this.notify();
  }

  /** 淡出并停止当前剑鸣 */
  stop(): void {
    if (!this.ctx) return;
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.fadeOutVoice(this.ctx.currentTime);
    this.playingState = false;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fadeOutVoice(now: number): void {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    voice.bus.gain.cancelScheduledValues(now);
    voice.bus.gain.setTargetAtTime(0.0001, now, FADE_OUT_SECONDS / 3);
    setTimeout(() => this.teardown(voice), FADE_OUT_SECONDS * 1000 + 250);
  }

  private teardown(voice: Voice): void {
    for (const osc of voice.oscillators) {
      try {
        osc.stop();
      } catch {
        /* 已停止 */
      }
      osc.disconnect();
    }
    try {
      voice.lfo.stop();
    } catch {
      /* 已停止 */
    }
    voice.lfo.disconnect();
    voice.lfoGain.disconnect();
    if (voice.noise) {
      try {
        voice.noise.stop();
      } catch {
        /* 已停止 */
      }
      voice.noise.disconnect();
    }
    voice.bus.disconnect();
    voice.tone.disconnect();
  }

  private getNoiseBuffer(seed: number): AudioBuffer {
    const cached = this.noiseBuffers.get(seed);
    if (cached) return cached;
    const ctx = this.ctx;
    if (!ctx) throw new Error('AudioContext 尚未初始化');
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rand = mulberry32(seed);
    for (let i = 0; i < length; i += 1) {
      data[i] = rand() * 2 - 1;
    }
    if (this.noiseBuffers.size > 24) this.noiseBuffers.clear();
    this.noiseBuffers.set(seed, buffer);
    return buffer;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const swordEngine = new SwordAudioEngine();
