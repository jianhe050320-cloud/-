import { CategoryIcon } from './CategoryIcon';
import { displayContent } from '../../services/storyContent';
import { storyCategory, storyTitle } from '../../data/storyCategories';
import type { Story } from '../../types/models';

/**
 * 故事卡片 —— 不是「App 里的一个条目」，而是**杂志目录里的一行**。
 *
 * 刻意做成「细线分隔的目录」而不是「浮起来的卡片堆」：
 *   - 没有圆角容器、没有阴影、没有彩色标签：这些东西堆在一起就是"效率工具感"；
 *   - 信息只留四样：章节编号、标题、一小段真实摘录、日期；
 *   - 摘录只截断，绝不改写（用户说过什么就是什么）。
 *
 * 目标是让人产生「这是我人生的第三篇」，而不是「数据库里的第三条记录」。
 */

/** 摘录必须来自故事自己的正文，不做任何改写：只截断，不重新概括。 */
export function excerptOf(content: string, limit = 54): string {
  const clean = (content ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > limit ? `${clean.slice(0, limit)}……` : clean;
}

/**
 * 杂志式日期：`2026 · 09 · 16`。
 * 刻意不写成 `2026-09-16`——那是数据库字段的样子，不是一本杂志的样子。
 */
export function magazineDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year} · ${month} · ${day}`;
}

/**
 * 封面日期：`2026 / 09 / 16`。
 *
 * 与列表里的 `2026 · 09 · 16` 是同一本杂志的两种排版位置：
 * 目录用中点，封面落款用斜杠。两种都不使用 `-`，因为那是数据库字段的样子。
 */
export function coverDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year} / ${month} / ${day}`;
}

/** 章节编号：`NO. 03`。没有编号时返回空串，页面不显示半个空壳。 */
export function chapterNo(no: number | undefined): string {
  if (typeof no !== 'number' || !Number.isFinite(no) || no < 1) return '';
  return `NO. ${String(Math.floor(no)).padStart(2, '0')}`;
}

export function StoryCard({
  story,
  no,
  onClick,
}: {
  story: Story;
  /** 章节编号（按当前列表顺序，由首页传入）；不传就不显示编号 */
  no?: number;
  onClick: () => void;
}) {
  const category = storyCategory(story);
  const title = storyTitle(story);
  // 摘要取自「最终会被读到的那一版正文」：用户改过就用用户的，否则用整理稿
  const excerpt = excerptOf(displayContent(story));
  const isFragment = story.kind === 'fragment';
  const date = magazineDate(story.updatedAt);
  const number = chapterNo(no);

  return (
    <button
      type="button"
      onClick={onClick}
      className="tap block w-full border-b border-paper-edge/45 py-6 text-left last:border-b-0"
    >
      {/* 第一行：章节编号在左，类目在右。两者都轻到几乎只是排版的一部分 */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10.5px] tracking-[0.24em] text-ink-100">{number}</span>
        <span className="flex items-center gap-1.5 text-[11px] tracking-[0.08em] text-ink-300">
          <CategoryIcon id={category.icon} className="h-3.5 w-3.5 shrink-0" />
          {category.label}
        </span>
      </div>

      <h3 className="mt-2.5 text-[19px] font-semibold leading-[1.4] text-ink-900">{title}</h3>

      {excerpt && (
        <p className="mt-2.5 line-clamp-2 text-[13.5px] leading-[1.8] text-ink-500">{excerpt}</p>
      )}

      <div className="mt-3.5 flex items-baseline justify-between gap-3 text-[11px] tracking-wide text-ink-300">
        <span>{date ? `最近记录 · ${date}` : ''}</span>
        <span className="shrink-0">{isFragment ? '人生片段 · 还可以继续讲' : '故事'}</span>
      </div>
    </button>
  );
}
