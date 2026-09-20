/**
 * 剑鸣 · 合成引擎（浏览器单例）
 *
 *  - 不加载任何音频文件，不引任何音频库：全部振荡器与噪声现场合成；
 *  - AudioContext 只在用户点「开声」后创建/恢复（浏览器自动播放策略）；
 *  - 同一时刻只允许一段剑鸣：切换时先把上一段淡出再停止，新段从 0 起音，
 *    连续快速点击不会叠加播放，也不会因硬切产生爆音；
 *  - 画面所需的频谱数据只来自本引擎暴露的 AnalyserNode。
 */
import type { Sword } from '../types';
import {
  deriveResonanceParams,
  envelopeCurve,
  makeNoiseBuffer,
  paramsFor,
  selfTest,
  type ResonanceParams,
  type SelfTestReport,
} from './jianmingCore';

export interface EngineState {
  /** 是否已开声（AudioContext 已创建且 running） */
  enabled: boolean;
  /** 是否静音（主增益为 0，画面退化为静态波形） */
  muted: boolean;
  /** 播放序号：每播放一次 +1，供画面触发涟漪 */
  playSeq: number;
  /** 「请先开声」提示序号：未开声时点剑 +1，供开声按钮闪烁 */
  enableNudge: number;
  currentSwordId: string | null;
  currentSwordName: string | null;
  currentParams: ResonanceParams | null;
}

interface Voice {
  fade: GainNode;
  stopAt: (when: number) => void;
}

const INITIAL_STATE: EngineState = {
  enabled: false,
  muted: false,
  playSeq: 0,
  enableNudge: 0,
  currentSwordId: null,
  currentSwordName: null,
  currentParams: null,
};

class SwordSoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private voice: Voice | null = null;
  private currentEnd = 0;
  private token = 0;
  private state: EngineState = INITIAL_STATE;
  private listeners = new Set<() => void>();

  /** React useSyncExternalStore 订阅接口 */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): EngineState => this.state;

  getAnalyser = (): AnalyserNode | null => this.analyser;

  getContext = (): AudioContext | null => this.ctx;

  /** 当前声部自然结束的 AudioContext 时间；画面据此判断何时静止 */
  getCurrentEnd = (): number => this.currentEnd;

  private setState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** 开声：必须由用户手势触发 */
  async enable(): Promise<void> {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.state.muted ? 0 : 1;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', () => {
        // 被系统挂起（如切后台）视为未开声，画面随之静止
        if (this.ctx && this.ctx.state !== 'running' && this.state.enabled) {
          this.setState({ enabled: false });
        }
      });
    }
    try {
      await this.ctx.resume();
    } catch {
      /* 忽略：稍后由用户再次点击 */
    }
    if (this.ctx.state === 'running') this.setState({ enabled: true });
  }

  setMuted(muted: boolean): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    this.setState({ muted });
  }

  /** 播放一把剑的剑鸣；未开声时转为「开声按钮」提示 */
  play(sword: Sword): void {
    if (!this.state.enabled || !this.ctx || this.ctx.state !== 'running' || !this.master) {
      this.setState({ enableNudge: this.state.enableNudge + 1 });
      return;
    }
    const p = deriveResonanceParams(sword.attributes, sword.id, sword.name);
    const t = this.ctx.currentTime + 0.02;
    const token = ++this.token;

    // 先淡出上一段，再停止 —— 同一时刻只有一段剑鸣
    if (this.voice) {
      const old = this.voice;
      old.fade.gain.cancelScheduledValues(t);
      old.fade.gain.setValueAtTime(old.fade.gain.value, t);
      old.fade.gain.setTargetAtTime(0, t, 0.035);
      old.stopAt(t + 0.25);
    }

    const voice = this.buildVoice(p, t);
    if (token !== this.token) {
      voice.stopAt(t); // 竞态兜底：构建期间又有新点击
      return;
    }
    this.voice = voice;
    this.currentEnd = t + p.duration + 0.1;
    this.setState({
      playSeq: this.state.playSeq + 1,
      currentSwordId: sword.id,
      currentSwordName: sword.name,
      currentParams: p,
    });
  }

  /**
   * 构建一段剑鸣：
   *  - harmonics 个正弦分音（频率/增益来自 params.partials，锋利决定数量与亮度）；
   *  - 每个分音挂 LFO → detune（柔韧决定颤音幅度，单位音分）；
   *  - 每个分音增益走 setValueCurveAtTime（工艺决定包络采样点数）；
   *  - 叠加一段种子噪声经带通的「出鞘擦音」；
   *  - 全部汇入低通滤波（锋利决定截止）→ 声部淡出增益 → 主增益 → AnalyserNode。
   */
  private buildVoice(p: ResonanceParams, t: number): Voice {
    const ctx = this.ctx as AudioContext;
    const fade = ctx.createGain();
    fade.gain.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.brightness;
    filter.Q.value = 0.7;
    filter.connect(fade);
    fade.connect(this.master as GainNode);

    const nodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
    const curve = envelopeCurve(p.envPoints);
    const stopT = t + p.attack + p.decay + 0.05;

    for (const partial of p.partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = partial.freq;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = p.vibratoRate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = p.vibratoDepth; // 音分
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(partial.gain, t + p.attack);
      const scaled = Float32Array.from(curve, (v) => v * partial.gain);
      g.gain.setValueCurveAtTime(scaled, t + p.attack, p.decay);

      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      lfo.start(t);
      osc.stop(stopT);
      lfo.stop(stopT);
      nodes.push(osc, lfo);
    }

    // 出鞘擦音：确定性种子噪声 → 带通 → 短包络
    const noiseLen = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    buf.getChannelData(0).set(makeNoiseBuffer(p.noiseSeed, noiseLen));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(p.brightness * 2.2, 9000);
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(filter);
    src.start(t);
    src.stop(t + 0.4);
    nodes.push(src);

    return {
      fade,
      stopAt(when: number) {
        for (const n of nodes) {
          try {
            n.stop(when);
          } catch {
            /* 已停止 */
          }
        }
      },
    };
  }
}

export const soundEngine = new SwordSoundEngine();

/* ---------------- 可断言数据接口：window.JianMing ---------------- */

export interface JianMingApi {
  /** 由剑 id（或剑对象）读出发声参数：{ baseFreq, duration, harmonics, ... }，确定无随机 */
  params: (query: string | Sword) => ResonanceParams;
  /** 断言自检：确定性、量程、属性→参数单调性、包络与噪声确定性 */
  selfTest: () => SelfTestReport;
  /** 引擎状态快照：开声 / 静音 / 当前剑 / 当前参数 */
  state: () => EngineState;
  version: string;
}

declare global {
  interface Window {
    JianMing?: JianMingApi;
  }
}

if (typeof window !== 'undefined') {
  window.JianMing = {
    params: (query) => paramsFor(query),
    selfTest,
    state: () => soundEngine.getState(),
    version: '1.0.0',
  };
}
