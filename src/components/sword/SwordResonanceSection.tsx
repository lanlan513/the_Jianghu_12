import { useMemo } from 'react';
import { Waves, Volume2, VolumeX, Play, Square } from 'lucide-react';
import type { Sword } from '@/types';
import { deriveResonanceParams } from '@/lib/swordResonance';
import { useResonanceStore } from '@/stores/resonanceStore';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { cn } from '@/lib/utils';

/**
 * 剑鸣段落 —— 名剑详情页。
 *
 * 参数全部由属性推导、不含随机：
 * 锋利 → 明亮度与泛音数量；硬度 → 基频与衰减；
 * 韧性 → 颤音幅度；工艺 → 包络细腻程度。
 * 读数带 data-testid，可直接断言频率、时长与泛音数量。
 */
export default function SwordResonanceSection({ sword }: { sword: Sword }) {
  const params = useMemo(() => deriveResonanceParams(sword.attributes), [sword.attributes]);
  const audioEnabled = useResonanceStore((s) => s.audioEnabled);
  const muted = useResonanceStore((s) => s.muted);
  const playing = useResonanceStore((s) => s.playing);
  const currentSwordId = useResonanceStore((s) => s.swordId);
  const toggleMute = useResonanceStore((s) => s.toggleMute);
  const ringSword = useResonanceStore((s) => s.ringSword);
  const stop = useResonanceStore((s) => s.stop);
  const reducedMotion = usePrefersReducedMotion();

  const isCurrent = currentSwordId === sword.id;
  const isRingingThis = isCurrent && playing;

  const readings = [
    { label: '基频', value: `${params.baseFrequency} Hz`, testid: 'resonance-frequency' },
    { label: '时长', value: `${params.duration} s`, testid: 'resonance-duration' },
    { label: '泛音数量', value: `${params.harmonicCount}`, testid: 'resonance-harmonics' },
    { label: '明亮度', value: `${params.brightnessHz} Hz`, testid: 'resonance-brightness' },
    { label: '颤音深度', value: `${params.vibratoDepthHz} Hz`, testid: 'resonance-vibrato' },
    { label: '包络段数', value: `${params.envelopeSegments}`, testid: 'resonance-envelope' },
  ];

  return (
    <section
      className="animate-fade-in-up"
      style={{ animationDelay: '0.35s', animationFillMode: 'forwards', opacity: 0 }}
      data-testid="sword-resonance-section"
    >
      <div className="flex items-center gap-3 mb-6">
        <Waves className="w-6 h-6 text-cinnabar-600" />
        <h2 className="font-brush text-3xl text-ink-900">剑鸣</h2>
      </div>

      <div className="ink-card p-6">
        <p className="font-song text-ink-600 leading-loose mb-6">
          此剑之声，不取录音，全由振荡与噪声现场合成。锋利定音色之明暗与泛音之数，
          硬度定基频与衰减之速，韧性定颤音之幅，工艺定包络之细腻。
          同一把剑，声声如一。
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {readings.map((item) => (
            <div key={item.label} className="bg-ink-50 border border-ink-200 px-4 py-3">
              <div className="font-song text-xs text-ink-500 mb-1">{item.label}</div>
              <div
                className="font-brush text-xl text-ink-900"
                data-testid={item.testid}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!audioEnabled ? (
            <button
              type="button"
              onClick={() => void ringSword(sword)}
              data-testid="resonance-enable"
              className="inline-flex items-center gap-2 px-6 py-3 bg-cinnabar-600 text-ink-100 font-song hover:bg-cinnabar-700 transition-colors"
            >
              <Volume2 className="w-4 h-4" />
              开声 · 听剑鸣
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void ringSword(sword)}
                data-testid="resonance-ring"
                className={cn(
                  'inline-flex items-center gap-2 px-6 py-3 font-song transition-colors',
                  isRingingThis
                    ? 'bg-ink-800 text-ink-100 hover:bg-ink-900'
                    : 'bg-cinnabar-600 text-ink-100 hover:bg-cinnabar-700',
                )}
              >
                <Play className="w-4 h-4" />
                {isRingingThis ? '再鸣一次' : '听其剑鸣'}
              </button>
              <button
                type="button"
                onClick={toggleMute}
                data-testid="resonance-mute"
                className="inline-flex items-center gap-2 px-4 py-3 bg-ink-50 border border-ink-200 text-ink-700 font-song hover:border-cinnabar-500 hover:text-cinnabar-600 transition-colors"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                {muted ? '取消静音' : '静音'}
              </button>
              {isRingingThis && (
                <button
                  type="button"
                  onClick={stop}
                  data-testid="resonance-stop-section"
                  className="inline-flex items-center gap-2 px-4 py-3 bg-ink-50 border border-ink-200 text-ink-700 font-song hover:border-cinnabar-500 hover:text-cinnabar-600 transition-colors"
                >
                  <Square className="w-4 h-4" />
                  止
                </button>
              )}
            </>
          )}
        </div>

        {(reducedMotion || muted) && (
          <p className="mt-4 font-song text-xs text-ink-500">
            {reducedMotion ? '已开启「减少动态效果」' : '已静音'}
            ，下方共鸣台以静态波形呈现，画面保持静止。
          </p>
        )}
      </div>
    </section>
  );
}
