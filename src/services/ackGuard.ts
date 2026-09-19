/**
 * 「接住」校验器（原则 1）。
 *
 * 原则说「每次回答都必须先接住」，但原则本身没法执行——模型可以写一句
 * 「嗯，我听到了。」然后照样追问。这里把它变成**可判定**的检查：
 *
 *   一句合格的接住，必须复述用户说过的具体内容。
 *   判定方式 = 与用户说过的话有实词重叠（2~4 字连续片段，且不是高频功能词）。
 *
 * 做成 n-gram 重叠而不是语义相似度，是为了：确定性、零成本、可解释——
 * 观察面板能直接显示「复述了『努力了一段时间』」。
 *
 * 检验不过的接住会被退回重写；重写仍不过，就降级成确定性的复述句。
 */

/** 高频功能词：命中它们不算「复述了具体内容」 */
const STOP_GRAMS = new Set([
  '知道',
  '觉得',
  '感觉',
  '认为',
  '其实',
  '然后',
  '就是',
  '这个',
  '那个',
  '时候',
  '什么',
  '怎么',
  '因为',
  '所以',
  '但是',
  '如果',
  '还是',
  '可以',
  '一个',
  '我们',
  '你们',
  '他们',
  '自己',
  '已经',
  '有点',
  '一下',
  '一样',
  '这些',
  '那些',
  '现在',
  '后来',
  '当时',
  '比较',
  '非常',
  '特别',
  '真的',
  '确实',
  '应该',
  '可能',
  '不会',
  '没有',
  '不是',
  '这样',
  '那样',
  '的话',
  '起来',
  '出来',
  '下来',
  '听到',
  '看到',
  '想到',
  '一下',
  '一点',
]);

function normalize(text: string): string {
  return text.replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '');
}

/** 把一段话拆成 2~4 字的连续片段，过滤掉功能词 */
function grams(text: string): Set<string> {
  const clean = normalize(text);
  const out = new Set<string>();
  for (let size = 2; size <= 4; size += 1) {
    for (let i = 0; i + size <= clean.length; i += 1) {
      const gram = clean.slice(i, i + size);
      if (!STOP_GRAMS.has(gram)) out.add(gram);
    }
  }
  return out;
}

/** 两段文字之间最长的实词重叠片段（storyLint 也复用它来判「有没有复述」） */
export function longestSharedGram(text: string, others: string[]): string {
  const pool = new Set<string>();
  for (const other of others) {
    for (const gram of grams(other)) pool.add(gram);
  }
  let best = '';
  for (const gram of grams(text)) {
    if (pool.has(gram) && gram.length > best.length) best = gram;
  }
  return best;
}

export interface AckCheck {
  ok: boolean;
  /** 命中的最长重叠片段 */
  overlap: string;
  reason: string;
}

/** 取一段话里的实词片段（≥minSize 字），供覆盖率统计使用 */
export function contentGrams(text: string, minSize = 3): Set<string> {
  return new Set([...grams(text)].filter((gram) => gram.length >= minSize));
}

/**
 * source 里的关键片段有多少比例出现在 target 里（0~1）。
 * storyLint 用来看「故事有没有严重偏离用户的原话」。
 */
export function coverageRatio(source: string, target: string, minSize = 3): number {
  const sourceGrams = contentGrams(source, minSize);
  if (sourceGrams.size === 0) return 1;
  const targetClean = normalize(target);
  let hit = 0;
  for (const gram of sourceGrams) {
    if (targetClean.includes(gram)) hit += 1;
  }
  return hit / sourceGrams.size;
}

/**
 * 检查一句「接住」是否真的复述了用户说过的内容。
 * userTexts 传最近几轮用户的原话（越近的越重要）。
 */
export function checkAck(ack: string, userTexts: string[]): AckCheck {
  const cleanAck = normalize(ack);
  if (cleanAck.length < 4) {
    return { ok: false, overlap: '', reason: '接住太短，等于没说出任何具体内容' };
  }

  const userGrams = new Set<string>();
  for (const text of userTexts) {
    for (const gram of grams(text)) userGrams.add(gram);
  }

  const best = longestSharedGram(ack, userTexts);
  if (best.length >= 3) {
    return { ok: true, overlap: best, reason: `复述了「${best}」` };
  }

  const twoCharHits = [...grams(ack)].filter((gram) => gram.length === 2 && userGrams.has(gram));
  if (twoCharHits.length >= 2) {
    return {
      ok: true,
      overlap: twoCharHits.join('、'),
      reason: `复述了「${twoCharHits.join('、')}」`,
    };
  }

  return {
    ok: false,
    overlap: best,
    reason: best ? `只碰到「${best}」两个字，太空泛` : '没有复述用户说过的任何具体内容',
  };
}

/**
 * 兜底接住：用用户自己那句话里最长的一个短句复述。
 * 只在模型连续两次都不合格时才用——宁可朴素地引原话，也不要空泛。
 */
export function buildFallbackAck(userText: string): string {
  const clauses = userText
    .split(/[。！？；\n，,]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6 && item.length <= 24);
  const picked = clauses.sort((a, b) => b.length - a.length)[0];
  return picked ? `你刚才说的「${picked}」，我记下来了。` : '你说的这些，我记下来了。';
}
