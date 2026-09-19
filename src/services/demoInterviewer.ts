import { EMPTY_SIGNALS } from '../types/interview';
import type { CandidateQuestion, Clue, StoryMemory, Understanding } from '../types/interview';
import { findDemoScript } from '../data/demoScript';
import type { DemoBeat } from '../data/demoScript';
import { uid } from '../lib/storage';
import { strengthenSignals } from './rules';
import type { MemoryPatch } from './memoryService';
import type { StoryDraft, StoryKind } from '../types/interview';
import type { Discovery } from '../types/discovery';

/**
 * 演示兜底引擎：没有任何模型密钥时，用脚本化的《第一次离开家》走完整采访链路。
 *
 * 注意它只负责「理解 + 候选追问 + 这句采访者台词」，
 * 规则过滤、优先级排序、状态迁移仍然全部走真实的生产代码——
 * 所以观察面板里看到的判断过程不是假数据。
 */

/** 这个话题是否有手写剧本（有剧本的演示体验才像样） */
export function isScriptedTopic(topicId: string | null | undefined): boolean {
  return Boolean(findDemoScript(topicId));
}

/** 取剧本里第 scriptStep 轮的用户台词，供「用剧本台词回答」按钮使用 */
export function sampleAnswerFor(topicId: string, scriptStep: number): string | null {
  const script = findDemoScript(topicId);
  if (!script) return null;
  const index = Math.min(Math.max(scriptStep - 1, 0), script.beats.length - 1);
  return script.beats[index]?.sampleUser ?? null;
}

/** 该话题剧本一共几轮（用户说话次数） */
export function scriptTurnCount(topicId: string): number {
  const script = findDemoScript(topicId);
  return script ? script.beats.length : 0;
}

export interface DemoTurnInput {
  topicId: string;
  topicSeed?: string;
  userText: string;
  /** 已经顺利完成了几轮（被硬规则打断的轮次不计数） */
  scriptStep: number;
  memory: StoryMemory;
  /** 之前累积的线索 */
  priorClues: Clue[];
}

export interface DemoTurnResult {
  reply: string;
  understanding: Understanding;
  candidates: CandidateQuestion[];
  /** 该轮应该点亮的「高价值线索」 */
  highValueClues?: string[];
  /** 该轮补充的「推荐理由」 */
  extraReasons?: string[];
}

/**
 * 演示剧本的线索也必须带上 V1 的两个字段，否则演示模式会绕过支线暂存/主线机制，
 * 导致「演示里看着正常、真实模型下行为不同」——验收时会误判。
 * 剧本里用户是照着台词主动讲的，所以默认 MEDIUM（可以回应，但不算顺嘴提及）。
 */
function toClues(seeds: { kind: Clue['kind']; text: string; importance: number; evidence: string }[], turn: number): Clue[] {
  return seeds.map((seed) => ({
    id: uid('clue'),
    kind: seed.kind,
    text: seed.text,
    importance: seed.importance,
    userInitiated: true,
    evidence: seed.evidence,
    turn,
    userInitiativeLevel: 'MEDIUM',
    emotionalDistance: 'core',
  }));
}

function scoreFromBet(clues: Clue[]): Pick<
  CandidateQuestion,
  | 'story_value'
  | 'user_initiative'
  | 'emotional_signal'
  | 'information_gain'
  | 'willingness'
  | 'disturbance_cost'
  | 'sensitivity_risk'
> {
  const top = clues.reduce((max, clue) => Math.max(max, clue.importance), 3);
  const hasEmotion = clues.some((clue) => clue.kind === 'emotion');
  const hasDepth = clues.some((clue) => clue.kind === 'turning_point' || clue.kind === 'meaning');
  return {
    story_value: top,
    user_initiative: 5,
    emotional_signal: hasEmotion ? 5 : 3,
    information_gain: hasDepth ? 5 : 4,
    willingness: 4,
    disturbance_cost: 2,
    sensitivity_risk: 1,
  };
}

/** 生成两个「拟考虑但没选」的候选，让观察面板的候选对比是真实的 */
function alternativeCandidates(clues: Clue[], memory: StoryMemory): CandidateQuestion[] {
  const pool = clues.filter((clue) => clue.importance >= 3).slice(-4);
  const alternatives: CandidateQuestion[] = [];
  for (const clue of pool.reverse()) {
    if (alternatives.length >= 2) break;
    const question =
      clue.kind === 'person'
        ? `${clue.text}大概是个什么样的人？`
        : clue.kind === 'detail'
          ? `「${clue.text.slice(0, 12)}」是在什么地方发生的？`
          : clue.kind === 'emotion'
            ? `那时候除了${clue.text}，还有别的感觉吗？`
            : `${clue.text.slice(0, 16)}——这件事发生在什么时候？`;
    alternatives.push({
      id: uid('q'),
      question,
      target_clue: clue.text,
      story_value: clue.importance - 1,
      user_initiative: 2,
      emotional_signal: clue.kind === 'emotion' ? 4 : 2,
      information_gain: 3,
      willingness: 4,
      disturbance_cost: clue.kind === 'person' ? 2 : 4,
      sensitivity_risk: memory.emotions.length > 2 ? 2 : 1,
    });
  }
  return alternatives;
}

/** 剧本路径：严格按手写台词逐句推进（不再自由发挥） */
function runScriptTurn(input: DemoTurnInput, beats: DemoBeat[]): DemoTurnResult {
  const index = Math.min(Math.max(input.scriptStep, 0), beats.length - 1);
  const beat = beats[index];
  const newClues = toClues(beat.newClues, input.scriptStep + 1);
  const allClues = [...input.priorClues, ...newClues];

  const selected: CandidateQuestion = {
    id: uid('q'),
    question: beat.ai,
    target_clue: beat.selectedTarget,
    ...scoreFromBet(newClues),
  };

  const understanding: Understanding = {
    newClues,
    signals: strengthenSignals({ ...EMPTY_SIGNALS }, input.userText),
    memoryPatch: beat.memoryPatch as MemoryPatch,
    // 只有走到最后一条台词，才允许自评「差不多了」；中途一律压低，
    // 这样状态机就不会在中途草草宣布故事完整。
    completeness: index >= beats.length - 1 ? 0.9 : Math.min(0.65, 0.3 + index * 0.03),
    focus: beat.selectedTarget,
  };

  return {
    reply: beat.ai,
    understanding,
    candidates: [selected, ...alternativeCandidates(allClues, input.memory)],
    highValueClues: beat.highValueClues ?? [],
    extraReasons: beat.extraReasons ?? [],
  };
}

/**
 * 用户重复自己、或明显觉得「这事没什么可讲的」。
 * 没有模型时读不懂内容，但至少不能傻乎乎地把同一句问第二遍。
 */
const DISMISS_RE = /(这有什么好讲|有什么好讲的|没什么好讲|有啥好说的|没啥好说的|不就是这样吗|这也要问)/;

/** 轮换的自然追问池：允许"没有模型时问得泛"，但不允许"复读用户原话"，也不允许用与当前输入无关的万能问题 */
const GENERIC_FOLLOWUPS = [
  '嗯，我记下了。这件事里，您最先想起来的是哪一幕？',
  '嗯。您刚才说的这件事里，还有哪一幕是您一直记得的？',
  '我在想，那件事对您来说最难的是哪一点？',
  '您愿意说说，当时您心里在想什么吗？',
  '那时候您是什么感觉？',
  '后来又发生了什么？',
];

function normalizeForCompare(value: string): string {
  return value.replace(/[\s，。！？、,.!?；;：:""''「」]/g, '');
}

/** 非剧本话题：仍然走「理解 → 候选 → 排序」链路，只是没有手写台词 */
function runGenericTurn(input: DemoTurnInput): DemoTurnResult {
  const text = input.userText.trim();
  const previousQuotes = input.priorClues.filter((clue) => clue.kind === 'quote');
  const previousText = previousQuotes[previousQuotes.length - 1]?.text ?? '';
  const dismissed = DISMISS_RE.test(text);
  const repeated = !dismissed && Boolean(previousText) && normalizeForCompare(previousText) === normalizeForCompare(text);
  // 无效回合（重复 / 觉得没什么好讲）不重复记账，避免线索被同一句话灌满
  const noProgress = dismissed || repeated;

  const newClues: Clue[] = noProgress
    ? []
    : [
        {
          id: uid('clue'),
          kind: 'quote',
          text: text.length > 24 ? `${text.slice(0, 24)}…` : text || '（这一轮没有新的内容）',
          importance: 3,
          userInitiated: true,
          evidence: text.slice(0, 40),
          turn: input.scriptStep + 1,
        },
      ];
  const allClues = [...input.priorClues, ...newClues];

  const question = noProgress
    ? '好，那这个我们先放着。您想换个角度讲，还是说点别的？'
    : GENERIC_FOLLOWUPS[allClues.length % GENERIC_FOLLOWUPS.length];

  const candidates: CandidateQuestion[] = [
    {
      id: uid('q'),
      question,
      // 针对的线索仍然是用户刚说的那句，只是不再把原话一字不差地引回去
      target_clue: text.slice(0, 24),
      story_value: noProgress ? 1 : 4,
      user_initiative: noProgress ? 2 : 5,
      emotional_signal: noProgress ? 1 : 3,
      information_gain: noProgress ? 0 : 4,
      willingness: 4,
      disturbance_cost: noProgress ? 4 : 2,
      sensitivity_risk: 1,
    },
  ];

  return {
    reply: question,
    understanding: {
      newClues,
      signals: strengthenSignals({ ...EMPTY_SIGNALS }, text),
      memoryPatch: noProgress
        ? {}
        : {
            user_quotes: text.length >= 8 ? [text.slice(0, 60)] : [],
            details: text.length >= 6 ? [{ detail: text.slice(0, 30), importance: 3 }] : [],
          },
      completeness: noProgress ? 0 : 0.35,
      focus: text.slice(0, 30),
    },
    candidates,
  };
}

export function runDemoTurn(input: DemoTurnInput): DemoTurnResult {
  const script = findDemoScript(input.topicId);
  if (script) return runScriptTurn(input, script.beats);
  return runGenericTurn(input);
}

/** 开场白：剧本话题用手写开场，其余话题按方向给一句轻的邀请 */
export function buildDemoOpening(topicId: string, topicSeed: string | undefined): string {
  const script = findDemoScript(topicId);
  if (script) return script.beats[0].ai;
  if (topicSeed) return `${topicSeed}。您想到哪儿就说到哪儿，我在这儿听着。`;
  return '随便从哪件小事讲起都行，我在这儿听着。';
}

/** 演示模式下的故事整理：剧本话题直接给出该剧本的成稿 */
export function buildDemoStory(
  topicId: string,
  memory: StoryMemory,
  options: { kind?: StoryKind; threadId?: string; sourceMessageIds?: string[] } = {},
): StoryDraft {
  const script = findDemoScript(topicId);
  if (script) {
    return {
      title: script.story.title,
      content: script.story.content,
      literary: script.story.literary,
      engine: 'demo',
      createdAt: Date.now(),
      kind: options.kind ?? 'full',
      threadId: options.threadId ?? '',
      sourceMessageIds: options.sourceMessageIds ?? [],
    };
  }
  const title = memory.story_title || memory.events[0]?.description.slice(0, 10) || '我的一个故事';
  const paragraphs = [
    memory.events.map((event) => event.description).filter(Boolean).join('；'),
    memory.details.map((detail) => detail.detail).filter(Boolean).join('；'),
    memory.turning_points
      .map((point) => `${point.before || '原本'}，后来${point.after || '变了'}${point.trigger ? `，是因为${point.trigger}` : ''}`)
      .filter(Boolean)
      .join('；'),
    memory.emotions.map((emotion) => `那时候我心里最清楚的感觉是${emotion.emotion}`).join('；'),
  ].filter(Boolean);
  return {
    title: title.replace(/[。！？，,]/g, '').slice(0, 12) || '我的一个故事',
    content: paragraphs.length ? paragraphs.join('\n\n') : memory.user_quotes.join('\n\n'),
    literary: false,
    engine: 'demo',
    createdAt: Date.now(),
    kind: options.kind ?? 'full',
    threadId: options.threadId ?? '',
    sourceMessageIds: options.sourceMessageIds ?? [],
  };
}

/** 用户跑题时：先跟着用户走，绝不把人拉回原来的话题 */
export function buildDemoTopicFollow(): string {
  return '好呀，那我们先说这件事。您刚才突然想起来的这个，是怎么一回事？';
}

/**
 * 强情绪输入：先接住情绪，再继续。
 * 只在演示脚本模式下作为前缀追加，不修改剧本原句——毕竟没有模型时它读不懂新内容。
 */
const EMOTION_ACK: { re: RegExp; text: string }[] = [
  { re: /后悔|遗憾|要是当初|如果当初/, text: '嗯，我听出来了，这件事到现在还搁在心里。' },
  { re: /难过|伤心|心里不好受|觉得很沉/, text: '嗯，我听见了。' },
  { re: /辛苦|不容易|太累了|撑不住/, text: '嗯，这些年确实不容易。' },
];

export function buildDemoEmotionAck(userText: string): string | null {
  for (const item of EMOTION_ACK) {
    if (item.re.test(userText)) return item.text;
  }
  return null;
}

/* ---------------- 演示模式：私享版的「关于你」与分享版 ---------------- */

/**
 * 演示模式下的「关于你」。
 *
 * 没有模型时，规则是：**只有在用户原话里找得到落脚点，才写这一条**。
 * 每条 evidence 都是从 userTexts 里逐字摘出来的，所以它同样经得起
 * contentGuard 的「依据必须可回溯」检查——演示模式也不能凭想象写人。
 */
export function buildDemoDiscoveries(userTexts: string[]): Discovery[] {
  const lines = userTexts.map((text) => text.trim()).filter(Boolean);
  const pick = (...keywords: string[]): string =>
    lines.find((line) => keywords.some((keyword) => line.includes(keyword))) ?? '';

  const out: Discovery[] = [];
  const push = (
    kind: Discovery['kind'],
    text: string,
    support: string,
    evidence: string,
  ): void => {
    if (!evidence) return;
    out.push({ id: uid('d'), kind, text, support: support || undefined, evidence: [evidence] });
  };

  push(
    'care',
    '你似乎很在意自己在重要的人眼中的样子。',
    '从这段故事里，你多次提到希望被认可、被当作从容可靠的人。',
    pick('优秀', '从容', '认可', '面子', '装作', '冷静', '评价', '眼光'),
  );
  push('want', '你似乎想要自己也能真正帮上大家的忙。', '你提到原本就想「做些什么帮助到大家」，也在意自己有没有帮上。', pick('实力', '证明', '做到', '努力', '帮助', '帮上'));
  push(
    'express',
    '当一件事真的重要时，你最后还是会希望把自己的想法说出来。',
    '你曾经因为担心对方不接受而没有把质疑说清楚，但后来还是选择表达。',
    pick('饭', '菜', '买', '带', '送', '说', '想法', '表达'),
  );
  push(
    'people',
    '领队似乎是一个愿意给你空间的人。',
    '你一开始并不认识他，但在你担任副队长的过程中，他鼓励你表达，还告诉你有需要帮助时他在。',
    pick('领队', '鼓励', '接住', '他在', '帮助'),
  );

  return out;
}

/**
 * 演示模式下的分享版：**只把用户自己说过的话按原样分段**。
 *
 * 演示模式没有模型，任何「优化过渡」都会变成 AI 替用户说话，
 * 所以这里宁可朴素：分享版 = 用户原话，事实与私享版天然一致。
 * 真正的叙事整理需要配置模型密钥。
 */
export function buildDemoShareStory(
  lines: { role: 'user' | 'assistant'; text: string }[],
  fallbackTitle: string,
): { title: string; content: string; literary: boolean } {
  const content = lines
    .filter((line) => line.role === 'user')
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    title: fallbackTitle.trim().slice(0, 20) || '我的一个故事',
    content,
    literary: false,
  };
}
