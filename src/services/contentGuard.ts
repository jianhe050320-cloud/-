import { DISCOVERY_KIND_LIMIT, type Discovery, type DiscoveryKind } from '../types/discovery';

/**
 * derived content 的确定性闸门。
 *
 * 为什么必须有这一层：
 *   提示词只是「建议」，模型偶发就会写「你是讨好型人格」「你从小缺乏认可」。
 *   这类话一旦出现在「关于你」里，产品就从「帮人看见自己」变成了「AI 给人下诊断」——
 *   是这个产品最不能犯的错误。所以硬红线一律由代码兜底，不依赖模型自觉。
 *
 * 这里只删不加，也不改用户原话。
 */

/** 禁止出现在「关于你」里的措辞 */
const DISCOVERY_FORBIDDEN: { re: RegExp; reason: string }[] = [
  { re: /(人格|性格|依恋|心理问题|心理学|心理诊断|诊断)/, reason: '人格标签或心理诊断' },
  { re: /(讨好型|回避型|完美主义|自恋型|高敏感|内向型|外向型|控制欲)/, reason: '人格类型标签' },
  { re: /(你|您)(天生|从小|骨子里|本质上|一直以来就是)/, reason: '没有证据的心理溯源' },
  { re: /(缺乏|缺少|没有得到)(父母|家庭|爱|安全感|认可|关注)/, reason: '没有证据的心理解释' },
  { re: /(你|您)是(一个|个)?[^，。；]{0,12}(的人|者|型)/, reason: '给用户贴人格标签' },
  { re: /(内驱力|情绪价值|高情商|低自尊|不自洽|心智成熟)/, reason: 'AI 评语' },
  { re: /(你|您)(非常|很|特别|极其|其实)(优秀|敏感|善良|重感情|坚强|勇敢|了不起|不容易)/, reason: 'AI 评语' },
  { re: /(我看见的你|我眼中的你|我看到的你)/, reason: 'AI 视角的评语' },
  // 「只描述可观察的行为，不往下推断」：把一次行为解释成能力或性格缺陷，是最典型的越界
  { re: /(不擅长|不善于|不懂得|不会)(表达|拒绝|沟通|接受|示弱|拒绝别人)/, reason: '从行为过度推断到能力与性格' },
];

/** 允许 Level 3（克制性发现）使用的开放性词 */
const HEDGE_RE = /(似乎|好像|也许|看起来|可能)/;

/**
 * 谈论用户「内心倾向」的分类：必须保持开放性，除非是在直接引用原话。
 * 「你表达在意的方式」「故事里的其他人」不在此列——它们描述的是可观察的行为与他人，
 * 硬加猜测词反而会变成对用户的定性。
 */
const OPEN_CLAIM_KINDS = new Set<DiscoveryKind>(['care', 'want', 'refuse', 'change', 'insight', 'facing']);

/** 「直接引用用户原话」的写法：这种不需要开放性词（属于 Level 1/2） */
const CITATION_RE = /(你(提到|说|讲过|用过|说的)|「|」)/;

/** 归一化：去掉空白，便于判断 evidence 是否真的逐字出现在原始语料里 */
function normalize(text: string): string {
  return (text ?? '')
    .replace(/[「」『』“”"'‘’]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export interface DiscoveryDrop {
  text: string;
  reason: string;
}

export interface DiscoveryLintResult {
  kept: Discovery[];
  dropped: DiscoveryDrop[];
}

/**
 * 「关于你」的确定性校验。
 *
 * 逐条检查：
 *   1. 长度合理（一句话，不是一段话）；
 *   2. 不含人格标签 / 心理诊断 / AI 评语；
 *   3. 不是直接引用时，必须有开放性词（Level 3 的克制语气）；
 *   4. **至少一条依据能逐字在原始语料里找到** —— 找不到就整条丢弃。
 * 最后按分类限量、总量限量，保证栏目克制。
 */
export function lintDiscoveries(raw: Discovery[], userTexts: string[]): DiscoveryLintResult {
  const corpus = userTexts.map(normalize).filter(Boolean);
  const dropped: DiscoveryDrop[] = [];
  const passed: Discovery[] = [];

  for (const item of raw) {
    const text = (item.text ?? '').trim();
    if (!text) {
      dropped.push({ text: '', reason: '空文本' });
      continue;
    }
    if (text.length > 60) {
      dropped.push({ text, reason: '太长，不像一句观察' });
      continue;
    }

    const forbidden = DISCOVERY_FORBIDDEN.find((rule) => rule.re.test(text));
    if (forbidden) {
      dropped.push({ text, reason: forbidden.reason });
      continue;
    }

    // 以「你提到 / 您提到」开头只是把原话复制一遍，不是发现：必须综合成一句新的表达
    if (/^(你提到|您提到|你说|您说)/.test(text)) {
      dropped.push({ text, reason: '以「你提到」开头只是引用原话，不是发现；请综合成一句新的表达' });
      continue;
    }

    // 依据必须逐字可回溯：这是这一层存在的根本原因
    const grounded = (item.evidence ?? [])
      .map((entry) => (entry ?? '').trim())
      .filter((entry) => entry.length >= 4)
      .filter((entry) => {
        const needle = normalize(entry);
        if (!needle) return false;
        return corpus.some((text2) => text2.includes(needle));
      });

    if (grounded.length === 0) {
      dropped.push({ text, reason: '找不到能逐字回溯到原始语料的依据' });
      continue;
    }

    // 复述拦截：text 基本就是把用户原话整句搬回来，没有综合，不算发现
    const stripPunct = (s: string): string => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    const nText = stripPunct(text);
    if (
      nText.length >= 8 &&
      corpus.some((u) => {
        const su = stripPunct(u);
        return su.includes(nText) && su.length <= nText.length * 1.6;
      })
    ) {
      dropped.push({ text, reason: '只是复述用户原话（没有综合），不是发现' });
      continue;
    }

    // 谈内心倾向 / 推断的分类必须保持克制：要么直接引用原话（含「」），
    // 要么带开放性词，要么有至少 2 条原话支撑（综合多条证据）。
    if (
      OPEN_CLAIM_KINDS.has(item.kind) &&
      !CITATION_RE.test(text) &&
      !HEDGE_RE.test(text) &&
      grounded.length < 2
    ) {
      dropped.push({
        text,
        reason: '既是推断、证据又不足：要么带「似乎/好像/也许/看起来」，要么有至少 2 条原话支撑',
      });
      continue;
    }

    passed.push({ ...item, text, evidence: grounded });
  }

  // 分类限量 + 总量限量：栏目要克制，不能变成清单
  const perKind = new Map<DiscoveryKind, number>();
  const kept: Discovery[] = [];
  for (const item of passed) {
    if (kept.length >= 5) break;
    const used = perKind.get(item.kind) ?? 0;
    if (used >= DISCOVERY_KIND_LIMIT) continue;
    perKind.set(item.kind, used + 1);
    kept.push(item);
  }

  return { kept, dropped };
}

/** 分享版里禁止出现的措辞（一旦出现就说明它偷偷做了「关于你」或心理分析） */
const SHARE_FORBIDDEN: { re: RegExp; reason: string }[] = [
  { re: /(人格|性格|依恋|心理问题|心理学|讨好型|回避型|完美主义|高敏感)/, reason: '出现了人格标签或心理诊断' },
  { re: /(我看见的你|我眼中的你|我看到的你)/, reason: '出现了 AI 视角的评语' },
  { re: /(你可能是|你似乎是一个|你是一个)[^，。；]{0,12}(的人|者|型)/, reason: '出现了对用户人格的推断' },
  { re: /(成长建议|人生启示|你要学会|你应该|建议你)/, reason: '出现了建议或说教' },
  { re: /(关于你|这篇故事里，你留下了)/, reason: '出现了「关于你」的内容' },
];

export interface ShareGuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * 分享版出稿前的确定性检查。
 * 只做「能不能给朋友看」的判定；不通过时由调用方降级（回落到已经过质检的私享版正文），
 * 绝不放行一版带心理分析的分享稿。
 */
export function guardShareContent(content: string): ShareGuardResult {
  const text = (content ?? '').trim();
  if (text.length < 20) return { ok: false, reason: '内容太短' };
  const hit = SHARE_FORBIDDEN.find((rule) => rule.re.test(text));
  if (hit) return { ok: false, reason: hit.reason };
  return { ok: true };
}
