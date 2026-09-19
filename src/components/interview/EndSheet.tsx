import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** 轻量底部弹层：结束本身也是一种成功，所以不叫「退出」 */
export function EndSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-night-900/60 backdrop-blur-sm"
      />
      <div
        className={cn(
          'safe-bottom relative animate-sheet-up rounded-t-[28px] bg-paper-warm px-5 pb-3 pt-5 shadow-lift',
        )}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-100/60" aria-hidden />
        <h2 className="text-[16px] font-semibold leading-snug text-ink-900">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
