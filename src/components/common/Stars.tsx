import { cn } from '../../lib/cn';

/** 用实心/空心星表达重要度：观察面板里一眼可读 */
export function Stars({ value, max = 5, className }: { value: number; max?: number; className?: string }) {
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <span className={cn('inline-flex items-center gap-[1px] text-[11px] leading-none', className)} aria-label={`重要度 ${filled} 星`}>
      {Array.from({ length: max }, (_, index) => (
        <span key={index} className={index < filled ? 'text-amber-500' : 'text-ink-100/50'}>
          ★
        </span>
      ))}
    </span>
  );
}
