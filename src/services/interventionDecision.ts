/**
 * Phase 3.1 / 3.1.1 · Discovery Detection + Intervention Decision（内部决策层，不进入生产回复链）。
 *
 * 原则（最高层约束）：
 *   - 「AI 不是负责把故事问完整，而是负责听见用户已经表达出来的东西。」
 *   - 「发现值得注意的东西」≠「应该马上问问题」。
 *   - 指出，不占有；照亮，然后退开；用户不接，就收灯。
 *   - 宁可漏掉 Discovery，也不要凭空制造 Discovery。
 *
 * 实现策略：
 *   Discovery Detection 以**确定性**（正则 + 结构）为主通道——它稳定、可测、零额外模型调用，
 *   天然就是「LLM 不可靠时仍然存在的保守 fallback」。本层不依赖任何模型调用即可独立工作。
 *
 * Phase 3.1.1 hardening：
 *   1) 跨轮 active-expression 状态（区分「正在连续表达」与「已停下」）
 *   2) 跨轮 previousIntervention 状态（上一轮 REFLECT 没被接住 → 不再 REFLECT）
 *   3) CONTRAST / REPETITION 收紧（同一语义维度的张力，而非关键词共现）
 *   4) SELF_REALIZATION（关于自己）与 RELATIONAL_REALIZATION（关于他人/关系）拆分
 *   5) structuralDiscoveryValue ≠ selfDiscoveryValue
 *   6) ASK_CANDIDATE 真实存在，但由 interruption/user state 决定是否阻断
 *   7) AUTHORIZED_DISCOVERY 同义表达扩充
 */

import type {
  DiscoverySignal,
  DiscoveryType,
  DiscoveryValueLevel,
  InterventionCandidate,
  InterventionDecisionTrace,
  FutureDecisionHint,
  ActiveExpressionState,
  ActiveExpressionConfidence,
  LastInterventionState,
  UserResponseToIntervention,
  AskDirection,
} from '../types/intervention';
import { createEmptyActiveExpression } from '../types/intervention';
import type {
  Understanding,
  StoryMemory,
  InterruptionCostLevel,
  StoryMaterialLevel,
  StoryFocusLevel,
  WillingnessLevel,
  Clue,
} from '../types/interview';

/* ================ 工具 ================ */

const STOPWORDS = new Set([
  '然后', '后来', '当时', '其实', '就是', '一个', '没有', '什么', '因为', '所以', '那天', '一直',
  '真的', '还是', '但是', '不过', '自己', '这个', '那个', '他们', '我们', '觉得', '知道', '现在',
  '以前', '之前', '时候', '一下', '这么', '那么', '不是', '只是', '可能', '好像', '突然', '而且',
  '可是', '虽然', '如果', '一直都', '特别', '真的', '已经',
]);

/**
 * 事实铺陈里的地点/场所名词：它们在时间线里被顺带重复，不等于「用户刻意强调」。
 * 关键词重复（REPETITION）只关心用户用来描述感受/判断的词（如「普通」「开心」），
 * 不关心「宿舍 → 食堂 → 又回宿舍」这种只是把地点列了两遍的情况。
 */
const FACT_PLACE_NOUNS = new Set([
  '宿舍', '食堂', '图书馆', '学校', '教室', '操场', '公司', '办公室', '公园', '医院',
  '银行', '超市', '路上', '车上', '家里', '商场', '车站', '机场', '餐厅', '咖啡',
]);

/** 强化词：一个被重复的普通词，只有被「很 / 挺 / 特别…」这类词强化过，才算用户在强调。 */
const INTENSIFIER_RE = /(很|挺|特别|太|非常|真的|有点|一直|都|最|蛮|超|多)/;

function splitClauses(text: string): string[] {
  return text
    .split(/[。！？!?；;，,\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

/** 判断一句是不是「最小回应」（嗯 / 哦 / 对 / 好的 …），用于「Reflection 没被接住」 */
export function isMinimalResponse(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length === 0) return true;
  if (t.length <= 2) return true;
  return /^(嗯|嗯嗯|哦|噢|噢噢|唔|额|呃|对|对的|好|好的|好吧|行|行吧|知道了|懂了|是的|嗯哼|哦哦|这样|是吗)$/.test(t);
}

/* ================ Discovery Detection（确定性主通道） ================ */

const POS_EMO_RE = /(开心|兴奋|高兴|快乐|激动|期待|满足|幸福)/;
const PRETEND_RE = /(装(作|得)?[^，。]{0,3}(淡定|平静|没事|轻松|冷静)|故作(淡定|镇定)|不紧张|也就这样|也就那样|没什么|无所谓|强装|假装|故作)/;
const SOCIAL_RE = /(拍照|拥抱|热闹|大家|一起)/;
/**
 * 收紧：只有明确出现「安静 / 冷清 / 静下来 / 没什么人」才算「安静侧」，
 * 「一个人」本身不够（「一张只有我一个人」不是热闹→安静的对照）。
 */
const QUIET_RE = /(安静|冷清|安静下来|静下来|没什么人|一个人都没有)/;

/**
 * SELF_REALIZATION —— 关于「自己」的新认识。
 * 要求「发现」的对象是「我」：后来我才发现，我其实… / 我真正…的是…
 * 「后来才知道她一直很爱我」不属于这里（那是 relational）。
 */
const SELF_REALIZATION_RE =
  /((后来|之后)(我)?才?(发现|意识到|明白|懂)[^。！？]{0,14}我(其实|自己|一直|真正|好像|总是|原来)|我突然(发现|意识到)[^。！？]{0,14}我|我(真正|其实)(在乎|介意|想要|怕|喜欢|不喜欢|讨厌)的是|原来(我|自己)(其实|一直|是)|我才(发现|意识到)[^。！？]{0,8}我)/;

/**
 * RELATIONAL_REALIZATION —— 关于「他人 / 关系」的新认识。
 * 「后来才知道她一直很爱我」属于这里：它是关系层面的理解，不等于用户重新认识了自己。
 */
const RELATIONAL_REALIZATION_RE =
  /((后来|之后)(我)?才?(知道|发现|意识到|明白)[^。！？]{0,4}(她|他|妈|爸|妈妈|爸爸|奶奶|外婆|老师|朋友|家人|家里|他们)|原来(她|他|妈|爸|他们)|(她|他|妈|爸)(其实|一直)[^。！？]{0,10}(爱|关心|在意|为我|付出|心疼))/;

const BEFORE_AFTER_RE =
  /(以前|之前|原来|起初)[^！？]{0,22}(后来|现在|如今|之后)[^！？]{0,16}(发现|明白|意识到|知道|懂了|理解|才)/;
const SELF_NAMED_CORE_RE =
  /(我记得?最?清楚(记得)?的是|我最忘不了的是|真正让我记住的是|其实最重要的是|我到现在最记得|最清楚记得|最让我记得|最记得)/;
const SPECIFIC_DETAIL_RE =
  /(轻轻(关上|放下|说|睁开)?|冻得通红|通红|手(一?直)?在抖|没有说再见|把门(轻轻)?关上|湿润|一直(沉默|没说话)|眼眶(红|湿)|低着头)/;
const BEHAVIOR_SEQUENCE_RE =
  /(先(给|去|帮|为|买|接)|再(去|帮|给|接)|最后才(回|自己|休息|睡)|先[^。，！？]{0,20}再[^。，！？]{0,20}最后)/;

/**
 * 找「被刻意强调的重复词」。
 * 收紧：重复出现 >=2 次，且至少一次带强化词（很 / 挺 / 特别…），才认为是「强调」。
 * 这样「普通 / 普通」会被发现，而「出门…出门」「学校…学校」这类事实性重复不会。
 */
function findRepeatedPhrase(text: string): { phrase: string; clauses: string[] } | null {
  const clauses = splitClauses(text);
  const pool = clauses.join('。');
  for (let len = 4; len >= 2; len--) {
    const seen = new Set<string>();
    for (let i = 0; i + len <= pool.length; i++) {
      const sub = pool.slice(i, i + len);
      if (!/^[一-龥]+$/.test(sub)) continue;
      if (STOPWORDS.has(sub)) continue;
      if (FACT_PLACE_NOUNS.has(sub)) continue;
      if (seen.has(sub)) continue;
      seen.add(sub);
      let count = 0;
      let intensified = 0;
      let idx = pool.indexOf(sub);
      while (idx !== -1) {
        count += 1;
        const before = pool.slice(Math.max(0, idx - 2), idx);
        const after = pool.slice(idx + sub.length, idx + sub.length + 2);
        if (INTENSIFIER_RE.test(before) || INTENSIFIER_RE.test(after)) intensified += 1;
        idx = pool.indexOf(sub, idx + 1);
      }
      if (count >= 2 && intensified >= 1) {
        const hitClauses = clauses.filter((c) => c.includes(sub)).slice(0, 2);
        return { phrase: sub, clauses: hitClauses.length ? hitClauses : [sub] };
      }
    }
  }
  return null;
}

export interface DetectDiscoveryInput {
  userText: string;
  /** 可选：LLM1 understanding（仅作增强透传位，本层不依赖它） */
  understanding?: Understanding;
  /** 可选：已有 memory（保留扩展位） */
  memory?: StoryMemory;
  /** 可选：来源消息 id，挂到 signal.sourceMessageIds */
  sourceMessageIds?: string[];
}

/**
 * 检测用户本轮表达里「有没有一个值得注意的结构」。
 * 纯确定性、无模型调用；LLM 不可用时仍给出保守结果。
 */
export function detectDiscoverySignals(input: DetectDiscoveryInput): DiscoverySignal[] {
  const text = input.userText ?? '';
  const clauses = splitClauses(text);
  const signals: DiscoverySignal[] = [];
  const ids = input.sourceMessageIds;
  const push = (s: Omit<DiscoverySignal, 'sourceMessageIds'>): void => {
    signals.push(ids ? { ...s, sourceMessageIds: ids } : (s as DiscoverySignal));
  };

  /*
   * CONTRAST：必须是「两个明确陈述之间、同一语义维度上的张力」，不是关键词共现。
   *  - 情感侧：一个 clause 有正向情绪 + 另一个 clause 出现「装/故作/不紧张/也就这样」这类压制表达；
   *  - 情境侧：一个 clause 是热闹/人群 + 另一个 clause 明确出现「安静/冷清」。
   */
  const posC = clauses.find((c) => POS_EMO_RE.test(c));
  const preC = clauses.find((c) => PRETEND_RE.test(c));
  const socC = clauses.find((c) => SOCIAL_RE.test(c));
  const quiC = clauses.find((c) => QUIET_RE.test(c));
  const emotionalContrast = Boolean(posC && preC);
  const situationalContrast = Boolean(socC && quiC);
  if (emotionalContrast || situationalContrast) {
    const evidence = Array.from(
      new Set([posC, preC, socC, quiC].filter((c): c is string => Boolean(c))),
    ).slice(0, 2);
    push({
      type: 'CONTRAST',
      detected: true,
      evidence,
      confidence: 'HIGH',
      userOwned: false,
      description: '两个陈述之间存在同一维度上的明显对照（情绪/状态相反）',
    });
  }

  // REPETITION：被强化的重复词
  const rep = findRepeatedPhrase(text);
  if (rep) {
    push({
      type: 'REPETITION',
      detected: true,
      evidence: rep.clauses,
      confidence: 'HIGH',
      userOwned: false,
      description: `用户反复强调了「${rep.phrase}」`,
    });
  }

  // BEFORE_AFTER：明确的前后变化（可能是客观变化，也可能是用户自己说出的发现）
  const baHit = text.match(BEFORE_AFTER_RE);
  if (baHit) {
    // 把命中片段按转折词切成「前面 / 后面」两段，便于生成「你前面说 X，后面又提到 Y」
    const seg = baHit[0];
    const cut = seg.search(/(后来|现在|如今|之后)/);
    const before = cut > 0 ? seg.slice(0, cut).trim() : '';
    const after = cut >= 0 ? seg.slice(cut).trim() : seg;
    const ev = [before, after].filter((s) => s.length >= 2);
    push({
      type: 'BEFORE_AFTER',
      detected: true,
      evidence: ev.length >= 2 ? ev : [seg],
      confidence: 'HIGH',
      userOwned: SELF_REALIZATION_RE.test(text) || RELATIONAL_REALIZATION_RE.test(text),
      description: '出现明确的前后认知/状态变化',
    });
  }

  // SELF_REALIZATION：用户对自己产生了新的认识
  const srHit = text.match(SELF_REALIZATION_RE);
  if (srHit) {
    push({
      type: 'SELF_REALIZATION',
      detected: true,
      evidence: clauses.filter((c) => SELF_REALIZATION_RE.test(c)).slice(0, 2).length
        ? clauses.filter((c) => SELF_REALIZATION_RE.test(c)).slice(0, 2)
        : [srHit[0]],
      confidence: 'HIGH',
      userOwned: true,
      selfDiscovery: true,
      description: '用户自己说出了「我其实… / 我真正…的是」这类关于自己的新认识',
    });
  }

  // RELATIONAL_REALIZATION：用户对他人 / 关系产生了新的认识（不等于重新认识自己）
  const rrHit = text.match(RELATIONAL_REALIZATION_RE);
  if (rrHit) {
    push({
      type: 'RELATIONAL_REALIZATION',
      detected: true,
      evidence: clauses.filter((c) => RELATIONAL_REALIZATION_RE.test(c)).slice(0, 2).length
        ? clauses.filter((c) => RELATIONAL_REALIZATION_RE.test(c)).slice(0, 2)
        : [rrHit[0]],
      confidence: 'HIGH',
      userOwned: true,
      selfDiscovery: false,
      description: '用户说出了关于他人 / 关系的新认识（不是关于自己的发现）',
    });
  }

  // SELF_NAMED_CORE：用户自己明确指出最记得 / 最重要的是什么
  const sncHit = text.match(SELF_NAMED_CORE_RE);
  if (sncHit) {
    push({
      type: 'SELF_NAMED_CORE',
      detected: true,
      evidence: clauses.filter((c) => SELF_NAMED_CORE_RE.test(c)).slice(0, 2).length
        ? clauses.filter((c) => SELF_NAMED_CORE_RE.test(c)).slice(0, 2)
        : [sncHit[0]],
      confidence: 'HIGH',
      userOwned: true,
      selfDiscovery: false,
      description: '用户自己完成了一次价值选择（最记得 / 最重要的是什么）',
    });
  }

  // BEHAVIOR_SEQUENCE：值得注意的行为顺序（先顾别人，最后才顾自己）
  if (BEHAVIOR_SEQUENCE_RE.test(text) && /(妈|爸|弟|姐|哥|别人|他|她|同事|朋友|家人)/.test(text)) {
    push({
      type: 'BEHAVIOR_SEQUENCE',
      detected: true,
      evidence: clauses.filter((c) => BEHAVIOR_SEQUENCE_RE.test(c)).slice(0, 2).length
        ? clauses.filter((c) => BEHAVIOR_SEQUENCE_RE.test(c)).slice(0, 2)
        : [text.slice(0, 30)],
      confidence: 'MEDIUM',
      userOwned: false,
      description: '用户表达了一个行为顺序（先处理他人，最后才处理自己）',
    });
  }

  // SPECIFIC_DETAIL：非常具体、可感、可能值得留下的细节（只记录，不推断意义）
  const sdHit = text.match(SPECIFIC_DETAIL_RE);
  if (sdHit) {
    push({
      type: 'SPECIFIC_DETAIL',
      detected: true,
      evidence: clauses.filter((c) => SPECIFIC_DETAIL_RE.test(c)).slice(0, 2).length
        ? clauses.filter((c) => SPECIFIC_DETAIL_RE.test(c)).slice(0, 2)
        : [sdHit[0]],
      confidence: 'MEDIUM',
      userOwned: false,
      selfDiscovery: false,
      description: '出现一个具体、可感的细节（仅记录，不推断其意义）',
    });
  }

  return signals;
}

/* ================ Discovery Value（structural ≠ self） ================ */

const STRUCTURAL_TYPES: DiscoveryType[] = [
  'CONTRAST',
  'REPETITION',
  'BEFORE_AFTER',
  'BEHAVIOR_SEQUENCE',
];

/** 结构性发现价值：只有这些才驱动 REFLECT（不让「故事意义强」或「用户自己的领悟」把它顶高）。 */
export function computeStructuralDiscoveryValue(signals: DiscoverySignal[]): DiscoveryValueLevel {
  const detected = signals.filter((s) => s.detected);
  if (!detected.length) return 'LOW';
  if (detected.some((s) => STRUCTURAL_TYPES.includes(s.type) && s.confidence !== 'LOW')) return 'HIGH';
  // 只有一个具体、可感的细节 → 中等（可轻轻指出，但不等于高价值对照）
  if (detected.some((s) => s.type === 'SPECIFIC_DETAIL' && s.confidence !== 'LOW')) return 'MEDIUM';
  // 只有「关于自己 / 关于他人 / 自指核心」的发现 → 不算结构性发现，交给 userOwned 分支处理
  return 'LOW';
}

/** 「关于用户自己」的发现价值（只记录，不驱动 REFLECT）。 */
export function computeSelfDiscoveryValue(signals: DiscoverySignal[]): DiscoveryValueLevel {
  const self = signals.filter((s) => s.detected && s.type === 'SELF_REALIZATION');
  if (!self.length) return 'LOW';
  return self.some((s) => s.confidence !== 'LOW') ? 'HIGH' : 'MEDIUM';
}

/** 向后兼容：等价于 structuralDiscoveryValue（决定 REFLECT 分支的那一个）。 */
export function computeDiscoveryValue(signals: DiscoverySignal[]): DiscoveryValueLevel {
  return computeStructuralDiscoveryValue(signals);
}

/* ================ 跨轮 Active Expression（Phase 3.1.1） ================ */

export interface ActiveExpressionInput {
  userText: string;
  initiative?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  expressionWillingness?: WillingnessLevel;
  hasSubstance?: boolean;
}

/**
 * 更新跨轮 active-expression 状态。
 * 必须综合：当前 userText 的 continuation/stop 信号 + 上一轮状态 + 用户主动扩展信号。
 */
export function updateActiveExpression(
  prev: ActiveExpressionState | undefined,
  input: ActiveExpressionInput,
): ActiveExpressionState {
  const base = prev ?? createEmptyActiveExpression();
  const t = (input.userText ?? '').trim();
  if (!t) return { ...base, active: false, lastNaturalStop: true, confidence: 'LOW' };

  const endsTerminal = /[。！？!?…]$/.test(t) || /[.?!]$/.test(t);
  const endsEllipsis = /(……|\.\.\.|——|—|~|～)$/.test(t);
  // 句尾悬空的连接/因果词：说明「话还没说完」
  const endsConnector = /(因为|所以|但是|不过|然后|后来|其实|就是|而且|还有|接着|是因为|可|但)\s*$/.test(t);
  const trailingUnfinished = endsEllipsis || endsConnector || (!endsTerminal && t.length >= 6);
  // 句首连接词：跨越上一轮的「继续讲同一件事」
  const leadingConnector = /^(但是|但|不过|然后|而且|其实|因为|所以|接着|后来|还有|对了|就是|可是我|可我|我那时候|我当时|那时候)/.test(t);

  const expanded =
    input.initiative === 'HIGH' ||
    input.initiative === 'VERY_HIGH' ||
    input.expressionWillingness === 'HIGH';

  const explicitStop = /(就这些|讲完了|没有了|就这样|先这样|大概就这些|说完了|没了|不说了)/.test(t);
  const naturalStop = !trailingUnfinished && !leadingConnector && (endsTerminal || explicitStop);

  const continuation = trailingUnfinished || leadingConnector;
  // 跨轮延续：上一轮还在连续表达，且这一轮没有明确停下
  const carryOver = base.active && !naturalStop && (leadingConnector || trailingUnfinished);

  const active = (continuation || expanded || carryOver) && !naturalStop;
  const streak = active ? (base.streak ?? 0) + 1 : 0;
  const confidence: ActiveExpressionConfidence = trailingUnfinished
    ? 'HIGH'
    : continuation && expanded
      ? 'HIGH'
      : active
        ? 'MEDIUM'
        : 'LOW';

  return {
    active,
    streak,
    lastUserExpanded: expanded,
    lastNaturalStop: naturalStop,
    confidence,
  };
}

/**
 * 用跨轮 active-expression 修正「干预层的打断成本」。
 * ⚠️ 只用于 Phase 3.1 决策层，不回写 Story Readiness 的 interruptionCost（保证 reply 不变）。
 */
export function refineInterruptionCost(
  base: InterruptionCostLevel,
  active?: ActiveExpressionState,
): InterruptionCostLevel {
  if (!active) return base;
  if (active.active) {
    if (active.confidence === 'HIGH') return 'HIGH';
    return base === 'HIGH' ? 'HIGH' : 'MEDIUM';
  }
  // 用户已停下且有自然停顿 → 关键词驱动的 HIGH/MEDIUM 降级为 LOW（允许 REFLECT）
  if (active.lastNaturalStop) return 'LOW';
  return base;
}

/* ================ 跨轮 Previous Intervention（Phase 3.1.1） ================ */

const REJECT_RE =
  /(^(不是|不对|并没有|也不是|没有|不是这样|不是的|不是这个意思|不完全是)|你说的不对|你说得不对|你说错了|你理解错|你想错了|你搞错|说反了|不是你说的)/;
/** 承认词（接住） */
const ACK_RE = /^[嗯啊哦]?[，,]?\s*(对|是的|对呀|对啊|没错|是这样|确实|有道理|说得对|你说得对)/;
/**
 * 「对观察表示兴趣」也算接住（CASE D：「这个还挺有意思的」）。
 * 但它仍然只是「接住但不展开」——不构成任何需要 AI 回答的问题。
 */
const INTEREST_RE = /(有意思|挺有意思|有趣|确实是|还真是|说不定|没想到|好像是这样|是这样啊|这么说来)/;
/** 解释 / 展开词 */
const EXPLAIN_RE = /(因为|其实|就是|那时候|我当时|我其实|原因是|说白了|我发现|我觉得|原来)/;
/** 继续讲原故事（忽略观察） */
const CONTINUE_STORY_RE = /^(后来|然后|接着|之后|结果|再后来|于是)|(我们就|他们就|她就|后来就|然后我|那天就)/;
/** 用户自己形成了「关于自己」的发现（最高保护） */
const USER_OWNED_DISCOVERY_RE =
  /(我突然(发现|意识到|明白)|我(现在)?才?(发现|意识到|明白)|原来我(其实|一直|是)|我好像(一直|总是|都)|现在想起来[^。！？]{0,10}(我觉得|我发现|我才)|我发现我(其实|一直|好像|总是)|我这才明白|我真的(发现|意识到))/;
/** 用户显式要求继续看（授权发现） */
const EXPLICIT_USER_DISCOVERY_RE =
  /(你刚才说的这个|这个我(还)?挺想(知道|听)|能不能再(帮我|给我)?(看看|看|说说|讲讲|讲一下)|再帮我(看看|看|想想)|我还想(再)?(知道|听|看)(更多|一点)?|还有(别的|什么)我(没|没有)(注意|意识|发现)|你再帮我看看)/;

/**
 * Phase 3.2.2 · Reflection Reception 确定性分类器（保守优先）。
 *
 * 判断用户如何回应上一轮 REFLECT。原则：
 *   - 不靠单一词机械决定：结合承认词 / 解释展开 / 是否继续故事 / active-expression；
 *   - 无法确定时默认 AMBIGUOUS（下游按 WAIT / DEESCALATE 处理），绝不 ASK。
 */
export function classifyReflectionReception(
  prev: LastInterventionState | null | undefined,
  userText: string,
  opts: { activeExpression?: ActiveExpressionState | null } = {},
): UserResponseToIntervention {
  if (!prev || !prev.candidate) return 'NONE';
  if (
    prev.candidate !== 'REFLECT_CANDIDATE' &&
    prev.candidate !== 'GENTLE_PUSH_CANDIDATE' &&
    prev.candidate !== 'ASK_CANDIDATE'
  ) {
    return 'NONE';
  }
  const t = (userText ?? '').trim();
  if (!t) return 'NONE';

  // 1) 明确否定 → 纠正恢复
  if (REJECT_RE.test(t)) return 'REJECTED';
  // 2) 用户显式要求继续看 → 授权发现
  if (EXPLICIT_USER_DISCOVERY_RE.test(t)) return 'EXPLICIT_USER_DISCOVERY';
  // 3) 用户自己形成「关于自己」的发现 → 最高保护
  if (USER_OWNED_DISCOVERY_RE.test(t)) return 'USER_OWNED_DISCOVERY';

  const hasAck = ACK_RE.test(t) || INTEREST_RE.test(t);
  const hasExplain = EXPLAIN_RE.test(t);
  const continuesStory = CONTINUE_STORY_RE.test(t);

  // 4) 接住并展开 / 接住但不展开
  if (hasAck && hasExplain) return 'PICKED_UP';
  if (hasAck) return 'PICKED_UP_NOT_EXPANDED';
  // 5) 自己接着展开（没有承认词，只有解释/展开）
  if (hasExplain) return 'SELF_EXPANDED';
  // 6) 忽略观察、继续讲原故事（或仍在连续表达）
  if (continuesStory || opts.activeExpression?.active) return 'CONTINUED';
  // 7) 最小回应
  if (isMinimalResponse(t)) return 'NOT_PICKED_UP';
  // 8) 无法确定 → 保守默认
  return 'AMBIGUOUS';
}

/** 兼容旧调用：判断用户对上一轮干预的回应 */
export function resolveUserResponseToIntervention(
  prev: LastInterventionState | null | undefined,
  userText: string,
  activeExpression?: ActiveExpressionState | null,
): UserResponseToIntervention {
  return classifyReflectionReception(prev, userText, { activeExpression });
}

/* ================ Intervention Decision（纯函数） ================ */

const AUTHORIZED_DISCOVERY_RE = new RegExp(
  [
    '(你|您)[^。！？]{0,8}(觉得|看|认为|想|说)[^。！？]{0,12}(我|这|这里|这段|这个故事)[^。！？]{0,14}(没注意|没有注意|没意识到|没有意识到|没察觉|没有察觉|没发现|没有发现|忽略|漏掉|看不到|没看到|没有看到|什么样|怎么样|怎样)',
    '(能不能|可不可以|能否)[^。！？]{0,12}(告诉|说说|讲讲|讲|说)[^。！？]{0,10}(我)[^。！？]{0,14}(没注意|没意识到|没察觉|没发现|忽略|漏掉)',
    '(从旁边|旁观|第三者|站在旁边)[^。！？]{0,12}(看|发现|注意|觉得)',
    '我(是|到底|这)?(是什么样|什么样|怎么样|怎样的|个什么)的人',
    '我这个人怎么样',
  ].join('|'),
);

const PERSONALITY_JUDGEMENT_RE = /什么样的人|是怎样的人|我是个什么|我这个人怎么样|我是什么样|我到底是个/;

export interface DecideInterventionInput {
  userText: string;
  discoverySignals: DiscoverySignal[];
  interruptionCost: InterruptionCostLevel;
  expressionWillingness?: WillingnessLevel;
  answeringWillingness?: WillingnessLevel;
  initiative?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  storyMaterial?: StoryMaterialLevel;
  storyFocus?: StoryFocusLevel;
  /** memory.meaning 是否已有意义条目 */
  hasMeaning?: boolean;
  /** 提问器本轮是否真的给出了高价值问题（best.story_value >= 4） */
  highValueQuestion?: boolean;
  /** 上一轮 AI 的候选决策 */
  priorInterventionCandidate?: InterventionCandidate | null;
  /** 用户对上一轮干预的回应（Phase 3.1.1） */
  userResponseToPrevious?: UserResponseToIntervention;
  /** 本轮跨轮 active-expression 状态（Phase 3.1.1，只记录） */
  activeExpression?: ActiveExpressionState;
}

/**
 * 只做内部候选决策，绝不修改用户可见回复。
 * 核心约束：Discovery HIGH 不得直接 ⇒ ASK；值得注意 ≠ 现在值得介入。
 */
export function decideIntervention(input: DecideInterventionInput): InterventionDecisionTrace {
  const signals = input.discoverySignals;
  const structuralValue = computeStructuralDiscoveryValue(signals);
  const selfValue = computeSelfDiscoveryValue(signals);
  const value = structuralValue;
  const userOwned = signals.some((s) => s.detected && s.userOwned);
  const selfNamedCore = signals.some((s) => s.detected && s.type === 'SELF_NAMED_CORE');
  const authorized = AUTHORIZED_DISCOVERY_RE.test(input.userText);
  const interruptionCost = input.interruptionCost;
  const initiative = input.initiative ?? 'MEDIUM';
  const answering = input.answeringWillingness ?? 'MEDIUM';
  const prior = input.priorInterventionCandidate ?? null;
  const resp = input.userResponseToPrevious ?? 'NONE';
  const reasons: string[] = [];
  const blocked: string[] = [];
  let candidate: InterventionCandidate = 'WAIT';
  let futureHint: FutureDecisionHint = 'STAY';
  let handledByPrevious = false;

  /* ---- 0) 上一轮干预的回应（跨轮，最高优先） ---- */
  if (prior === 'REFLECT_CANDIDATE' || prior === 'GENTLE_PUSH_CANDIDATE' || prior === 'ASK_CANDIDATE') {
    if (resp === 'REJECTED') {
      candidate = 'WAIT';
      reasons.push('上一轮干预被用户明确否定 → 以用户陈述为准（交给既有 Correction Recovery），本层不再分析');
      blocked.push('REFLECT_CANDIDATE 被拦：用户已否定，不得再照一次');
      blocked.push('ASK_CANDIDATE 被拦：用户已否定');
      handledByPrevious = true;
    } else if (resp === 'USER_OWNED_DISCOVERY') {
      candidate = 'ACKNOWLEDGE';
      reasons.push('用户自己形成了「关于自己」的发现 → 只确认，绝不重新解释、不追问');
      blocked.push('REFLECT_CANDIDATE 被拦：发现权已属于用户');
      blocked.push('ASK_CANDIDATE 被拦：用户已自己发现');
      handledByPrevious = true;
    } else if (
      resp === 'PICKED_UP' ||
      resp === 'PICKED_UP_NOT_EXPANDED' ||
      resp === 'SELF_EXPANDED' ||
      resp === 'CONTINUED' ||
      resp === 'NOT_PICKED_UP' ||
      resp === 'AMBIGUOUS'
    ) {
      // 用户已经回应过这一轮观察 → AI 退开（不解释、不再照、不追问）
      candidate = 'WAIT';
      if (resp === 'NOT_PICKED_UP' || resp === 'AMBIGUOUS') futureHint = 'STOP';
      reasons.push(`用户已回应上一轮 REFLECT（${resp}）→ AI 退开，把解释权交回用户`);
      blocked.push('REFLECT_CANDIDATE 被拦：上一轮观察已交给用户');
      blocked.push('ASK_CANDIDATE 被拦：不得把 REFLECT 变成追问');
      handledByPrevious = true;
    }
    // EXPLICIT_USER_DISCOVERY → 允许基于已有 evidence 再做一次观察（不在此处理）
  }
  // 兼容：测试/调用方只给 candidate、没给 userResponse 时，用最小回应兜底
  if (!handledByPrevious && prior === 'REFLECT_CANDIDATE' && isMinimalResponse(input.userText)) {
    candidate = 'WAIT';
    futureHint = 'STOP';
    reasons.push('上一轮是 REFLECT，本轮用户只给了最小回应 → 没有接住反思');
    blocked.push('后续连续追问被禁止：用户没接住 Reflection 时不得再问');
    handledByPrevious = true;
  }

  /* ---- 0.5) 跨轮 active-expression：仍在连续表达 → 一律 WAIT（最高优先，用户表达优先） ---- */
  if (!handledByPrevious && input.activeExpression?.active) {
    candidate = 'WAIT';
    reasons.push('用户仍在连续表达（active-expression）→ 不介入，等他讲完');
    blocked.push('REFLECT_CANDIDATE 被拦：用户正在连续表达');
    blocked.push('ASK_CANDIDATE 被拦：用户正在连续表达');
    blocked.push('ACKNOWLEDGE 被拦：用户还在表达时优先什么都不做');
    handledByPrevious = true;
  }

  /* ---- 0.6) 用户自己已经发现 / 已经指认核心 → 用户停止表达后才 ACK ---- */
  if (!handledByPrevious && userOwned) {
    candidate = 'ACKNOWLEDGE';
    reasons.push('用户已停止表达且存在 user-owned discovery → 只确认，不重新解释');
    blocked.push('REFLECT_CANDIDATE 被拦：发现权已属于用户');
    blocked.push('ASK_CANDIDATE 被拦：不得把用户已说出的自我发现再解释为心理结论');
    handledByPrevious = true;
  }

  /* ---- 1) 用户正在主动表达 / 打断成本高 → WAIT（即使 Discovery HIGH） ---- */
  if (!handledByPrevious) {
    if (interruptionCost === 'HIGH') {
      candidate = 'WAIT';
      reasons.push('Interruption Cost HIGH → 优先等待用户表达，不介入');
      blocked.push('REFLECT_CANDIDATE 被拦：用户正在主动表达');
      blocked.push('ASK_CANDIDATE 被拦：会打断用户正在形成的表达');
    }
    // 2) 回答意愿低 → 不逼问
    else if (answering === 'LOW' && !authorized) {
      candidate = 'ACKNOWLEDGE';
      reasons.push('回答意愿 LOW → 不逼问，只接住');
      blocked.push('ASK_CANDIDATE 被拦：回答意愿低');
    }
    // 4) 结构性发现价值低
    else if (value === 'LOW') {
      const factualChoice = input.storyMaterial === 'HIGH' && !input.hasMeaning && !selfNamedCore;
      if (factualChoice) {
        if (input.highValueQuestion && !userOwned) {
          candidate = 'ASK_CANDIDATE';
          reasons.push('材料完整但尚未选定核心/画面，且存在一个具体高价值问题 → 记录 ASK_CANDIDATE');
          blocked.push('本阶段 ASK_CANDIDATE 只记录、不真正发问（不进入生产回复链）');
        } else {
          candidate = 'GENTLE_PUSH_CANDIDATE';
          reasons.push('事实材料多但意义缺失 → 轻轻把选择权交还用户（什么值得留下），不继续追问事实');
        }
      } else {
        candidate = 'WAIT';
        reasons.push('没有值得注意的结构 → 不为了证明 AI 有能力而强行介入');
        blocked.push('ASK_CANDIDATE 被拦：无发现价值');
      }
    }
    // 5) 中等结构性价值
    else if (value === 'MEDIUM') {
      if (authorized) {
        candidate = 'REFLECT_CANDIDATE';
        reasons.push('中等发现 + 用户已授权发现 → 可主动 REFLECT（一次一点，还解释权）');
      } else {
        candidate = 'WAIT';
        reasons.push('发现价值 MEDIUM，不足以支撑一次介入 → 先等待');
        blocked.push('REFLECT_CANDIDATE 被拦：价值不够高');
      }
    }
    // 6) 高结构性价值、非 user-owned、低打断成本 → REFLECT（指出即停），绝不默认 ASK
    else {
      candidate = 'REFLECT_CANDIDATE';
      reasons.push(
        authorized
          ? '高发现价值 + 用户授权发现 → REFLECT（一次一个观察点，把解释权还给用户）'
          : '高发现价值 + 用户已停止 + 非 user-owned → REFLECT（指出这个结构，然后停）',
      );
      blocked.push('ASK_CANDIDATE 被拦：REFLECT 的介入成本低于追问，本层优先 REFLECT');
    }
  }

  // 用户授权发现的额外标注
  if (authorized) {
    reasons.push('用户显式授权 AI 主动发现（AUTHORIZED_DISCOVERY）');
    if (PERSONALITY_JUDGEMENT_RE.test(input.userText)) {
      blocked.push('不得根据单一故事给人格定论；从「人格判断」转向「故事中的自我发现」');
    }
  }

  // 行为顺序的红线标注：只记顺序，不转人格
  if (signals.some((s) => s.detected && s.type === 'BEHAVIOR_SEQUENCE')) {
    blocked.push('BEHAVIOR_SEQUENCE 只记录行为顺序，禁止转换成「你很懂事 / 讨好型人格」');
  }

  return {
    discoverySignals: signals,
    structuralDiscoveryValue: structuralValue,
    selfDiscoveryValue: selfValue,
    discoveryValue: value,
    interruptionCost,
    userInitiative: initiative,
    userOwnedDiscovery: userOwned,
    explicitDiscoveryRequest: authorized,
    storyReadinessAction: 'CONTINUE', // 由调用方覆盖
    interventionCandidate: candidate,
    reasons,
    blockedActions: blocked,
    futureDecisionHint: futureHint,
    previousIntervention: prior,
    activeExpression: input.activeExpression,
    userResponseToPrevious: resp,
  };
}

/* ================ 组合入口（供 runTurn 接线） ================ */

export interface RunInterventionAnalysisInput {
  userText: string;
  understanding: Understanding;
  memory: StoryMemory;
  /** 基础打断成本（来自 classifyInterruptionCost）；本函数会用跨轮状态修正后再决策 */
  interruptionCost: InterruptionCostLevel;
  /** Phase 3.1.1：本轮跨轮 active-expression（已由 runTurn 更新） */
  activeExpression?: ActiveExpressionState;
  /** Phase 3.1.1：上一轮 AI 的干预候选 */
  priorIntervention?: LastInterventionState | null;
  /** 提问器本轮是否给出高价值问题 */
  highValueQuestion?: boolean;
  storyMaterial?: StoryMaterialLevel;
  storyFocus?: StoryFocusLevel;
  hasMeaning?: boolean;
  storyReadinessAction?: 'CONTINUE' | 'OFFER_GENERATION' | 'GENERATE' | 'WAIT_FOR_USER';
  sourceMessageIds?: string[];
}

/** 在 runTurn 中调用：检测发现 → 跨轮修正打断成本 → 判定上一轮回应 → 决定候选。 */
export function runInterventionAnalysis(input: RunInterventionAnalysisInput): InterventionDecisionTrace {
  const signals = detectDiscoverySignals({
    userText: input.userText,
    understanding: input.understanding,
    memory: input.memory,
    sourceMessageIds: input.sourceMessageIds,
  });
  const effectiveCost = refineInterruptionCost(input.interruptionCost, input.activeExpression);
  const userResponseToPrevious = classifyReflectionReception(input.priorIntervention ?? null, input.userText, {
    activeExpression: input.activeExpression,
  });
  const trace = decideIntervention({
    userText: input.userText,
    discoverySignals: signals,
    interruptionCost: effectiveCost,
    expressionWillingness: input.understanding.userState?.expressionWillingness,
    answeringWillingness: input.understanding.userState?.answeringWillingness,
    initiative: input.understanding.userState?.initiative,
    storyMaterial: input.storyMaterial,
    storyFocus: input.storyFocus,
    hasMeaning: input.hasMeaning,
    highValueQuestion: input.highValueQuestion,
    priorInterventionCandidate: input.priorIntervention?.candidate ?? null,
    userResponseToPrevious,
    activeExpression: input.activeExpression,
  });
  // Phase 3.2.3：GENTLE PUSH 决策（只建立在上一轮 REFLECT + 本轮接住之上）
  const gentlePush = evaluateGentlePush({
    priorCandidate: input.priorIntervention?.candidate ?? null,
    priorDiscoveryType: input.priorIntervention?.discoveryType ?? null,
    reception: userResponseToPrevious,
    activeExpression: input.activeExpression,
    interruptionCost: effectiveCost,
    emotionIntensity: input.understanding.signals?.emotionalIntensity,
    userInitiative: input.understanding.userState?.initiative,
  });

  return {
    ...trace,
    reflectionReception: userResponseToPrevious,
    gentlePush,
    storyReadinessAction: input.storyReadinessAction ?? 'CONTINUE',
  };
}

/* ================ REFLECT 真实回复层（Phase 3.2.1） ================ */

/** 一次只 REFLECT 一个 discovery；按「最简单、最容易一句话指出」排序，不追求最深。 */
const REFLECT_PREFERENCE: DiscoveryType[] = ['REPETITION', 'CONTRAST', 'BEFORE_AFTER', 'BEHAVIOR_SEQUENCE'];

/** REFLECT 语言红线：禁止对「人」下解释 / 人格判断 / 动机推断 / 因果推断。 */
const REFLECT_FORBIDDEN_RE =
  /(这说明你|其实你是|你本质上|这反映出你的|你属于|你应该是因为|是不是因为|我觉得你|你看起来是一个|你有点|你比较|你害怕|你缺爱|讨好型|所以你其实|看来你|可见你)/;
/** 片段本身不安全（会诱导心理解释）→ 宁可不 REFLECT。 */
const FRAGMENT_UNSAFE_RE = /(其实你|这说明|你本质上|你很|你属于|你是不是|你有点|你比较|你害怕|你缺|讨好型|你总是|你从来|你应该)/;

function clip(text: string, max: number): string {
  const t = (text ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function quote(fragment: string): string {
  return `「${clip(fragment, 20)}」`;
}

/**
 * 选出「本轮唯一一个」可以安全 REFLECT 的发现。
 * 只允许结构性发现（REPETITION / CONTRAST / BEFORE_AFTER / BEHAVIOR_SEQUENCE），
 * 且 evidence 必须逐字来自用户原话、片段本身安全。
 */
export function selectReflectSignal(signals: DiscoverySignal[], userText: string): DiscoverySignal | null {
  const text = userText ?? '';
  for (const type of REFLECT_PREFERENCE) {
    const signal = signals.find((s) => s.detected && s.type === type && s.confidence !== 'LOW');
    if (!signal) continue;
    const grounded = signal.evidence.filter((e) => e && text.includes(e) && !FRAGMENT_UNSAFE_RE.test(e));
    if (grounded.length === 0) continue;
    return { ...signal, evidence: grounded };
  }
  return null;
}

/**
 * 确定性 REFLECT 文本生成：只用模板 + 用户原话片段。
 * 不解释意义、不提人格、不问问题、不制造因果、不添加新事实。
 * 无法安全生成时返回 null（调用方降级为 WAIT / ACKNOWLEDGE）。
 */
export function buildReflectText(signal: DiscoverySignal, userText: string): string | null {
  const ev = signal.evidence.filter((e) => e && userText.includes(e) && !FRAGMENT_UNSAFE_RE.test(e));
  if (ev.length === 0) return null;
  let text: string | null = null;
  switch (signal.type) {
    case 'CONTRAST':
      if (ev.length < 2) return null;
      text = `你刚才一边说${quote(ev[0])}，一边又说${quote(ev[1])}。这两个地方放在一起，还挺有意思的。`;
      break;
    case 'REPETITION':
      text = `我注意到你刚才前后几次都提到了${quote(ev[0])}。`;
      break;
    case 'BEFORE_AFTER':
      if (ev.length < 2) return null;
      text = `你前面说${quote(ev[0])}，后面又提到${quote(ev[1])}。这个变化我注意到了。`;
      break;
    case 'BEHAVIOR_SEQUENCE':
      if (ev.length < 2) return null;
      text = `你刚才先说${quote(ev[0])}，后面马上又做了${quote(ev[1])}。这个顺序我注意到了。`;
      break;
    default:
      return null;
  }
  if (!text) return null;
  // 收尾自检：不得出现问句、不得出现对人的解释 / 人格判断
  if (/[？?]/.test(text)) return null;
  if (REFLECT_FORBIDDEN_RE.test(text)) return null;
  return text;
}

export interface ReflectContext {
  /** 本轮跨轮 active-expression（active 时永远阻断 REFLECT） */
  activeExpression?: ActiveExpressionState | null;
  /** 上一轮 AI 的干预候选（同一 discovery 不连续 REFLECT） */
  priorIntervention?: LastInterventionState | null;
}

export interface ReflectReplyResult {
  reply: string;
  signal: DiscoverySignal;
}

/**
 * REFLECT 门控：只有同时满足所有条件才产出真实回复，否则返回 null（保持原行为）。
 *   1. interventionCandidate === REFLECT_CANDIDATE
 *   2. interruptionCost !== HIGH
 *   3. activeExpression.active !== true
 *   4. userOwnedDiscovery !== true
 *   5. 存在一个高置信度、可引用的结构性 DiscoverySignal
 *   6. 同一个 discovery 不在连续两轮重复 REFLECT
 * 更高优先级（correction / session end / cancel / refusal）由 runTurn 的分支顺序保证。
 */
export function buildReflectReply(
  trace: InterventionDecisionTrace,
  userText: string,
  ctx: ReflectContext = {},
): ReflectReplyResult | null {
  if (trace.interventionCandidate !== 'REFLECT_CANDIDATE') return null;
  if (trace.interruptionCost === 'HIGH') return null;
  if (ctx.activeExpression?.active) return null;
  if (trace.userOwnedDiscovery) return null;

  const signal = selectReflectSignal(trace.discoverySignals, userText);
  if (!signal) return null;

  const prev = ctx.priorIntervention;
  if (prev?.candidate === 'REFLECT_CANDIDATE' && prev.discoveryType === signal.type) return null;

  const reply = buildReflectText(signal, userText);
  if (!reply) return null;
  return { reply, signal };
}

/* ================ GENTLE PUSH（Phase 3.2.3） ================ */

/**
 * GENTLE PUSH 语言红线：
 * 不得提问、不得心理解释 / 人格判断 / 因果推断 / 替用户命名尚未被用户自己命名的心理状态。
 */
const GENTLE_PUSH_FORBIDDEN_RE =
  /([？?]|为什么|是不是|你觉得|你认为|你当时是什么感受|能不能说说|能不能讲讲|愿不愿意|要不要说|说明你|看来你|你其实|你是一个|你本质上|这反映出你|因为|所以|导致|意味着)/;

export interface GentlePushInput {
  /** 上一轮 AI 的干预候选（只有 REFLECT_CANDIDATE 才允许 GENTLE PUSH） */
  priorCandidate?: InterventionCandidate | null;
  /** 上一轮被 REFLECT 的 discovery 类型（仅用于追踪，不参与判定） */
  priorDiscoveryType?: DiscoveryType | null;
  /** 本轮 Reflection Reception */
  reception: UserResponseToIntervention;
  activeExpression?: ActiveExpressionState | null;
  interruptionCost: InterruptionCostLevel;
  /** 0~1：强情绪时不强行推动 */
  emotionIntensity?: number;
  userInitiative?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

export interface GentlePushDecision {
  allowed: boolean;
  reason: string;
  text: string | null;
}

/**
 * GENTLE PUSH 决策（确定性）。
 * 它**不重新扫描 discoverySignals**，只使用「上一轮已 REFLECT 的 discovery + 本轮 Reception + 当前状态」。
 */
export function evaluateGentlePush(input: GentlePushInput): GentlePushDecision {
  const deny = (reason: string): GentlePushDecision => ({ allowed: false, reason, text: null });

  // 1) 只允许建立在「上一轮已经 REFLECT」之上（不能 Discovery → GENTLE_PUSH）
  if (input.priorCandidate !== 'REFLECT_CANDIDATE') {
    return deny('上一轮不是 REFLECT → 不得 GENTLE PUSH（必须先 Discovery → REFLECT → Reception）');
  }
  // 2) 只有「接住」才允许推动
  if (
    input.reception !== 'PICKED_UP' &&
    input.reception !== 'PICKED_UP_NOT_EXPANDED' &&
    input.reception !== 'EXPLICIT_USER_DISCOVERY'
  ) {
    return deny(`Reception=${input.reception} 不属于「接住」→ 不推动`);
  }
  // 3) 用户已重新开始连续表达 → 永远优先 WAIT
  if (input.activeExpression?.active) {
    return deny('用户正在连续表达（active-expression）→ 不介入');
  }
  // 4) 打断成本高 → 不推动
  if (input.interruptionCost === 'HIGH') {
    return deny('打断成本 HIGH → 不推动');
  }
  // 5) 强情绪 → 不强行推动
  if ((input.emotionIntensity ?? 0) >= 0.6) {
    return deny('情绪强度高 → 不强行推动');
  }
  // 6) 用户本来就在主动推进 → 不需要我们推
  if (input.userInitiative === 'HIGH' || input.userInitiative === 'VERY_HIGH') {
    return deny('用户主动性强 → 不需要推动');
  }

  const text =
    input.reception === 'PICKED_UP_NOT_EXPANDED'
      ? '嗯。刚才那个地方，你要是还想接着说，我就在这儿听着。'
      : '好，我听着。刚才那个地方，你想接着说的时候就说。';

  // 7) 收尾自检：不得提问 / 不得解释 / 不得命名用户心理状态
  if (!text) return deny('没有可用的安全话术');
  if (GENTLE_PUSH_FORBIDDEN_RE.test(text)) return deny('话术命中语言红线 → 返回 WAIT');

  return { allowed: true, reason: `用户接住（${input.reception}）且没有打断风险 → 轻轻把注意力交还用户`, text };
}

/** 便捷入口：直接拿文本（不可用则 null） */
export function buildGentlePush(input: GentlePushInput): string | null {
  const decision = evaluateGentlePush(input);
  return decision.allowed ? decision.text : null;
}

/* ================ ASK Candidate（Phase 3.2.4-A，只决策不执行） ================ */

/** 纯资料型问题（时间 / 地点 / 人物 / 次数 / 数量）→ LOW：只是为了补齐故事信息 */
const FACT_QUESTION_RE =
  /(什么时候|哪一年|哪年|哪一天|几点|多久|多长时间|多长时间|在哪儿|在哪里|哪儿|哪里|叫什么|什么名字|名字是|是谁|都有谁|几个人|几次|多大|几岁|什么颜色|什么样子|穿什么|吃了什么|在做什么)/;
/*
 * Phase 3.2.4-B.1.x H2.2-A：删除独立的「主线问题」词表。
 * 它的角色改由 classifyQuestionIntent（Question Intent → Value Dimension）承担，
 * 使「价值判定」与「执行模板」共用同一套语义，不再各说一套词。
 */
/** AI 自己的心理 / 因果推断式提问 → 一律 NO_ASK */
const AI_INFERENCE_QUESTION_RE = /(是不是因为|是不是你|你其实|你内心|你真正|说明你|看得出你|你骨子里|导致你|所以你才)/;

/* ---------- Phase 3.2.4-B.1.x H2.2-A · Question Intent → Value Dimension ---------- */

/**
 * 价值维度：与三个 Execution 方向一一对应。
 * 这层存在的意义是让「价值判定」与「实际执行的问题」共用同一套语义，
 * 而不是各自维护一套关键词。
 */
export type QuestionValueDimension = 'STRUCTURAL' | 'RELATIONAL' | 'MEANING';

/** Question Intent(direction) → Value Dimension → Execution Question 的一致映射 */
export const DIRECTION_VALUE_DIMENSION: Record<AskDirection, QuestionValueDimension> = {
  CHANGE: 'STRUCTURAL',
  RELATIONSHIP: 'RELATIONAL',
  UNDERSTANDING: 'MEANING',
};

/** 一个问题文本所承载的价值维度（无法判定 → null，不猜） */
export function valueDimensionOfQuestion(question: string): QuestionValueDimension | null {
  const intent = classifyQuestionIntent(question ?? '');
  return intent ? DIRECTION_VALUE_DIMENSION[intent] : null;
}

/** 一个可执行方向所对应的价值维度 */
export function valueDimensionOfDirection(direction: AskDirection | null): QuestionValueDimension | null {
  return direction ? DIRECTION_VALUE_DIMENSION[direction] : null;
}

/**
 * 确定性 Question Value 判定：
 *   HIGH：问题承载明确价值维度（结构 / 关系 / 意义）+ 目标重要 + 提问器也认为有价值；
 *   MEDIUM：能丰富故事，但用户也可能自然讲出来；
 *   LOW：主要为补充背景 / 事实细节 / 完整度。
 *
 * H2.2-A：mainline 判定改用与 Execution 同源的 Question Intent（valueDimensionOfQuestion），
 * 因此系统能够正确评价它自己实际会问出的三句模板。HIGH 仍需要 strongTarget + story_value≥4
 * 两道独立门槛，不是「命中关键词即 HIGH」。
 */
export function classifyQuestionValue(input: {
  question?: string;
  targetClue?: string;
  clues?: Clue[];
  /** 提问器给出的 story_value（复用已有信号，不新增 LLM） */
  questionerValue?: number;
}): DiscoveryValueLevel {
  const question = (input.question ?? '').trim();
  const targetText = (input.targetClue ?? '').trim();
  const clues = input.clues ?? [];
  const clue = clues.find(
    (c) => c.text && (c.text === targetText || (targetText && c.text.includes(targetText)) || (targetText && targetText.includes(c.text))),
  );
  const kind = clue?.kind;
  const importance = clue?.importance ?? 0;

  // 资料型问题（或目标线索本身就是资料）→ LOW
  if (FACT_QUESTION_RE.test(question) || FACT_QUESTION_RE.test(targetText)) return 'LOW';

  const mainlineTarget = kind === 'turning_point' || kind === 'meaning' || kind === 'open_thread';
  const strongTarget = mainlineTarget && importance >= 3;
  // 只有承载明确价值维度的问题才算「主线型问题」
  const carriesValueDimension = valueDimensionOfQuestion(question) !== null;

  if (strongTarget && carriesValueDimension && (input.questionerValue ?? 0) >= 4) return 'HIGH';
  if (strongTarget) return 'MEDIUM';
  if (carriesValueDimension && (input.questionerValue ?? 0) >= 4) return 'MEDIUM';
  return 'MEDIUM';
}

/* ---------- Fresh Narrative Contribution（Phase 3.2.4-A.2） ---------- */

/** 叙事推进词（时间/因果推进，而不是单纯时间指代） */
const NARRATIVE_ADVANCE_RE = /(然后|后来|接着|之后|结果|于是|第二天|再后来|从那以后)/;
/** 人物 + 行动推进（新的故事事实） */
const NARRATIVE_ACTION_RE =
  /(我们|我|他|她|他们|大家|老师|同学|妈|爸|奶奶|外婆)[^。！？]{0,10}(去了|走了|回了|来了|见了|说了|做了|开始|离开|回去|回家|一起去|一起回|拿着|站在|坐下|跑)/;
/** 用户明确把控制权交给 AI（不算「没交给 AI」） */
const HANDOFF_RE = /(你说呢|你觉得呢|你怎么想|你问吧|我讲完了|就这些|说完了|讲完了)/;
const NARRATIVE_CLUE_KINDS = ['event', 'turning_point', 'person', 'detail'];

export interface FreshNarrativeInput {
  userText: string;
  activeExpression?: ActiveExpressionState | null;
  /** 上一轮干预后的回应（CONTINUED = 继续讲原故事） */
  reception?: UserResponseToIntervention;
  /** 本轮理解层抽到的线索（用于判断是否新增叙事内容） */
  newClues?: { kind?: string; importance?: number }[];
}

/**
 * 判断「用户刚刚是否给出了一个新的故事推进，且没有明确把控制权交给 AI」。
 * 默认保守：不确定 → true（视为仍在推进 → 不提问）。
 */
export function detectFreshNarrativeContribution(input: FreshNarrativeInput): { value: boolean; reason: string } {
  const t = (input.userText ?? '').trim();
  if (!t) return { value: false, reason: '空输入 → 不视为新叙述' };
  if (/[？?]/.test(t)) return { value: false, reason: '用户在提问，不是叙述推进' };
  if (HANDOFF_RE.test(t)) return { value: false, reason: '用户明确把控制权交给 AI' };
  if (input.activeExpression?.active) return { value: true, reason: '仍在连续表达' };
  if (input.reception === 'CONTINUED') return { value: true, reason: '用户正在继续原故事' };
  if (NARRATIVE_ADVANCE_RE.test(t)) return { value: true, reason: '出现叙事推进词' };
  if (NARRATIVE_ACTION_RE.test(t)) return { value: true, reason: '出现人物 / 行动推进' };
  const narrativeClues = (input.newClues ?? []).filter(
    (c) => c.kind && NARRATIVE_CLUE_KINDS.includes(c.kind) && (c.importance ?? 0) >= 3,
  );
  if (narrativeClues.length > 0) return { value: true, reason: '本轮抽到了新的叙事线索' };
  if (input.activeExpression?.lastNaturalStop) return { value: false, reason: '自然停顿，且没有新的故事推进' };
  return { value: true, reason: '不确定是否还会继续讲 → 保守视为推进' };
}

/* ---------- Timing Value（Phase 3.2.4-A.2） ---------- */

export type TimingValueLevel = 'HIGH' | 'LOW';

export interface TimingValueInput {
  freshNarrativeContribution: boolean;
  activeExpression?: ActiveExpressionState | null;
  /** 候选目标是否为「用户已打开、但尚未自然展开」的重要线索 */
  targetIsUnresolvedThread: boolean;
  /** 用户是否表现出愿意继续处理该方向 */
  userReadiness: boolean;
}

/**
 * Timing Value 必须来自**正向证据**：自然停顿 + 未展开的重要线索 + 用户愿意继续。
 * 只是「没有坏情况」不足以构成 HIGH。
 */
export function evaluateTimingValue(input: TimingValueInput): { value: TimingValueLevel; reason: string } {
  if (input.freshNarrativeContribution) return { value: 'LOW', reason: '用户刚刚推进了故事 → 现在不是提问时机' };
  if (input.activeExpression?.active) return { value: 'LOW', reason: '用户仍在连续表达' };
  if (input.activeExpression?.lastNaturalStop !== true) return { value: 'LOW', reason: '没有出现明确的自然停顿' };
  if (!input.targetIsUnresolvedThread) return { value: 'LOW', reason: '目标不是「已打开但未展开」的重要线索' };
  if (!input.userReadiness) return { value: 'LOW', reason: '用户没有表现出愿意继续处理该方向' };
  return { value: 'HIGH', reason: '自然停顿 + 未展开的重要线索 + 用户愿意继续 → 时机成立' };
}

/* ---------- ASK Candidate ---------- */

/* ---------- Phase 3.2.4-B.1.x H2.2-B · 已表达意义不再索取 ---------- */

/**
 * 用户「自己把意义说出来」的语言标志。
 * 只关心「这个意义是否已被用户自己说出」，不关心「系统之前有没有出现过 meaning clue」。
 */
const USER_STATED_MEANING_RE =
  /(对我来说|对我而言|对我来讲|意味着|说白了|就是一种|那是一种|算是一种|我明白了|我懂了|我想通了|我想明白了|我发现|我意识到|我才明白|才意识到|后来才明白|原来是)/;

/**
 * 该意义是否已经由用户自己明确表达（材料来自 clue.text + clue.evidence，两者都锚定用户原话）。
 * 保守：证据不足 → false（不误判为已回答）。
 */
export function isMeaningAlreadyVoicedByUser(material: string): boolean {
  const t = (material ?? '').trim();
  if (!t) return false;
  return USER_STATED_MEANING_RE.test(t);
}

/* ---------- Phase 3.2.4-B.1.x H2.2-C · 同方向重复 ASK 去重 ---------- */

/** 能够代表「新增故事材料」的线索类型（emotion / quote 这类噪声不算） */
const MATERIAL_CLUE_KINDS = ['event', 'turning_point', 'person', 'detail', 'meaning', 'open_thread'];

export interface RepeatAskInput {
  priorCandidate?: InterventionCandidate | null;
  /** 上一轮 ASK 实际执行的方向（H2.2-C 新增跨轮记录） */
  priorDirection?: AskDirection | null;
  /** 上一轮 ASK 共享的 target clue 文本 */
  priorTargetClueText?: string | null;
  /** 本轮将执行的方向与 target clue */
  direction: AskDirection | null;
  targetClueText: string | null;
  /** 本轮用户对上一轮 ASK 的回应 */
  reception?: UserResponseToIntervention;
  /** 本轮新抽到的重要线索数（≥3 且为实质材料类型） */
  newMaterialClueCount?: number;
  activeExpression?: ActiveExpressionState | null;
}

/**
 * 是否属于「机械重复」：上一轮已问过 **同一方向 + 同一 target clue**，且本轮没有任何新增材料。
 * 不机械禁止同方向：方向不同 / 线索已变 / 用户给出新材料（或主动展开）→ 一律允许重新评估。
 */
export function classifyRepeatAsk(input: RepeatAskInput): { repeat: boolean; reason: string } {
  if (input.priorCandidate !== 'ASK_CANDIDATE') return { repeat: false, reason: '上一轮不是 ASK' };
  if (!input.direction) return { repeat: false, reason: '本轮没有可执行方向' };
  if (!input.priorDirection || input.priorDirection !== input.direction) {
    return { repeat: false, reason: '方向与上一轮不同 → 不算重复' };
  }
  if (!input.priorTargetClueText || !input.targetClueText) {
    return { repeat: false, reason: '缺少可比对的 target clue → 保守不判重复' };
  }
  if (input.priorTargetClueText !== input.targetClueText) {
    return { repeat: false, reason: 'target clue 已变化 → 不算重复' };
  }
  const newMaterial =
    (input.newMaterialClueCount ?? 0) > 0 ||
    input.reception === 'PICKED_UP' ||
    input.reception === 'SELF_EXPANDED' ||
    input.reception === 'CONTINUED' ||
    input.reception === 'USER_OWNED_DISCOVERY' ||
    input.activeExpression?.active === true;
  if (newMaterial) return { repeat: false, reason: '用户给出了新的材料 / 主动展开 → 允许重新评估' };
  return { repeat: true, reason: `上一轮 ${input.priorDirection} 且同一 target clue、本轮无新增材料 → 阻止机械重复` };
}

/** 本轮是否抽到了实质性的新线索（供 RepeatAskInput 使用） */
export function countNewMaterialClues(
  clues?: { kind?: string; importance?: number }[] | null,
): number {
  return (clues ?? []).filter((c) => c.kind && MATERIAL_CLUE_KINDS.includes(c.kind) && (c.importance ?? 0) >= 3).length;
}

export interface AskCandidateInput {
  /** Question Value（只有 HIGH 才可能 allowed） */
  value: DiscoveryValueLevel;
  /** Timing Value（Phase 3.2.4-A.2：必须 HIGH） */
  timingValue: TimingValueLevel;
  /** 用户刚刚是否推进了故事（Phase 3.2.4-A.2） */
  freshNarrativeContribution?: boolean;
  /** Phase 3.2.4-B.1.x H2.1：目标 clue（Candidate 与 Execution 共享的语义锚点） */
  clue?: { kind?: string; text?: string; evidence?: string } | null;
  /** Phase 3.2.4-B.1.x H2.1：被证明有价值的那句提问器问题（用于判断 question intent） */
  question?: string;
  activeExpression?: ActiveExpressionState | null;
  interruptionCost: InterruptionCostLevel;
  emotionIntensity?: number;
  userInitiative?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  userOwnedDiscovery?: boolean;
  refusal?: boolean;
  correction?: boolean;
  /** 用户正在主动继续原故事 */
  continuedStory?: boolean;
  /** 刚刚发生的干预（REFLECT / GENTLE_PUSH / ASK 本身）→ 保护期内 NO_ASK */
  priorCandidate?: InterventionCandidate | null;
  /** H2.2-C：上一轮 ASK 的方向 / 共享 target clue（用于判断机械重复） */
  priorDirection?: AskDirection | null;
  priorTargetClueText?: string | null;
  /** H2.2-C：本轮用户对上一轮干预的回应 */
  reception?: UserResponseToIntervention;
  /** H2.2-C：本轮新抽到的实质线索数 */
  newMaterialClueCount?: number;
  /** 是否有明确的「上一轮用户材料」 */
  hasPriorMaterial?: boolean;
  /** 问题是否来源于用户已经说出的材料 */
  groundedInUserMaterial?: boolean;
  /** 问题是否依赖 AI 自己的心理 / 因果推断 */
  dependsOnAiInference?: boolean;
}

export interface AskCandidateDecision {
  value: DiscoveryValueLevel;
  timingValue: TimingValueLevel;
  freshNarrativeContribution: boolean;
  allowed: boolean;
  reason: string;
  /* ---- Phase 3.2.4-B.1.x H2.1 · Candidate → Execution 共享的语义契约 ---- */
  /** 目标 clue 文本（Invariant 1：Candidate 与 Execution 共享同一个 target clue） */
  targetClueText: string | null;
  /** Candidate 阶段一次性确定的 direction（Invariant 4：Execution 不再重新推断） */
  direction: AskDirection | null;
  /** 被证明有价值的那个问题所表达的 intent（null = 无法确定性判定） */
  questionIntent: AskDirection | null;
  /** 问题语义与将执行方向是否一致（Invariant 2/3/5） */
  aligned: boolean;
  /** H2.3.1：target 是否已经回答了这个问题（Question Progression） */
  questionProgression: QuestionProgressionDecision;
}

/* ---------- Phase 3.2.4-B.1.x H2.1 · Question Intent & Alignment ---------- */

/**
 * 从「提问器问题文本」确定性判定它的 question intent。
 * 无法判定 → null（不猜）。
 * 注意：这与 classifyAskDirection（看 clue 的材料证据）是**两件事**：
 * 本函数看的是「问题想问哪一类东西」。
 */
export function classifyQuestionIntent(question: string): AskDirection | null {
  const t = (question ?? '').trim();
  if (!t) return null;
  if (/(你们|我们|咱们|之间|关系|联系|相处|来往)/.test(t)) return 'RELATIONSHIP';
  if (/(意味着|对你来说|发现|明白|意识到|理解|意义|算什么)/.test(t)) return 'UNDERSTANDING';
  if (/(变|改变|变化|转折|不一样|开始变)/.test(t)) return 'CHANGE';
  return null;
}

/**
 * 对齐判定（H2.1 核心不变量）：
 *   - direction 为 null          → 没有可执行方向 → 不对齐（Candidate 不得放行）
 *   - questionIntent 为 null      → 无法从文本判定意图；此时以「同一个 target clue」为可靠映射依据，视为对齐
 *   - questionIntent === direction → 对齐
 *   - 其余（可判定且不同）         → 语义漂移 → 不对齐
 */
export function isAlignedToDirection(
  questionIntent: AskDirection | null,
  direction: AskDirection | null,
): boolean {
  if (!direction) return false;
  if (!questionIntent) return true;
  return questionIntent === direction;
}

/**
 * ASK Candidate 决策（确定性，**只产生候选，不执行 ASK**）。
 * 优先级：explicit intent > correction/refusal > active > fresh narrative
 *        > userOwned > 刚发生的干预 > 情绪/打断成本 > 主动性
 *        > Timing Value > Question Value > ASK 候选。
 * 必须 **Question Value = HIGH 且 Timing Value = HIGH** 才允许候选。
 */
export function evaluateAskCandidate(input: AskCandidateInput): AskCandidateDecision {
  /*
   * Phase 3.2.4-B.1.x H2.1：Candidate 一次性确定「共享语义契约」。
   * direction 只在这里推断一次，Execution 直接消费，不再重新猜（Invariant 1/2/4）。
   */
  const direction = classifyAskDirection(input.clue ?? null);
  const questionIntent = classifyQuestionIntent(input.question ?? '');
  const aligned = isAlignedToDirection(questionIntent, direction);
  const targetClueText = (input.clue?.text ?? '').trim() || null;
  // H2.3.1：这道门只回答「target 是否已经把我们要问的信息说出来了」
  const questionProgression = isQuestionAlreadyAnsweredByTarget({ direction, targetClueText });

  const deny = (reason: string): AskCandidateDecision => ({
    value: input.value,
    timingValue: input.timingValue,
    freshNarrativeContribution: Boolean(input.freshNarrativeContribution),
    allowed: false,
    reason,
    targetClueText,
    direction,
    questionIntent,
    aligned,
    questionProgression,
  });

  if (input.correction) return deny('用户正在纠正 AI → NO_ASK（交给 Correction Recovery）');
  if (input.refusal) return deny('用户拒绝当前话题 → NO_ASK');
  if (input.activeExpression?.active) return deny('用户正在连续表达（active-expression）→ NO_ASK');
  if (input.freshNarrativeContribution) return deny('用户刚刚给出新的故事推进 → NO_ASK（现在不是提问时机）');
  if (input.userOwnedDiscovery) return deny('用户自己已经发现 → NO_ASK（不重新解释）');
  if (input.priorCandidate === 'REFLECT_CANDIDATE') return deny('刚刚发生 REFLECT → NO_ASK（保护期）');
  if (input.priorCandidate === 'GENTLE_PUSH_CANDIDATE') return deny('刚刚发生 GENTLE PUSH → NO_ASK（保护期）');
  /*
   * H2.2-C：上一轮 ASK 不再是「无条件封死」。
   * 只有「同方向 + 同一 target clue + 本轮无新增材料」才判为机械重复。
   */
  if (input.priorCandidate === 'ASK_CANDIDATE') {
    const rep = classifyRepeatAsk({
      priorCandidate: input.priorCandidate,
      priorDirection: input.priorDirection,
      priorTargetClueText: input.priorTargetClueText,
      direction,
      targetClueText,
      reception: input.reception,
      newMaterialClueCount: input.newMaterialClueCount,
      activeExpression: input.activeExpression,
    });
    if (rep.repeat) return deny(`上一轮已问过同一方向、同一线索且本轮无新增材料 → NO_ASK（H2.2 去重：${rep.reason}）`);
  }
  if (input.continuedStory) return deny('用户正在主动继续原故事 → NO_ASK');
  if (input.interruptionCost === 'HIGH') return deny('打断成本 HIGH → NO_ASK');
  if ((input.emotionIntensity ?? 0) >= 0.6) return deny('情绪强度高 → NO_ASK');
  if (input.userInitiative === 'HIGH' || input.userInitiative === 'VERY_HIGH')
    return deny('用户主动性强 → NO_ASK（让他继续讲）');
  if (input.hasPriorMaterial !== true) return deny('没有明确的上一轮用户材料 → NO_ASK');
  if (input.dependsOnAiInference) return deny('问题依赖 AI 自己的心理 / 因果推断 → NO_ASK');
  if (input.groundedInUserMaterial !== true) return deny('问题无法回溯到用户原话 / 已说出的材料 → NO_ASK');
  if (input.timingValue !== 'HIGH') return deny('Timing Value 不是 HIGH（缺少正向时机证据）→ NO_ASK');
  if (input.value !== 'HIGH') return deny(`Question Value=${input.value}（仅 HIGH 允许）→ NO_ASK`);
  /*
   * H2.2-B：用户已经自己把某个意义说出来 → 不再生成要求他重新解释同一意义的 UNDERSTANDING ASK。
   * 只作用于「目标 clue 自身锚定的材料」，不会把所有 meaning 永久的封死。
   */
  if (direction === 'UNDERSTANDING') {
    const clueMaterial = `${input.clue?.text ?? ''} ${input.clue?.evidence ?? ''}`.trim();
    if (isMeaningAlreadyVoicedByUser(clueMaterial)) {
      return deny('用户已经自己说出了这个意义 → NO_ASK（H2.2：不重复索取同一个发现）');
    }
  }
  /*
   * Phase 3.2.4-B.1.x H2.1 · 最后一道门：价值证明对象必须能被 Execution 真实执行。
   * 放在所有既有门之后，保证既有拒绝理由的优先级与文案完全不变。
   */
  if (!direction) {
    return deny('没有可执行方向（direction=null）→ NO_ASK（H2.1 alignment：无法映射到 ASK Execution）');
  }
  if (!aligned) {
    return deny(
      `Candidate 问题语义(${questionIntent}) 与将执行的方向(${direction}) 不一致 → NO_ASK` +
        '（H2.1 alignment：不允许证明问题 A 却执行问题 B）',
    );
  }
  /*
   * H2.3.1 · 最后一道门：target 不能已经回答了我们要问的那条信息。
   * 放在 alignment 之后，保证既有拒绝理由与文案完全不变。
   */
  if (!questionProgression.allowed) {
    return deny(`target 已经回答了这个问题 → NO_ASK（H2.3.1 Question Progression：${questionProgression.reason}）`);
  }
  return {
    value: 'HIGH',
    timingValue: 'HIGH',
    freshNarrativeContribution: Boolean(input.freshNarrativeContribution),
    allowed: true,
    reason:
      'Question Value HIGH + Timing Value HIGH + 语义对齐 + target 尚未回答该问题（仍打开新的信息空间）→ ASK_CANDIDATE',
    targetClueText,
    direction,
    questionIntent,
    aligned,
    questionProgression,
  };
}

/* ================ ASK Execution（Phase 3.2.4-B.1 / B.1.x H1） ================ */

/*
 * Phase 3.2.4-B.1.x H1 · Direction Safety。
 *
 * 原则：「人物出现」≠「关系」。他 / 她 / 妈 / 爸 / 老师 / 朋友 只能证明
 * 「材料里有人」，不能单独构成 RELATIONSHIP 的充分条件。
 * precision > recall：证据不足时一律 null（→ 不执行 ASK → 保持原有 WAIT）。
 */

/** 明确关系语义：关系名词 / 关系状态 / 关系变化（必须来自用户材料） */
const RELATION_NOUN_RE =
  /(关系|联系|疏远|亲近|和好|闹掰|相处|分开|来往|一起生活|一起住|我们之间|咱们之间)/;

/** 群体 + 关系状态或关系互动：我们后来就不怎么说话了 */
const RELATION_WE_RE =
  /((我们|咱们)[^。！？]{0,6}(之间|说话|联系|聊|来往|相处|疏远|分开|闹掰|和好))/;

/** 关系互动（含否定 / 频次）：没跟他说过 / 很少联系他 / 不再和他见面 */
const RELATION_INTERACTION_RE =
  /((不|没|很少|再也|一直没|不再|不怎么)[^。！？]{0,6}(跟|和|与)[^。！？]{0,4}(说|说话|聊|联系|见|见面|来往|交流|沟通|问))/;

/** H2.3.1 · RELATIONSHIP 方向：target 是否已经直接说出了「关系发生了什么变化」。
 *  仅当材料包含明确的关系变化表达才判「已回答」，避免把「只给了相关事件/互动状态」误拦。
 *  保守：未命中则视为尚未表达 → 仍可追问（precision 优先）。 */
const RELATIONSHIP_CHANGE_STATED_RE =
  /(不怎么联系|不再联系|联系少了|不怎么说话|不说话了|不怎么来往|不来往了|没再见过|再没见过|不再见面|疏远|闹掰|和好|重新联系|分开|变淡了|冷淡了|不怎么往来)/;

/**
 * 明确「变化」证据。绝不能只因 clue.kind === 'turning_point' 就认为「变化了」。
 */
const CHANGE_EVIDENCE_RE =
  /(变了|改变了|变化|不再是|不再|再也|不一样了|变得|变成|从那以后|后来就|想通了|看开了|放下了|以前[^。！？]{0,20}后来)/;

/** 材料里是否存在「关系语义」（不含「出现人物」） */
export function hasRelationshipEvidence(material: string): boolean {
  const t = (material ?? '').trim();
  if (!t) return false;
  return RELATION_NOUN_RE.test(t) || RELATION_WE_RE.test(t) || RELATION_INTERACTION_RE.test(t);
}

/** 材料里是否存在明确的「变化」表达 */
export function hasChangeEvidence(material: string): boolean {
  return CHANGE_EVIDENCE_RE.test((material ?? '').trim());
}

/* ---------- Phase 3.2.4-B.1.x H2.3.1 · Question Progression ---------- */

/**
 * 变化 / 关系变化的「起点、转折点」证据（时间或触发处）。
 * 注意：H1 的 evidence 检测（是否「有变化」）保持冻结，这里只判断「起点是否已经说了」。
 */
const ONSET_EVIDENCE_RE = /(之后|以后|从那时|从那以?后|那次|那一次|这一次|这时候|那个时候|当时)/;

/** 变化谓词：用于判断 target 除谓词外是否还剩可定位的内容 */
const CHANGE_PREDICATE_RE = /(变了|改变了|变化|不再是|不再|再也|不一样了|变得|变成|从那以后|后来就|想通了|看开了|放下了)/g;
/** 只有语气、没有信息的填充词 */
const EMPTY_FILLER_RE = /(其实|反正|就是|也没什么|没什么|真的|大概|可能|好像|也不|也没|也就|而已|罢了|吧)/g;

/** UNDERSTANDING：target 是否已经直接给出了用户自己的判断 / 结论 */
const USER_EVALUATION_RE =
  /(不喜欢|不适合|不想要|不愿意|不在乎|不需要|不认同|不接受|不想做|不想干|喜欢|讨厌|想要|愿意|在乎|在意|适合|接受|我觉得|我认为|对我来说)/;

/** target 材料里是否已经出现「变化起点 / 转折点」 */
export function hasOnsetEvidence(material: string): boolean {
  return ONSET_EVIDENCE_RE.test((material ?? '').trim());
}

export interface QuestionProgressionInput {
  direction: AskDirection | null;
  /** H2.1 共享的 target clue（不另找 clue、不新增 clue system） */
  targetClueText?: string | null;
}

export interface QuestionProgressionDecision {
  allowed: boolean;
  alreadyAnswered: boolean;
  reason: string;
}

/**
 * H2.3.1 · Question Progression：判断「target 是否已经回答了本方向要问的那条信息」。
 * 只检查「用户是否已经说出了问题所要求的信息」，不做任何心理 / 因果推断。
 *   CHANGE       ：要「变化起点」→ target 已给起点 或 只剩变化谓词（循环）→ 已回答
 *   RELATIONSHIP ：要「关系变化的起点」→ target 已给起点 → 已回答
 *   UNDERSTANDING：要「用户的判断」→ target 已直接给出判断 → 已回答
 */
export function isQuestionAlreadyAnsweredByTarget(
  input: QuestionProgressionInput,
): QuestionProgressionDecision {
  const t = (input.targetClueText ?? '').trim();
  const dir = input.direction;
  const yes = (reason: string): QuestionProgressionDecision => ({ allowed: false, alreadyAnswered: true, reason });
  const no = (reason: string): QuestionProgressionDecision => ({ allowed: true, alreadyAnswered: false, reason });

  if (!dir) return no('没有可执行方向 → 不适用（由 direction 门处理）');
  if (!t) return no('没有 target clue → 不适用（由 grounding 门处理）');

  if (dir === 'CHANGE') {
    if (hasOnsetEvidence(t)) return yes(`target 已提供变化的起点 / 转折点（${t}）→ 不再追问“从哪一件事开始变”`);
    const residual = t
      .replace(CHANGE_PREDICATE_RE, '')
      .replace(EMPTY_FILLER_RE, '')
      .replace(/[，。！？、,.!?；;：:\s「」『』"'（）()]/g, '');
    if (residual.length < 2) return yes('target 除变化谓词 / 语气词外没有可定位内容 → 追问会形成循环');
    return no('target 只给了变化结果、未给起点 → 仍可追问');
  }

  if (dir === 'RELATIONSHIP') {
    if (hasOnsetEvidence(t)) return yes(`target 已提供关系变化的转折点（${t}）→ 不再追问“是从哪件事开始变成这样的”`);
    if (RELATIONSHIP_CHANGE_STATED_RE.test(t))
      return yes(`target 已经明确说出了关系变化（${t}）→ 不再重复问“有什么不一样”`);
    return no('target 未给关系变化的起点 / 变化本身 → 可追问尚未表达的信息');
  }

  // UNDERSTANDING
  if (USER_EVALUATION_RE.test(t)) return yes(`target 已经直接表达了用户自己的判断（${t}）→ 不再要求重述发现`);
  return no('target 尚未表达判断 / 结论 → 仍可追问');
}

/**
 * 问题方向：只能从「目标 clue」推导，不从 LLM 的问题文本推导。
 * 锚点天然是 `User Raw → Evidence → Clue`。
 *
 * H1 规则（顺序即优先级）：
 *   1. 材料含关系语义            → RELATIONSHIP（不再看是否出现人物）
 *   2. open_thread 无关系证据    → null（绝不 fallback 到 RELATIONSHIP）
 *   3. meaning                  → UNDERSTANDING
 *   4. turning_point 有变化证据  → CHANGE
 *   5. 其余                      → null（不猜）
 */
export function classifyAskDirection(
  clue?: { kind?: string; text?: string; evidence?: string } | null,
): AskDirection | null {
  if (!clue?.kind) return null;
  if (clue.kind !== 'turning_point' && clue.kind !== 'open_thread' && clue.kind !== 'meaning') return null;

  const material = `${clue.text ?? ''} ${clue.evidence ?? ''}`.trim();
  if (!material) return null;

  if (hasRelationshipEvidence(material)) return 'RELATIONSHIP';
  if (clue.kind === 'open_thread') return null;
  if (clue.kind === 'meaning') return 'UNDERSTANDING';
  if (hasChangeEvidence(material)) return 'CHANGE';
  return null;
}

/** 固定模板 + 不引入任何新事实 / 不引入 AI 因果 / 不引入人格判断 */
/* ---------- Phase 3.2.4-B.1.x H2.3 · 展示锚点（Presentation Anchor） ---------- */

/**
 * anchor 长度上限（中文字符）。与 selfCheckAskQuestion 的 34 字上限配合：
 * 最长骨架 2 + 12 + 13 = 27 字，必然合规，不会因锚点导致 self-check 失败。
 */
const ASK_ANCHOR_MAX = 12;
const ASK_ANCHOR_MIN = 2;
/** 句读分隔符：只在「完整片段」边界上删除，绝不硬切 */
const ANCHOR_BREAK_RE = /[，。！？、,.!?；;：:]/;

/**
 * 把 targetClueText 变成可安全展示的 anchor。
 *
 * 原则：**只删除、不新增；不做语义改写；只取完整片段**。
 *   1. 先剥掉首尾标点 / 引号（纯删除）；
 *   2. 长度已合规 → 原样使用（保留完整短语）；
 *   3. 超长 → 只在句读边界切分，取「最长的完整片段」（仍是用户原话的一部分，不产生新句意）；
 *   4. 仍无可用片段 → 返回 null，调用方放弃 ASK。
 *
 * ⚠️ 刻意不使用项目里既有的 clip() / excerptOf()（它们是 `slice(0, n) + …` 硬切，
 *    会在词中间截断人名 / 事件，改变事实含义）——宁可不出 ASK，也不改写用户事实。
 */
export function buildAskAnchor(targetClueText: string | null | undefined): string | null {
  const raw = (targetClueText ?? '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^[\s，。！？、,.!?；;：:"'「」『』（）()【】]+/, '')
    .replace(/[\s，。！？、,.!?；;：:"'「」『』（）()【】]+$/, '')
    .trim();
  if (cleaned.length < ASK_ANCHOR_MIN) return null;
  if (cleaned.length <= ASK_ANCHOR_MAX) return cleaned;
  const parts = cleaned
    .split(ANCHOR_BREAK_RE)
    .map((part) => part.trim())
    .filter((part) => part.length >= ASK_ANCHOR_MIN && part.length <= ASK_ANCHOR_MAX);
  if (!parts.length) return null;
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/** 方向 → 问题骨架。骨架本身不随 anchor 变化，保证 direction / questionIntent 不被改写 */
const ASK_TEMPLATE_SUFFIX: Record<AskDirection, string> = {
  // H1：只断言「有变化」（由 CHANGE_EVIDENCE_RE 保证），不再断言「你的想法变了」
  CHANGE: '你后来是从哪一件事开始变的？',
  /*
   * H2.3.1：原「你们之间后来有什么不一样吗？」与 RELATIONSHIP 的判定条件语义重叠
   * （direction 只有材料已含关系变化才成立，于是问题必然在重问「有没有变化」）。
   * 改为索取**尚未表达的转折点**，仍是关系维度、仍是单一核心问题。
   * 措辞刻意避开「什么时候」等 FACT_QUESTION_RE 词（否则会被 Question Value 判为资料型 → LOW）。
   */
  RELATIONSHIP: '你们之间是从哪件事开始变成这样的？',
  UNDERSTANDING: '你后来发现的是什么？',
};

/**
 * H2.3：同一个 direction + 同一个 target 的**再次**提问，换一个「回到同一处」的措辞。
 * 目的：满足 H2.2-c「重问不得与上一轮机械相同」，且不改变问题意图（骨架与 direction 完全不变）。
 */
const ASK_REASK_PREFIX = '再说回';
const ASK_FIRST_PREFIX = '关于';

/** ASK 语言红线：心理诊断 / 人格标签 / AI 自己的因果 / 包装成事实的推断 */
const ASK_FORBIDDEN_RE =
  /(是不是因为|是不是你|你其实|你本质上|说明你|这反映出你|你内心|你真正想要的|你属于|我觉得你|看来你|可见你|你有点|你比较|你害怕|你缺爱|讨好型|为什么|导致你|所以你才|我注意到|诊断|人格)/;

export interface AskQuestionInput {
  direction: AskDirection | null;
  /**
   * H2.3：展示锚点，必须来自 candidate.targetClueText（不得另行查找 clue / 调用 LLM 概括）。
   * 为 null 时表示无法安全展示 → 不生成问题。
   */
  anchor?: string | null;
  /**
   * H2.3：同一 direction + 同一 target 的再次提问 → 1（换措辞，避免与上一轮逐字相同）。
   * 只影响前缀措辞，不影响骨架 / direction / questionIntent。
   */
  variant?: 0 | 1;
}

/**
 * ASK 文本 self-check：不含心理诊断 / 人格判断 / AI 自己的因果解释 /
 * 用户没说过的事实；恰好一个问题；不是连续追问；长度适合移动端口语。
 */
export function selfCheckAskQuestion(text: string): { ok: boolean; reason: string } {
  const t = (text ?? '').trim();
  if (!t) return { ok: false, reason: '空问题' };
  const marks = (t.match(/[？?]/g) ?? []).length;
  if (marks !== 1) return { ok: false, reason: `问题数量 ${marks} ≠ 1（不允许连续追问 / 多个问题）` };
  if (ASK_FORBIDDEN_RE.test(t)) return { ok: false, reason: '命中语言红线（诊断 / 人格 / AI 因果 / 你其实…）' };
  if (/(并且|还有|另外|同时).{0,8}[？?]/.test(t)) return { ok: false, reason: '疑似连续追问' };
  const len = t.replace(/[，。？！、,.!?]/g, '').length;
  if (len < 10 || len > 34) return { ok: false, reason: `长度 ${len} 不在 10–34` };
  return { ok: true, reason: 'ok' };
}

/**
 * 确定性 ASK 问题生成（不新增任何 LLM 调用）。
 * self-check 失败 → 返回 null（调用方保持原有 WAIT / 当前回复）。
 */
export function buildAskQuestion(input: AskQuestionInput): { text: string | null; reason: string } {
  if (!input.direction) return { text: null, reason: '没有可用的 question direction → 不生成问题' };
  const suffix = ASK_TEMPLATE_SUFFIX[input.direction];
  if (!suffix) return { text: null, reason: '该方向没有可用模板 → 不生成问题' };
  const anchor = input.anchor ?? null;
  if (!anchor) return { text: null, reason: '无法从 targetClueText 安全形成展示锚点 → 不生成问题' };
  // H2.3：骨架不变（保 direction / questionIntent），只把用户原话片段作为引用插入
  const prefix = input.variant === 1 ? ASK_REASK_PREFIX : ASK_FIRST_PREFIX;
  const text = `${prefix}「${anchor}」，${suffix}`;
  const check = selfCheckAskQuestion(text);
  if (!check.ok) return { text: null, reason: `${check.reason} → 不生成问题` };
  return { text, reason: `direction=${input.direction}, anchor=${anchor}` };
}

export interface AskExecutionInput {
  /**
   * Phase 3.2.4-B.1.x H2.1：直接消费 Candidate 的决策结果。
   * Execution **不再重新推断 direction**（Invariant 4），也不再自己找 clue。
   */
  candidate: AskCandidateDecision;
  /** 引擎闸（例如 demo 不执行 ASK）；不传视为启用 */
  enabled?: boolean;
  /**
   * H2.3：上一轮 ASK 的方向 / target。**只用于选择措辞**（同意图重问换前缀），
   * 不参与任何语义判定，也不重新推断 direction（保 H2.1）。
   */
  priorDirection?: AskDirection | null;
  priorTargetClueText?: string | null;
}

export interface AskExecutionDecision {
  allowed: boolean;
  direction: AskDirection | null;
  text: string | null;
  reason: string;
  /** H2.1：与 Candidate 共享的语义锚点（可审计） */
  targetClueText: string | null;
  /** H2.1：Candidate 问题的 intent */
  questionIntent: AskDirection | null;
  /** H2.1：是否通过语义对齐 */
  aligned: boolean;
}

/**
 * ASK Execution 决策（确定性）。
 * ⚠️ 它**不会**改变更高优先级的任何行为；调用方必须把它放在回复链的最末端
 * （REFLECT / GENTLE_PUSH / user-owned / active-expression 之后）。
 *
 * H2.1：本函数只做「消费 + 生成话术」，方向来自 Candidate，语义对齐也已在
 * Candidate 内完成校验；这里再断言一次，作为 fail-safe。
 */
export function evaluateAskExecution(input: AskExecutionInput): AskExecutionDecision {
  const c = input.candidate;
  const carry = {
    targetClueText: c?.targetClueText ?? null,
    questionIntent: c?.questionIntent ?? null,
    aligned: Boolean(c?.aligned),
  };
  const stop = (direction: AskDirection | null, reason: string): AskExecutionDecision => ({
    allowed: false,
    direction,
    text: null,
    reason,
    ...carry,
  });

  if (input.enabled === false) return stop(c?.direction ?? null, '引擎未启用 ASK Execution → 不执行 ASK');
  if (!c?.allowed) return stop(c?.direction ?? null, `askCandidate.allowed=false → 不执行 ASK（${c?.reason ?? '未提供候选'}）`);
  // fail-safe：对齐不成立时绝不 fallback 到别的 direction / template
  if (!c.aligned || !c.direction) return stop(c.direction ?? null, 'Candidate 未通过语义对齐 → 不执行 ASK');
  // H2.3.1 fail-safe：Candidate 若已判定「target 已回答」，Execution 绝不自行放行
  if (c.questionProgression && !c.questionProgression.allowed) {
    return stop(c.direction, `target 已经回答了这个问题 → 不执行 ASK（${c.questionProgression.reason}）`);
  }
  if (!c.targetClueText) return stop(c.direction, '缺少共享 target clue → 不执行 ASK');

  // H2.3：锚点只能来自 candidate.targetClueText；无法安全展示则明确不执行（绝不留「假已发出」）
  const anchor = buildAskAnchor(c.targetClueText);
  // 同 direction + 同 target 的再次提问 → 换措辞（仅前缀，不动骨架）
  const variant: 0 | 1 =
    input.priorDirection && input.priorDirection === c.direction &&
    input.priorTargetClueText && input.priorTargetClueText === c.targetClueText
      ? 1
      : 0;
  const built = buildAskQuestion({ direction: c.direction, anchor, variant });
  if (!built.text) return stop(c.direction, `未能生成合规 ASK：${built.reason}`);
  return { allowed: true, direction: c.direction, text: built.text, reason: built.reason, ...carry };
}
