/**
 * 剑鸣引擎逻辑测试（Mock Web Audio，真实导入 src/audio/soundEngine.ts）：
 *  npx tsx scripts/engine-test.mjs
 *
 * 用一个记录所有调度调用的假 AudioContext，断言：
 *  - 未开声不创建 AudioContext、不出声（浏览器自动播放策略）；
 *  - 音频图为主增益 → AnalyserNode → 输出；
 *  - 连续快速播放 20 次：每段旧声部都被淡出（setTargetAtTime(0)）并在 0.25s 内停止，
 *    全部振荡器都有停止调度 —— 不会叠加播放、不会硬切爆音；
 *  - 包络采样点数、颤音幅度、噪声纹理均由参数确定；
 *  - 静音开关作用于主增益。
 */

let failures = 0;
function assert(cond, name, detail = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/* ---------------- Mock Web Audio ---------------- */

class FakeParam {
  constructor() {
    this.value = 0;
    this.calls = [];
  }
  setValueAtTime(v, t) { this.calls.push(['setValueAtTime', v, t]); this.value = v; }
  linearRampToValueAtTime(v, t) { this.calls.push(['linearRampToValueAtTime', v, t]); this.value = v; }
  exponentialRampToValueAtTime(v, t) { this.calls.push(['exponentialRampToValueAtTime', v, t]); }
  setTargetAtTime(v, t, tc) { this.calls.push(['setTargetAtTime', v, t, tc]); this.value = v; }
  cancelScheduledValues(t) { this.calls.push(['cancelScheduledValues', t]); }
  setValueCurveAtTime(curve, t, d) { this.calls.push(['setValueCurveAtTime', curve.length, t, d]); }
}

class FakeNode {
  constructor() { this.connections = []; }
  connect(n) { this.connections.push(n); return n; }
  disconnect() { this.connections.length = 0; }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.type = '';
    this.frequency = new FakeParam();
    this.detune = new FakeParam();
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(t) { this.startedAt = t; }
  stop(t = 0) { this.stoppedAt = t; }
}

class FakeBufferSource extends FakeNode {
  constructor() {
    super();
    this.buffer = null;
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(t) { this.startedAt = t; }
  stop(t = 0) { this.stoppedAt = t; }
}

class FakeGain extends FakeNode {
  constructor() { super(); this.gain = new FakeParam(); }
}

class FakeFilter extends FakeNode {
  constructor() { super(); this.type = ''; this.frequency = new FakeParam(); this.Q = new FakeParam(); }
}

class FakeAnalyser extends FakeNode {
  constructor() { super(); this.fftSize = 0; this.smoothingTimeConstant = 0; }
}

class FakeBuffer {
  constructor(len) { this.data = new Float32Array(len); }
  getChannelData() { return this.data; }
}

class FakeAudioContext {
  static instances = [];
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'suspended';
    this.destination = new FakeNode();
    this.gains = [];
    this.oscs = [];
    this.filters = [];
    this.sources = [];
    this.analysers = [];
    this.buffers = [];
    FakeAudioContext.instances.push(this);
  }
  createGain() { const n = new FakeGain(); this.gains.push(n); return n; }
  createOscillator() { const n = new FakeOscillator(); this.oscs.push(n); return n; }
  createBiquadFilter() { const n = new FakeFilter(); this.filters.push(n); return n; }
  createBufferSource() { const n = new FakeBufferSource(); this.sources.push(n); return n; }
  createAnalyser() { const n = new FakeAnalyser(); this.analysers.push(n); return n; }
  createBuffer(ch, len) { const b = new FakeBuffer(len); this.buffers.push(b); return b; }
  addEventListener() {}
  async resume() { this.state = 'running'; }
}

/* ---------------- 装配 ---------------- */

globalThis.window = { AudioContext: FakeAudioContext };

const { soundEngine } = await import('../src/audio/soundEngine.ts');
const core = await import('../src/audio/jianmingCore.ts');

const sword1 = { id: '1', name: '轩辕剑', attributes: { sharpness: 98, hardness: 95, flexibility: 75, craftsmanship: 100 } };
const sword2 = { id: '2', name: '湛泸剑', attributes: { sharpness: 92, hardness: 88, flexibility: 90, craftsmanship: 96 } };

/* 1. 自动播放策略：未开声不创建 AudioContext、不出声 */
soundEngine.play(sword1);
assert(FakeAudioContext.instances.length === 0, '未开声不创建 AudioContext');
assert(soundEngine.getState().enableNudge === 1, '未开声点剑 → 开声提示 +1');
assert(soundEngine.getState().playSeq === 0, '未开声点剑不播放');

/* 2. 开声：音频图 master → analyser → destination */
await soundEngine.enable();
assert(soundEngine.getState().enabled === true, '开声后 enabled=true');
const ctx = FakeAudioContext.instances[0];
const analyser = ctx.analysers[0];
const master = ctx.gains.find((g) => g.connections.includes(analyser));
assert(!!master, '主增益接入 AnalyserNode');
assert(analyser.connections.includes(ctx.destination), 'AnalyserNode 接入输出');
assert(analyser.fftSize === 2048, 'AnalyserNode fftSize=2048（画面真实频谱来源）');

/* 3. 连续快速播放 20 次（currentTime 冻结，模拟极快连点） */
for (let i = 0; i < 20; i++) soundEngine.play(i % 2 ? sword2 : sword1);
const st = soundEngine.getState();
assert(st.playSeq === 20, '20 次播放 → playSeq=20', `playSeq=${st.playSeq}`);
assert(st.currentSwordId === '2', '当前声部为最后点击的剑');

const fades = ctx.gains.filter((g) => g.connections.includes(master));
assert(fades.length === 20, '每次播放恰好一个声部', `${fades.length} 段`);

const fadedOut = fades.slice(0, 19).every((f) =>
  f.gain.calls.some((c) => c[0] === 'cancelScheduledValues') &&
  f.gain.calls.some((c) => c[0] === 'setTargetAtTime' && c[1] === 0 && c[3] === 0.035),
);
assert(fadedOut, '前 19 段旧声部均被淡出（setTargetAtTime → 0）');

const allStopped = ctx.oscs.every((o) => o.stoppedAt !== null) &&
  ctx.sources.every((s) => s.stoppedAt !== null);
assert(allStopped, '全部振荡器与噪声源都有停止调度（无泄漏、不叠加）');

// 旧声部被快速切断（t+0.25s 内停止），最后一段自然衰减
const p1 = core.deriveResonanceParams(sword1.attributes, '1', '轩辕剑');
const p2 = core.deriveResonanceParams(sword2.attributes, '2', '湛泸剑');
const oscsPerVoice = [];
{
  let idx = 0;
  for (let v = 0; v < 20; v++) {
    const h = v % 2 ? p2.harmonics : p1.harmonics;
    oscsPerVoice.push(ctx.oscs.slice(idx, idx + h * 2));
    idx += h * 2;
  }
}
const oldCut = oscsPerVoice.slice(0, 19).every((voice) =>
  voice.every((o) => o.stoppedAt <= 0.02 + 0.25 + 1e-9),
);
assert(oldCut, '旧声部均在切换后 0.25s 内停止（淡出窗口）');
const lastNatural = oscsPerVoice[19].every((o) => o.stoppedAt > 1.0);
assert(lastNatural, '最后一段按自然包络衰减（不被误停）');

// 新声部从 0 起音（防爆音）：每个分音增益 setValueAtTime(0) 后线性上升到峰值；
// 每段另有 1 个噪声增益（0.5 起、指数衰减），不计入分音
const envGains = ctx.gains.filter((g) => !g.connections.includes(master) && g.connections.some((n) => n instanceof FakeFilter));
const partialGains = envGains.filter((g) => {
  const sv = g.gain.calls.find((c) => c[0] === 'setValueAtTime');
  const lr = g.gain.calls.find((c) => c[0] === 'linearRampToValueAtTime');
  return sv && sv[1] === 0 && lr && lr[1] > 0;
});
const noiseGains = envGains.filter((g) => g.gain.calls.some((c) => c[0] === 'exponentialRampToValueAtTime'));
assert(partialGains.length === 10 * p1.harmonics + 10 * p2.harmonics,
  '每个分音均从 0 起音（线性上升，无硬切爆音）', `${partialGains.length} 个分音`);
assert(noiseGains.length === 20, '每段各含 1 个噪声擦音增益', `${noiseGains.length} 个`);

/* 4. 参数确定性落到音频图 */
const curveCall = envGains[0].gain.calls.find((c) => c[0] === 'setValueCurveAtTime');
assert(curveCall && curveCall[1] === p1.envPoints + 1, '包络曲线采样点数 = envPoints+1（工艺决定细腻度）', `${curveCall?.[1]} 点`);

const lfoGain = ctx.gains.find((g) => g.connections.some((n) => n instanceof FakeParam));
assert(lfoGain && Math.abs(lfoGain.gain.value - p1.vibratoDepth) < 1e-9,
  '颤音 LFO 深度 = vibratoDepth 音分（柔韧决定）', `±${lfoGain?.gain.value}`);

const lowpass = ctx.filters.find((f) => f.type === 'lowpass');
assert(lowpass && lowpass.frequency.value === p1.brightness, '低通截止 = brightness（锋利决定明亮度）', `${lowpass?.frequency.value} Hz`);

const carrier = ctx.oscs.find((o) => o.type === 'sine' && o.frequency.value === p1.partials[0].freq);
assert(!!carrier, '基频分音频率 = partials[0].freq（硬度决定）', `${p1.partials[0].freq} Hz`);

/* 5. 噪声纹理确定性：同剑一致、异剑不同 */
const bufs1 = ctx.buffers.filter((_, i) => i % 2 === 0);
const bufs2 = ctx.buffers.filter((_, i) => i % 2 === 1);
assert(bufs1.length > 1 && bufs1.every((b) => b.data.every((v, i) => v === bufs1[0].data[i])),
  '同一把剑多次播放噪声纹理一致');
assert(bufs1[0].data.some((v, i) => v !== bufs2[0].data[i]), '不同剑噪声纹理不同');

/* 6. 静音开关作用于主增益 */
soundEngine.setMuted(true);
assert(master.gain.calls.some((c) => c[0] === 'setTargetAtTime' && c[1] === 0), '静音 → 主增益 → 0');
assert(soundEngine.getState().muted === true, '静音状态可读');
soundEngine.setMuted(false);
assert(master.gain.calls.some((c) => c[0] === 'setTargetAtTime' && c[1] === 1), '取消静音 → 主增益 → 1');

/* 7. 挂起（暂停）时拒绝播放 */
ctx.state = 'suspended';
const seqBefore = soundEngine.getState().playSeq;
soundEngine.play(sword1);
assert(soundEngine.getState().playSeq === seqBefore, 'AudioContext 挂起时不叠加播放');
ctx.state = 'running';

/* 8. 可断言数据接口 window.JianMing */
const JM = globalThis.window.JianMing;
assert(typeof JM?.params === 'function' && typeof JM?.selfTest === 'function' && typeof JM?.state === 'function',
  'window.JianMing 暴露 params/selfTest/state');
const jp = JM.params(sword1);
assert(jp.baseFreq === p1.baseFreq && jp.duration === p1.duration && jp.harmonics === p1.harmonics,
  'JianMing.params 读出频率/时长/泛音数', `${jp.baseFreq}Hz ${jp.duration}s ${jp.harmonics}泛音`);
assert(JM.selfTest().pass, 'JianMing.selfTest 通过');
assert(JM.state().playSeq === soundEngine.getState().playSeq, 'JianMing.state 与引擎一致');
let threw = false;
try { JM.params('not-registered'); } catch { threw = true; }
assert(threw, '未收录的剑 id 抛出明确错误');

console.log(failures === 0 ? '\n引擎逻辑测试全部通过' : `\n引擎逻辑测试 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
