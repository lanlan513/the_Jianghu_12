/**
 * 剑鸣 · 参数核心（纯函数，无 DOM / 无 WebAudio 依赖，可在 Node 下断言自测）
 *
 * 设计约束：
 *  - 同一把剑的发声参数完全由四项属性（锋利/硬度/柔韧/工艺）推导，不含任何随机；
 *  - 噪声纹理使用以剑 id 为种子的确定性 PRNG，同一把剑每次完全一致；
 *  - 提供可断言接口：deriveResonanceParams(...) => { baseFreq, duration, harmonics, ... }。
 *
 * 属性 → 声音映射：
 *  - 锋利 sharpness     → 泛音数量 harmonics、滤波截止 brightness、泛音衰减斜率 rolloff
 *  - 硬度 hardness      → 基频 baseFreq、衰减时长 decay（越硬越高、越短促）
 *  - 柔韧 flexibility   → 颤音幅度 vibratoDepth（音分）与颤音速率 vibratoRate
 *  - 工艺 craftsmanship → 包络细腻程度 envPoints（包络曲线采样点数）与起音 attack
 */
import type { Sword } from '../types';

export interface SwordAttributes {
  sharpness: number;
  hardness: number;
  flexibility: number;
  craftsmanship: number;
}

export interface PartialSpec {
  /** 该泛音的频率 Hz */
  freq: number;
  /** 该泛音的相对增益 0..1 */
  gain: number;
}

export interface ResonanceParams {
  swordId: string;
  swordName: string;
  /** 基频 Hz（硬度决定） */
  baseFreq: number;
  /** 泛音数量（锋利决定） */
  harmonics: number;
  /** 低通滤波截止 Hz（锋利决定，越高越明亮） */
  brightness: number;
  /** 泛音增益衰减斜率（锋利决定，越小越亮） */
  rolloff: number;
  /** 起音时长 s（工艺决定，越精越利落） */
  attack: number;
  /** 衰减时长 s（硬度决定，越硬越短） */
  decay: number;
  /** 总时长 s = attack + decay */
  duration: number;
  /** 颤音幅度，音分（柔韧决定） */
  vibratoDepth: number;
  /** 颤音速率 Hz（柔韧决定） */
  vibratoRate: number;
  /** 包络曲线采样点数（工艺决定，越多越细腻） */
  envPoints: number;
  /** 噪声纹理种子（由剑 id 确定） */
  noiseSeed: number;
  /** 各泛音的频率与增益，长度 === harmonics */
  partials: PartialSpec[];
}

export interface SelfTestItem {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestReport {
  pass: boolean;
  results: SelfTestItem[];
}

function round(n: number, p: number): number {
  const k = Math.pow(10, p);
  return Math.round(n * k) / k;
}

/** FNV-1a：由剑 id 得到确定性种子 */
export function hash(str: string): number {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 确定性 PRNG（mulberry32）：同种子同序列 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 剑的“出鞘擦音”噪声纹理：完全由种子决定，同一把剑每次一致 */
export function makeNoiseBuffer(seed: number, length: number): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rnd() * 2 - 1;
  return out;
}

/**
 * 包络曲线：envPoints 越多采样越细 —— 工艺直接决定包络的细腻程度。
 * 归一化到 [0,1]，峰值在 t=0，末端趋近于 0。
 */
export function envelopeCurve(envPoints: number): Float32Array {
  const n = Math.max(2, envPoints | 0);
  const curve = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) curve[i] = Math.exp(-(i / n) * 6.5);
  return curve;
}

/** 由属性推导一把剑的全部发声参数（纯函数、无随机） */
export function deriveResonanceParams(
  attrs: SwordAttributes,
  swordId = 'anonymous',
  swordName = '无名剑',
): ResonanceParams {
  const sh = attrs.sharpness;
  const hd = attrs.hardness;
  const fx = attrs.flexibility;
  const cf = attrs.craftsmanship;

  const baseFreq = round(160 + hd * 4.2, 2); // 硬度 → 基频
  const harmonics = 3 + Math.round(sh / 9); // 锋利 → 泛音数量
  const brightness = round(700 + sh * 55, 0); // 锋利 → 明亮度（低通截止 Hz）
  const rolloff = round(1.6 - sh / 120, 3); // 锋利 → 泛音衰减斜率
  const attack = round(0.004 + (100 - cf) * 0.00035, 4); // 工艺 → 起音
  const decay = round(5.0 - hd * 0.035, 3); // 硬度 → 衰减
  const envPoints = 6 + Math.round(cf / 8); // 工艺 → 包络采样点数

  const partials: PartialSpec[] = [];
  for (let i = 0; i < harmonics; i++) {
    const n = i + 1;
    partials.push({
      // 轻微失谐的金属泛音列，频率与增益全部确定
      freq: round(baseFreq * n * Math.sqrt(1 + 0.0009 * i * i), 2),
      gain: round(1 / Math.pow(n, rolloff), 4),
    });
  }

  return {
    swordId,
    swordName,
    baseFreq,
    harmonics,
    brightness,
    rolloff,
    attack,
    decay,
    duration: round(attack + decay, 3),
    vibratoDepth: round(fx * 0.55, 2), // 柔韧 → 颤音幅度（音分）
    vibratoRate: round(4.2 + fx * 0.02, 2), // 柔韧 → 颤音速率 Hz
    envPoints,
    noiseSeed: hash(swordId),
    partials,
  };
}

/* ---------------- 名剑注册表：支撑 window.JianMing.params(id) ---------------- */

const registry = new Map<string, Sword>();

export function registerSwords(list: Sword[]): void {
  for (const s of list) registry.set(s.id, s);
}

export function paramsFor(query: string | Sword): ResonanceParams {
  const sword = typeof query === 'string' ? registry.get(query) : query;
  if (!sword) {
    throw new Error(
      `JianMing: 未收录的剑「${query}」。剑数据由 API 注册；也可直接传入剑对象。`,
    );
  }
  return deriveResonanceParams(sword.attributes, sword.id, sword.name);
}

/* ---------------- 可断言自检 ---------------- */

export function selfTest(): SelfTestReport {
  const results: SelfTestItem[] = [];
  const check = (name: string, ok: boolean, detail = '') =>
    results.push({ name, ok: !!ok, detail });

  const base: SwordAttributes = { sharpness: 80, hardness: 80, flexibility: 80, craftsmanship: 80 };
  const mk = (over: Partial<SwordAttributes>) => ({ ...base, ...over });

  // 1. 确定性：同一组属性推导两次必须完全一致
  const a = deriveResonanceParams(base, 't', '测试');
  const b = deriveResonanceParams(base, 't', '测试');
  check('确定性：同参数两次推导一致', JSON.stringify(a) === JSON.stringify(b));

  // 2. 参数合法性与量程
  const samples = [
    mk({ sharpness: 60, hardness: 60, flexibility: 60, craftsmanship: 60 }),
    base,
    mk({ sharpness: 100, hardness: 100, flexibility: 100, craftsmanship: 100 }),
  ].map((attrs, i) => deriveResonanceParams(attrs, `s${i}`));
  const allValid = samples.every((p) => {
    const finite = [p.baseFreq, p.duration, p.attack, p.decay, p.vibratoDepth, p.brightness].every(
      Number.isFinite,
    );
    const ranges =
      p.baseFreq >= 100 &&
      p.baseFreq <= 1000 &&
      Number.isInteger(p.harmonics) &&
      p.harmonics >= 3 &&
      p.harmonics <= 16 &&
      p.duration > 0 &&
      p.partials.length === p.harmonics &&
      p.partials.every((pt) => pt.freq > 0 && pt.gain > 0 && pt.gain <= 1);
    return finite && ranges;
  });
  check('参数有限且在量程内', allValid);

  // 3. 单调性：属性 → 参数方向正确
  const hdLo = deriveResonanceParams(mk({ hardness: 60 }));
  const hdHi = deriveResonanceParams(mk({ hardness: 100 }));
  check('硬度↑ → 基频↑', hdHi.baseFreq > hdLo.baseFreq, `${hdLo.baseFreq} → ${hdHi.baseFreq}`);
  check('硬度↑ → 衰减↓', hdHi.decay < hdLo.decay, `${hdLo.decay} → ${hdHi.decay}`);

  const shLo = deriveResonanceParams(mk({ sharpness: 60 }));
  const shHi = deriveResonanceParams(mk({ sharpness: 100 }));
  check('锋利↑ → 泛音数↑', shHi.harmonics > shLo.harmonics, `${shLo.harmonics} → ${shHi.harmonics}`);
  check('锋利↑ → 明亮度↑', shHi.brightness > shLo.brightness, `${shLo.brightness} → ${shHi.brightness}`);

  const fxLo = deriveResonanceParams(mk({ flexibility: 50 }));
  const fxHi = deriveResonanceParams(mk({ flexibility: 100 }));
  check(
    '柔韧↑ → 颤音幅度↑',
    fxHi.vibratoDepth > fxLo.vibratoDepth,
    `${fxLo.vibratoDepth} → ${fxHi.vibratoDepth}`,
  );

  const cfLo = deriveResonanceParams(mk({ craftsmanship: 60 }));
  const cfHi = deriveResonanceParams(mk({ craftsmanship: 100 }));
  check('工艺↑ → 包络更细腻', cfHi.envPoints > cfLo.envPoints, `${cfLo.envPoints} → ${cfHi.envPoints}`);
  check('工艺↑ → 起音更利落', cfHi.attack <= cfLo.attack, `${cfLo.attack} → ${cfHi.attack}`);

  // 4. 包络曲线：点数正确、单调不增、末端趋零
  const env = envelopeCurve(deriveResonanceParams(base).envPoints);
  let mono = true;
  for (let i = 1; i < env.length; i++) if (env[i] > env[i - 1]) mono = false;
  check('包络点数 = envPoints + 1', env.length === deriveResonanceParams(base).envPoints + 1);
  check('包络单调衰减且末端趋零', mono && env[0] === 1 && env[env.length - 1] < 0.01);

  // 5. 噪声纹理确定性：同种子同序列，异种子异序列
  const n1 = makeNoiseBuffer(hash('sword-a'), 64);
  const n2 = makeNoiseBuffer(hash('sword-a'), 64);
  const n3 = makeNoiseBuffer(hash('sword-b'), 64);
  check('噪声确定性（同剑一致）', n1.every((v, i) => v === n2[i]));
  check('噪声确定性（异剑不同）', n1.some((v, i) => v !== n3[i]));

  return { pass: results.every((r) => r.ok), results };
}
