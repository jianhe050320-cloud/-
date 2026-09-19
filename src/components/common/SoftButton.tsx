import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'paper' | 'ghost' | 'night';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-soft hover:from-amber-300 hover:to-amber-500 disabled:from-ink-100 disabled:to-ink-100 disabled:text-white/80',
  paper:
    'border border-paper-edge/80 bg-paper-warm text-ink-700 shadow-soft hover:bg-white disabled:text-ink-100',
  ghost: 'text-ink-500 hover:bg-ink-900/5 disabled:text-ink-100',
  night: 'border border-paper/20 bg-night-700/70 text-paper/90 hover:bg-night-600/80',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-[36px] px-3 text-[13px] rounded-xl',
  md: 'min-h-[44px] px-4 text-[14px] rounded-2xl',
  lg: 'min-h-[52px] px-6 text-[15px] rounded-[22px]',
};

interface SoftButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
}

/** 带微交互的按钮：按下缩放、悬停辉光，让界面「活着」 */
export function SoftButton({
  variant = 'paper',
  size = 'md',
  block = false,
  className,
  children,
  ...rest
}: SoftButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'tap inline-flex items-center justify-center gap-2 font-medium tracking-wide transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-70',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
    >
      {children}
    </button>
  );
}
