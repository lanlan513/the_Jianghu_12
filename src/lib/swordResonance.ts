import type { Sword } from '../types';

/**
 * 剑鸣参数推导 —— 纯函数、确定性、不含任何随机。
 *
 * 属性到声音的映射：
 * - 锋利度 sharpness     → 音色明亮度（低通截止频率）与泛音数量
 * - 硬度 hardness        → 基频与衰减快慢（时长）
 * - 韧性 flexibility     → 颤音幅度（深度与速率）
 * - 工艺 craftsmanship   → 包络细腻程度（起音时间与包络段数）
 *
 * 同一把剑（同一组属性）每次推导出的参数完全一致，
 * 可通过 deriveResonanceParams 直接断言频率、时长与泛音数量。
 */

export interface SwordAttributes {
  sharpness: number;
  hardness: number;
  flexibility: number;
  craftsmanship: number;
}

export interface ResonancePartial {
  /** 分音频率 Hz（含金属失谐） */
  frequency: number;
  /** 相对振幅 0..1 */
  gain: number;
}

export interface ResonanceParams {
  /** 基频 Hz —— 由硬度决定 */
  baseFrequency: number;
  /** 总时长 秒 —— 由硬度决定（越硬衰减越快） */
  duration: number;
  /** 泛音列总数（含基频） —— 由锋利度决定 */
  harmonicCount: number;
  /** 明亮度（低通截止频率 Hz） —— 由锋利度决定 */
  brightnessHz: number;
  /** 颤音深度 Hz —— 由韧性决定 */
  vibratoDepthHz: number;
  /** 颤音速率 Hz —— 由韧性决定 */
  vibratoRateHz: number;
  /** 起音时间 秒 —— 由工艺决定 */
  attackTime: number;
  /** 包络段数（越多越细腻） —— 由工艺决定 */
  envelopeSegments: number;
  /** 金属失谐系数 —— 由硬度决定 */
  inharmonicity: number;
  /** 噪声种子 —— 由属性哈希推导，确定性 */
  noiseSeed: number;
  /** 出鞘金属擦片（噪声瞬态）参数 */
  noiseBurst: {
    centerHz: number;
    duration: number;
    gain: number;
  };
  /** 泛音列（第 1 项为基频），长度 === harmonicCount */
  partials: ResonancePartial[];
}

const round = (value: number, digits = 2): number => {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
};

const clampAttribute = (value: number): number =>
  Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

/** 由四项属性推导确定性种子（供噪声发生器使用，非随机） */
function seedFromAttributes(
  sharpness: number,
  hardness: number,
  flexibility: number,
  craftsmanship: number,
): number {
  const q = (v: number) => Math.round(v * 10);
  const mixed =
    (q(sharpness) * 73856093) ^
    (q(hardness) * 19349663) ^
    (q(flexibility) * 83492791) ^
    (q(craftsmanship) * 2654435761);
  return mixed >>> 0;
}

export function deriveResonanceParams(attributes: SwordAttributes): ResonanceParams {
  const sharpness = clampAttribute(attributes.sharpness);
  const hardness = clampAttribute(attributes.hardness);
  const flexibility = clampAttribute(attributes.flexibility);
  const craftsmanship = clampAttribute(attributes.craftsmanship);

  // 硬度 → 基频 110–390 Hz；衰减时长 4.2s → 1.4s（越硬越短促）
  const baseFrequency = round(110 + hardness * 2.8);
  const duration = round(4.2 - hardness * 0.028);
  const inharmonicity = round((hardness / 100) * 0.0012, 6);

  // 锋利度 → 泛音数量 2–12、明亮度 900–8400 Hz、谱滚降更缓（更亮）
  const harmonicCount = 2 + Math.round(sharpness / 10);
  const brightnessHz = Math.round(900 + sharpness * 75);
  const rolloff = 1.7 - (sharpness / 100) * 0.9;

  // 韧性 → 颤音深度（基频的 0–3%）与速率 3.5–8 Hz
  const vibratoDepthHz = round(baseFrequency * 0.03 * (flexibility / 100));
  const vibratoRateHz = round(3.5 + flexibility * 0.045);

  // 工艺 → 起音 50ms → 5ms（越精越干净）、包络段数 3–12（越多越细腻）
  const attackTime = round(0.005 + (1 - craftsmanship / 100) * 0.045, 3);
  const envelopeSegments = 3 + Math.round((craftsmanship / 100) * 9);

  const partials: ResonancePartial[] = [];
  for (let n = 1; n <= harmonicCount; n += 1) {
    partials.push({
      // 金属棒的失谐泛音列：f_n = n·f0·√(1 + B·n²)
      frequency: round(n * baseFrequency * Math.sqrt(1 + inharmonicity * n * n)),
      gain: round(1 / Math.pow(n, rolloff), 4),
    });
  }

  const noiseSeed = seedFromAttributes(sharpness, hardness, flexibility, craftsmanship);
  const noiseBurst = {
    centerHz: Math.round(1600 + sharpness * 40),
    duration: round(0.22 - (hardness / 100) * 0.14),
    gain: round(0.1 + (sharpness / 100) * 0.18, 3),
  };

  return {
    baseFrequency,
    duration,
    harmonicCount,
    brightnessHz,
    vibratoDepthHz,
    vibratoRateHz,
    attackTime,
    envelopeSegments,
    inharmonicity,
    noiseSeed,
    noiseBurst,
    partials,
  };
}

/** 从名剑实体推导剑鸣参数 */
export function deriveSwordResonance(sword: Pick<Sword, 'attributes'>): ResonanceParams {
  return deriveResonanceParams(sword.attributes);
}
