import { Fragment, useMemo } from 'react';
import { chapterNo, coverDate } from './StoryCard';
import type { EndingKind, StoryChapter } from '../../types/interview';

/**
 * 一页杂志正文。私享版与分享版共用同一套排版，
 * 因为它们是同一份人生语料的两种读法——视觉系统必须一致，读者才会觉得「这还是我的故事」。
 *
 * 排版纪律（不要在这里加任何装饰）：
 *   - 只有文字：没有图片、卡片、阴影、渐变、图标；
 *   - 封面落款三行很小，标题是唯一的大字，是这一页的视觉中心；
 *   - 正文段与段之间留呼吸；重点句只从正文**原样抽取**，抽不到就不显示；
 *   - 每 2~3 段一个重点句（用户原话），且与原文至少隔 2 段，避免「刚读过又放大」的撞句感。
 *
 * 注意：本组件不负责页面宽度，调用方给它一列（约 330px），它就只填这一列。
 */

type ReaderBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'pullquote'; text: string }
  | { kind: 'chapter'; no: number; title: string; intro?: string }
  | { kind: 'ending'; endingKind: EndingKind; text: string };

/** 「像我 / 回望 / 判断」这类自述句的起手式 —— 判断两句原文能不能连成一段重点句 */
const SELF_INTRO_RE = /^(我|自己|其实|所以|后来|可能|也许|原来|这|它|但|不过)/;

/**
 * 只读渲染层的拆长段：>140 字且 ≥4 句时，在中点那句的开头处切成两段。
 *
 * 为什么这里还要切一遍（生成时已经在 storyWriter 里切过）：
 *   storyWriter 只作用在**新生成的 AI 草稿**上，历史故事与用户手改版不会被它处理，
 *   于是旧数据里那种 200 字一个自然段（手机上 10 行）的「文字墙」会一直留着。
 * 这一层只影响**显示**，不回写存储，所以用户点「编辑」看到的仍是自己的原文。
 * 实现上按「原文下标」切割而非重拼句子，最后一个没有句末标点的残片也不会丢。
 */
function splitLongParagraphsForReading(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^。！？!?…]+[。！？!?…]+/g) ?? [];
    if (paragraph.replace(/\s/g, '').length > 140 && sentences.length >= 4) {
      const cut = paragraph.indexOf(sentences[Math.floor(sentences.length / 2)]);
      if (cut > 0) {
        out.push(paragraph.slice(0, cut).trim());
        out.push(paragraph.slice(cut).trim());
        continue;
      }
    }
    out.push(paragraph);
  }
  return out;
}

/** 给一段里的每句话打分，挑出「像用户重点句」的候选（只从原话里挑，不改写、不拼接） */
function scoreSentences(paragraph: string): { text: string; score: number; order: number; sentences: string[] }[] {
  const sentences = paragraph.match(/[^。！？!?…]+[。！？!?…]+/g) ?? [];
  const out: { text: string; score: number; order: number; sentences: string[] }[] = [];
  sentences.forEach((raw, order) => {
    const text = raw.trim();
    const length = text.replace(/\s/g, '').length;
    if (length < 12 || length > 46) return;

    let score = 0;
    // 第一人称 —— 这句话是「我说的」，最适合被放大
    if (/(我|自己)/.test(text)) score += 3;
    // 有回望、有判断 —— 更像一段人生里的「重点句」
    if (/(希望|觉得|明白|其实|原来|后来|一直|可能|好像|也许|知道|记得|接受|重要)/.test(text)) {
      score += 2;
    }
    if (/[，,]/.test(text)) score += 1;

    out.push({ text, score, order, sentences });
  });
  return out;
}

/**
 * 挑一段「真正属于用户的话」当重点句（Pull Quote）。
 *
 * 硬约束：**只从已有正文里原样抽取** —— 不改写、不润色、不拼接词句、不创造金句。
 * 最多允许把**同一段里紧挨着的两句原话**连起来读（仍是原文，一字未改）。
 * 找不到合适的就返回 null：页面宁可不显示，也不硬凑一句漂亮话。
 *
 * @deprecated 新版走 `pickPullQuotes`（多锚点）。本函数仅保留作向后兼容。
 */
export function pickPullQuote(paragraphs: string[]): { text: string; index: number } | null {
  if (paragraphs.length < 2) return null;

  const candidates: {
    text: string;
    index: number;
    order: number;
    score: number;
    sentences: string[];
  }[] = [];

  paragraphs.forEach((paragraph, index) => {
    if (index === 0 || index >= paragraphs.length - 1) return;

    const sentences = paragraph.match(/[^。！？!?…]+[。！？!?…]+/g) ?? [];
    sentences.forEach((raw, order) => {
      const text = raw.trim();
      const length = text.replace(/\s/g, '').length;
      if (length < 12 || length > 46) return;

      let score = 0;
      if (/(我|自己)/.test(text)) score += 3;
      if (/(希望|觉得|明白|其实|原来|后来|一直|可能|好像|也许|知道|记得|接受|重要)/.test(text)) {
        score += 2;
      }
      if (/[，,]/.test(text)) score += 1;

      candidates.push({ text, index, order, score, sentences });
    });
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.index - b.index || a.order - b.order);

  const best = candidates[0];
  let text = best.text;

  const next = (best.sentences[best.order + 1] ?? '').trim();
  if (
    next &&
    SELF_INTRO_RE.test(next) &&
    next.length <= 30 &&
    best.text.length + next.length <= 56
  ) {
    text = `${best.text}${next}`;
  }

  return { text, index: best.index };
}

/**
 * 多锚点重点句：每 `every` 段出现一句用户原话的重点句。
 *
 * 防撞规则（根治图 2「刚读过又放大」的撞句感）：
 *   锚点的原句所在段，必须与插入位置至少隔 `sourceGap` 段。
 * 这样放大句与它的原文之间隔着若干段落，读者再读到原文时会觉得
 * 「哦，那句就是重点」，而不是「你刚说过一遍」。
 *
 * 仍然是只从原话里抽，零 AI 成本、零编造风险。
 */
export function pickPullQuotes(
  paragraphs: string[],
  every = 2,
  sourceGap = 2,
): { text: string; at: number; srcPara: number }[] {
  const n = paragraphs.length;
  if (n < 4) return [];

  // 跳过首段与末段：重点句应落在正文中段
  const byPara = paragraphs.map((p, i) => (i === 0 || i >= n - 1 ? [] : scoreSentences(p)));

  const chosen: { text: string; at: number; srcPara: number }[] = [];
  const used = new Set<string>();

  // 每隔 every 段设一个插入位（不落在首/末段）
  for (let slot = 1; slot <= n - 1; slot += every) {
    let best: { c: ReturnType<typeof scoreSentences>[number]; src: number; score: number } | null = null;
    for (let i = 1; i < n - 1; i += 1) {
      if (Math.abs(i - slot) < sourceGap) continue; // 防撞：离插入位太近的原句不选
      for (const c of byPara[i]) {
        if (used.has(c.text)) continue;
        // 越靠近插入位、分数越高，越优先
        const s = c.score - Math.abs(i - slot) * 0.5;
        if (!best || s > best.score) best = { c, src: i, score: s };
      }
    }
    if (best) {
      let text = best.c.text;
      // 允许把同一段里紧邻的下一句也带进来（仍是原文，一字未改）
      const next = (best.c.sentences[best.c.order + 1] ?? '').trim();
      if (
        next &&
        SELF_INTRO_RE.test(next) &&
        next.length <= 30 &&
        text.length + next.length <= 56
      ) {
        text = `${text}${next}`;
      }
      chosen.push({ text, at: slot, srcPara: best.src });
      used.add(best.c.text);
    }
  }

  return chosen.sort((a, b) => a.at - b.at);
}

/**
 * 把自然段编排成有节奏的一页：每 2~3 段至多插入一处重点句（原话）。
 * 页面的呼吸来自排版层次，不来自装饰堆叠。
 */
export function buildReaderBlocks(paragraphs: string[]): ReaderBlock[] {
  const blocks: ReaderBlock[] = paragraphs.map((text) => ({ kind: 'paragraph' as const, text }));
  if (paragraphs.length < 4) return blocks;

  const total = paragraphs.join('').replace(/\s/g, '').length;
  if (total < 120) return blocks;

  const quotes = pickPullQuotes(paragraphs);
  let offset = 0;
  for (const q of quotes) {
    const at = Math.min(q.at + offset, blocks.length);
    blocks.splice(at, 0, { kind: 'pullquote', text: q.text });
    offset += 1;
  }
  return blocks;
}

/**
 * 章节化正文：每个章节一块（编号 + 可选章引 + 可选标题 + 段落），
 * 每章内按每 2~3 段插入一处重点句（原话）。
 *
 * 章引（intro）来自 outline.chapterPlan，是 AI 对本章的编辑性导语（≤20 字、已溯源校验），
 * 只在多章节故事里渲染；单章故事 / 旧数据无 intro，零回归。
 * pullQuote 来自 outline（已溯源校验的用户原话）；多锚点逻辑优先从各章段落里抽取，
 * 仅在「单章且抽不到」时回退用全局 pullQuote 放中点（保持旧行为）。
 */
export function buildChapterBlocks(
  chapters: StoryChapter[],
  options: { pullQuote?: string; chapterIntros?: (string | undefined)[] } = {},
): ReaderBlock[] {
  const { pullQuote, chapterIntros } = options;
  const multi = chapters.length >= 2;
  const all: ReaderBlock[] = [];

  chapters.forEach((chapter, ci) => {
    // 章引只在多章节故事渲染（单章故事的故事感不靠它）
    const intro = multi ? chapterIntros?.[ci]?.trim() || undefined : undefined;
    const chapterBlocks: ReaderBlock[] = [
      { kind: 'chapter', no: ci + 1, title: chapter.title?.trim() ?? '', intro },
    ];

    const paras = splitLongParagraphsForReading(
      chapter.paragraphs.filter((paragraph) => paragraph.trim()),
    );
    if (!paras.length) {
      all.push(...chapterBlocks);
      return;
    }

    const quotes = pickPullQuotes(paras);
    if (quotes.length || !pullQuote?.trim()) {
      paras.forEach((paragraph, pi) => {
        chapterBlocks.push({ kind: 'paragraph', text: paragraph });
        const q = quotes.find((x) => x.at === pi + 1);
        if (q) chapterBlocks.push({ kind: 'pullquote', text: q.text });
      });
    } else {
      // 旧兜底：单章且抽不到锚点 → 用全局 pullQuote 放中点
      const at = Math.max(1, Math.floor(paras.length / 2));
      paras.forEach((paragraph, pi) => {
        chapterBlocks.push({ kind: 'paragraph', text: paragraph });
        if (pi === at - 1) chapterBlocks.push({ kind: 'pullquote', text: pullQuote!.trim() });
      });
    }

    all.push(...chapterBlocks);
  });

  return all;
}

export function MagazineArticle({
  title,
  content,
  chapter,
  updatedAt,
  chapters,
  pullQuote,
  chapterIntros,
  ending,
}: {
  title: string;
  content: string;
  /** 章节编号（与「我的故事」目录同一套顺序）；不传就不显示 */
  chapter?: number;
  /** 落款用日期 */
  updatedAt?: string;
  /** C 版结构化章节（可选）；缺省走旧 content 渲染，保证旧数据零回归 */
  chapters?: StoryChapter[];
  /** 从正文提出的用户原话重点句（必须溯源）；缺省时旧数据回退自动抽取 */
  pullQuote?: string;
  /** 每章的 AI 编辑性导语（≤20 字，已溯源）；仅多章节故事使用 */
  chapterIntros?: (string | undefined)[];
  /** 结尾落点（用户自己的理解 / 画面 / 原话）；缺省不渲染 */
  ending?: { kind: EndingKind; text: string };
}) {
  /** 正文严格按已有自然段渲染：绝不把整篇合成一个长 <p>，也绝不改写 */
  const paragraphs = useMemo(
    () =>
      splitLongParagraphsForReading(
        (content ?? '')
          .split(/\n+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    [content],
  );

  const blocks = useMemo(() => {
    const base =
      chapters && chapters.length
        ? buildChapterBlocks(chapters, { pullQuote, chapterIntros })
        : buildReaderBlocks(paragraphs);
    if (ending && ending.text.trim()) {
      base.push({ kind: 'ending', endingKind: ending.kind, text: ending.text.trim() });
    }
    return base;
  }, [chapters, pullQuote, paragraphs, ending, chapterIntros]);

  const date = coverDate(updatedAt);

  return (
    <>
      {/* 封面落款：三行很轻的排版信息，标题才是第一视觉中心 */}
      <header className="pt-10">
        <p className="text-[10px] tracking-[0.44em] text-amber-600/85">MY STORY</p>

        {(chapter || date) && (
          <div className="mt-7 space-y-1.5">
            {chapter ? (
              <p className="text-[11px] tracking-[0.18em] text-ink-300">{chapterNo(chapter)}</p>
            ) : null}
            {date ? <p className="text-[11px] tracking-[0.18em] text-ink-300">{date}</p> : null}
          </div>
        )}

        <h1 className="mt-12 font-serif text-[32px] font-semibold leading-[1.32] tracking-[0.01em] text-ink-900">
          {title}
        </h1>
      </header>

      {/* 章节锚点：只在「没有真正章节」时给正文一个「从这里开始」的记号（01）。
          有章节时每个章节自带编号与（可选）标题，绝不伪造 02 / 03。 */}
      {!chapters?.length && paragraphs.length > 0 && (
        <p className="mt-8 text-[11px] tracking-[0.42em] text-ink-300" aria-hidden>
          01
        </p>
      )}

      <article className="mt-10 space-y-8 font-serif text-[17.5px] leading-[2.1] text-ink-800">
        {blocks.map((block, index) => {
          if (block.kind === 'chapter') {
            return (
              <Fragment key={`ch-${block.no}`}>
                <p className="font-sans text-[11px] tracking-[0.42em] text-ink-300" aria-hidden>
                  {String(block.no).padStart(2, '0')}
                </p>
                {block.intro ? (
                  <p className="mt-3 text-[13px] leading-[1.7] tracking-[0.01em] text-ink-400">
                    {block.intro}
                  </p>
                ) : null}
                {block.title ? (
                  <h2 className="mt-5 text-[19px] font-medium leading-[1.5] tracking-[0.01em] text-ink-900">
                    {block.title}
                  </h2>
                ) : null}
              </Fragment>
            );
          }
          if (block.kind === 'pullquote') {
            return (
              <figure key={`quote-${index}`} className="my-7 border-l-2 border-amber-600/25 pl-4">
                <blockquote className="text-[19px] font-normal leading-[1.85] text-ink-700">
                  {block.text}
                </blockquote>
              </figure>
            );
          }
          if (block.kind === 'ending') {
            return (
              <figure key={`ending-${index}`} className="mt-4">
                <div className="h-px w-12 bg-paper-edge" />
                <p className="mt-6 font-sans text-[11px] tracking-[0.3em] text-ink-300">尾声</p>
                <p className="mt-3 text-[16px] leading-[1.9] text-ink-700">{block.text}</p>
              </figure>
            );
          }
          return (
            <Fragment key={`p-${index}-${block.text.slice(0, 8)}`}>
              {/* 段落是用户自己的话，按顺序原样展示，不做任何改写 */}
              <p>{block.text}</p>
            </Fragment>
          );
        })}
      </article>
    </>
  );
}

export default MagazineArticle;
