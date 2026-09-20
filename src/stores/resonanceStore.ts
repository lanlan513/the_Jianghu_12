import { create } from 'zustand';
import { deriveResonanceParams, type ResonanceParams } from '@/lib/swordResonance';
import { swordEngine } from '@/lib/swordAudioEngine';
import type { Sword } from '@/types';

/**
 * 剑鸣全局状态 —— 同一时刻全站只允许一段剑鸣。
 *
 * 可断言接口：
 * - useResonanceStore.getState() 随时可读当前参数
 * - window.__SWORD_RESONANCE__ 暴露 derive / engine / getState，
 *   供端到端测试断言频率、时长与泛音数量
 */

interface ResonanceState {
  /** 音频是否已在用户手势中开启（浏览器策略要求） */
  audioEnabled: boolean;
  muted: boolean;
  playing: boolean;
  swordId: string | null;
  swordName: string | null;
  /** 当前（或最近一次）剑鸣的推导参数 */
  params: ResonanceParams | null;
  /** 明确的开声动作 —— 必须由用户手势触发 */
  enableAudio: () => Promise<boolean>;
  toggleMute: () => void;
  /** 为一把剑鸣声；未开声时先开声（调用点本身是用户手势） */
  ringSword: (sword: Pick<Sword, 'id' | 'name' | 'attributes'>) => Promise<void>;
  stop: () => void;
}

export const useResonanceStore = create<ResonanceState>((set, get) => {
  swordEngine.subscribe(() => {
    set({ playing: swordEngine.playing });
  });

  return {
    audioEnabled: false,
    muted: false,
    playing: false,
    swordId: null,
    swordName: null,
    params: null,

    enableAudio: async () => {
      const ok = await swordEngine.enable();
      if (ok) set({ audioEnabled: true });
      return ok;
    },

    toggleMute: () => {
      const muted = !get().muted;
      swordEngine.setMuted(muted);
      set({ muted });
    },

    ringSword: async (sword) => {
      if (!get().audioEnabled) {
        const ok = await swordEngine.enable();
        if (!ok) return;
        set({ audioEnabled: true });
      }
      const params = deriveResonanceParams(sword.attributes);
      swordEngine.play(params);
      set({
        swordId: sword.id,
        swordName: sword.name,
        params,
        playing: true,
      });
    },

    stop: () => {
      swordEngine.stop();
    },
  };
});

/** 供自动化测试断言的数据接口（不含随机，纯属性推导） */
export interface SwordResonanceAssertApi {
  derive: typeof deriveResonanceParams;
  engine: typeof swordEngine;
  getState: () => {
    audioEnabled: boolean;
    muted: boolean;
    playing: boolean;
    swordId: string | null;
    swordName: string | null;
    params: ResonanceParams | null;
  };
}

declare global {
  interface Window {
    __SWORD_RESONANCE__?: SwordResonanceAssertApi;
  }
}

if (typeof window !== 'undefined') {
  window.__SWORD_RESONANCE__ = {
    derive: deriveResonanceParams,
    engine: swordEngine,
    getState: () => {
      const s = useResonanceStore.getState();
      return {
        audioEnabled: s.audioEnabled,
        muted: s.muted,
        playing: s.playing,
        swordId: s.swordId,
        swordName: s.swordName,
        params: s.params,
      };
    },
  };
}
