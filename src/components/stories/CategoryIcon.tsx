import type { ReactNode } from 'react';
import type { CategoryIconId } from '../../data/storyCategories';

/**
 * 类目图标：**极简线性小图**，自绘，风格统一。
 *
 * 为什么不用 emoji：emoji 由系统字体渲染，同一排里 🔄 🕯️ 🎒 的体量、粗细、颜色都不同，
 * 一眼就是「拼贴」。这里统一成 1.6 描边、无填充的线性图形，
 * 尺寸很小、存在感很弱 —— 它只需要帮用户扫一眼「这是哪一类经历」。
 */

const PATHS: Record<CategoryIconId, ReactNode> = {
  /* 求学：摊开的书 */
  study: (
    <>
      <path d="M4.2 5.6h5.1a2.4 2.4 0 0 1 2.4 2.4v10.6a1.9 1.9 0 0 0-1.9-1.9H4.2z" />
      <path d="M19.8 5.6h-5.1a2.4 2.4 0 0 0-2.4 2.4v10.6a1.9 1.9 0 0 1 1.9-1.9h5.6z" />
    </>
  ),
  /* 工作：一页纸 / 工牌 */
  work: (
    <>
      <rect x="5.2" y="4" width="13.6" height="16" rx="2.2" />
      <path d="M9 9h6M9 12.6h6M9 16.2h3.4" />
    </>
  ),
  /* 家人：两个人 */
  family: (
    <>
      <circle cx="9" cy="8.2" r="2.5" />
      <path d="M4.6 18.8c0-2.5 2-4.2 4.4-4.2s4.4 1.7 4.4 4.2" />
      <circle cx="16.6" cy="9.6" r="1.9" />
      <path d="M14.8 18.8c0-2 1-3.3 2-3.3s2 1.3 2 3.3" />
    </>
  ),
  /* 朋友：两个杯子 */
  friend: (
    <>
      <path d="M4 9.2h4.4v5.4a2.2 2.2 0 0 1-4.4 0z" />
      <path d="M8.4 10.6h1.2a1.5 1.5 0 0 1 0 3H8.4" />
      <path d="M13.4 9.2h4.4v5.4a2.2 2.2 0 0 1-4.4 0z" />
      <path d="M17.8 10.6h1.2a1.5 1.5 0 0 1 0 3h-1.2" />
    </>
  ),
  /* 某个人：头像轮廓 */
  person: (
    <>
      <circle cx="12" cy="8.4" r="3.2" />
      <path d="M5.6 19.2c0-3.3 2.9-5.4 6.4-5.4s6.4 2.1 6.4 5.4" />
    </>
  ),
  /* 某个地方：地图标记 */
  place: (
    <>
      <path d="M12 20.2s5.6-5.4 5.6-9.4a5.6 5.6 0 0 0-11.2 0c0 4 5.6 9.4 5.6 9.4z" />
      <circle cx="12" cy="10.6" r="1.9" />
    </>
  ),
  /* 某段经历：一页写了字的小纸 */
  moment: (
    <>
      <path d="M6.4 4.4h7.2l4 4v11.2H6.4z" />
      <path d="M13.4 4.4v4.2h4.2" />
      <path d="M9.2 12.6h5.6M9.2 15.8h5.6" />
    </>
  ),
  /* 关于自己：一面小镜子 */
  self: (
    <>
      <rect x="7.2" y="3.6" width="9.6" height="12.6" rx="4.8" />
      <path d="M9.8 20.4h4.4" />
    </>
  ),
  /* 通用：一本书 */
  book: (
    <>
      <rect x="6" y="4.4" width="12" height="15.2" rx="2.2" />
      <path d="M9.6 4.4v15.2" />
    </>
  ),
};

export function CategoryIcon({
  id,
  className = 'h-3.5 w-3.5',
}: {
  id: CategoryIconId;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[id]}
    </svg>
  );
}
