/**
 * 剑鸣触发按钮：点任意一把剑，现场合成它的声音。
 * 用在 Link 包裹的卡片内，故以 role="button" 实现并阻止冒泡/默认跳转。
 */
import { useSyncExternalStore } from 'react';
import { AudioLines } from 'lucide-react';
import type { Sword } from '../../types';
import { soundEngine } from '@/audio/soundEngine';
import { cn } from '@/lib/utils';

interface SwordResonanceButtonProps {
  sword: Sword;
  className?: string;
}

export default function SwordResonanceButton({ sword, className }: SwordResonanceButtonProps) {
  const state = useSyncExternalStore(soundEngine.subscribe, soundEngine.getState);
  const isCurrent =
    state.enabled && !state.muted && state.currentSwordId === sword.id && state.playSeq > 0;

  const trigger = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    soundEngine.play(sword);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`听${sword.name}剑鸣`}
      title={`剑鸣 · ${sword.name}`}
      onClick={trigger}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') trigger(e);
      }}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 text-xs font-song cursor-pointer select-none',
        'bg-ink-900/60 backdrop-blur-sm text-ink-100 hover:bg-ink-900/80 transition-colors',
        className,
      )}
    >
      <AudioLines className={cn('w-3.5 h-3.5', isCurrent && 'animate-pulse text-gold-400')} />
      剑鸣
    </span>
  );
}
