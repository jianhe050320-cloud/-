import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { BookHeart, Home, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

const TABS = [
  { to: '/stories', label: '我的故事', icon: BookHeart },
  { to: '/', label: '首页', icon: Home },
  { to: '/settings', label: '设置', icon: SettingsIcon },
];

/**
 * 手机壳容器：内容区独立滚动，底部导航作为兄弟节点常驻 —— 视觉上等效 fixed，
 * 但不会盖住内容，也就不需要在正文里补 pb-[导航高度]。
 * 采访页用 hideTabBar 关掉导航，改成输入区。
 */
export function PhoneShell({
  children,
  hideTabBar = false,
  footer,
  overlay,
}: {
  children: ReactNode;
  hideTabBar?: boolean;
  /** 固定在底部的操作区（采访页的输入区） */
  footer?: ReactNode;
  /** 抽屉、弹层等浮层：渲染在手机壳内部，用 absolute inset-0 定位 */
  overlay?: ReactNode;
}) {
  return (
    <div className="relative flex h-dvh flex-col bg-paper">
      <main className="no-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</main>
      {footer}
      {!hideTabBar && (
        <nav className="safe-bottom sticky bottom-0 z-20 shrink-0 border-t border-paper-edge/70 bg-paper-warm/95 backdrop-blur-xl">
          <div className="flex items-stretch justify-around px-2 pt-1.5">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    'tap flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1',
                    isActive ? 'text-amber-600' : 'text-ink-300 hover:text-ink-500',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <tab.icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.7} />
                    <span className="text-[11px] font-medium tracking-wide">{tab.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
      {overlay}
    </div>
  );
}

/** 页面顶栏：返回 + 标题 + 右侧动作 */
export function PageTopBar({
  title,
  subtitle,
  onBack,
  right,
  tone = 'paper',
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  tone?: 'paper' | 'night';
}) {
  const isNight = tone === 'night';
  return (
    <header
      className={cn(
        'safe-top sticky top-0 z-30 shrink-0 border-b backdrop-blur-xl',
        isNight
          ? 'border-paper/10 bg-night-800/90 text-paper'
          : 'border-paper-edge/60 bg-paper/90 text-ink-900',
      )}
    >
      <div className="flex items-center gap-2 px-3 pb-2.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className={cn(
              'tap -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
              isNight ? 'text-paper/80 hover:bg-paper/10' : 'text-ink-500 hover:bg-ink-900/5',
            )}
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
          {subtitle && (
            <p
              className={cn(
                'mt-0.5 truncate text-[11px] tracking-wide',
                isNight ? 'text-paper/60' : 'text-ink-300',
              )}
            >
              {subtitle}
            </p>
          )}
        </div>
        {/* shrink-0：右侧动作（如「编辑」）绝不能被长标题挤扁、截断 */}
        {right && <div className="flex shrink-0 items-center">{right}</div>}
      </div>
    </header>
  );
}
