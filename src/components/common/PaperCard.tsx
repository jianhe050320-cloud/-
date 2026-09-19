import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** 纸感卡片容器：暖纸白 + 极浅内描边 + 柔和投影 */
export function PaperCard({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  const Tag = as;
  return <Tag className={cn('card-paper p-4', className)}>{children}</Tag>;
}

/** 夜幕上的玻璃浮层卡片（观察抽屉、设置页深色分组） */
export function NightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('glass-night rounded-3xl p-4', className)}>{children}</div>;
}
