import type {
  BranchState,
  ConversationStatus,
  InterviewState,
  StoryMemory,
  Understanding,
} from '../types/interview';

/**
 * 采访状态机（纯函数）。
 * 刻意不让模型每一轮自由决定「要不要继续问」——模型只提供理解与候选，
 * 状态迁移由这里根据确定性规则完成，方便复现、方便单测、方便观察。
 */

export type MachineAction =
  | 'ask'
  | 'stop'
  | 'sensitive_confirm'
  | 'confused_hint'
  | 'follow_new_topic'
  | 'offer_summary';

export interface MachineInput {
  current: InterviewState;
  understanding: Understanding;
  memory: StoryMemory;
  /** 用户已经说了几轮 */
  userTurn: number;
}

export interface MachineOutput {
  state: InterviewState;
  branch?: BranchState;
  action: MachineAction;
  canComplete: boolean;
  /** 命中的状态机判定，写进观察面板 */
  ruleHits: string[];
}

/* ---------------- 故事完整性判定 ---------------- */

export interface MessageLike {
  role: 'user' | 'assistant';
  text: string;
}

/** 讲述量（修正4）：作为与「结构完整度」并列的独立信号，不被 LLM 自评覆盖 */
export interface VolumeMetrics {
  /** 用户发言轮数 */
  userTurns: number;
  /** 用户发言总字数（含标点，粗略） */
  userChars: number;
  /** 有效字数：去掉空白、标点与常见填充词后的字数，更接近「真的讲了什么」 */
  meaningfulChars: number;
}

const FILLER_WORDS = [
  '嗯', '啊', '哦', '呃', '唉', '嘛', '呀', '吧', '呢',
  '那个', '就是', '然后', '好的', '好呀', '对呀', '是的', '对对',
];

/** 只统计用户说的话，得到三个讲述量指标 */
export function measureVolume(messages: MessageLike[] = []): VolumeMetrics {
  const userMessages = messages.filter((message) => message.role === 'user');
  const joined = userMessages.map((message) => message.text.trim()).join('');
  const userChars = joined.replace(/\s/g, '').length;
  let meaningful = joined;
  for (const filler of FILLER_WORDS) meaningful = meaningful.split(filler).join('');
  meaningful = meaningful.replace(/[\s，。！？、,.!?；;：:"'“”‘’（）()…~—\-]/g, '');
  return { userTurns: userMessages.length, userChars, meaningfulChars: meaningful.length };
}

export interface CompletenessReport {
  /** 0-1 的启发式得分 */
  score: number;
  /** 达到「能独立成立」的最低标准 */
  ready: boolean;
  missing: string[];
  /** 讲述量（修正4） */
  volume: VolumeMetrics;
}

/**
 * 最低标准：
 *  发生了什么 + 至少一个重要人物或背景 + 至少一个具体细节 + 一个结果/转折
 * 用户的感受/意义是加分项，不是必需项。
 *
 * 注意：它只描述「结构完整度」，**不等于用户实际讲述量**，也不是最终生成决策
 * （最终决策见 decideOutput）。messages 可选，传了才会算 volume。
 */
export function assessCompleteness(memory: StoryMemory, messages: MessageLike[] = []): CompletenessReport {
  const missing: string[] = [];
  let score = 0;

  const hasEvent = memory.events.some((event) => event.description.trim().length > 0);
  if (hasEvent) score += 0.3;
  else missing.push('发生了什么');

  // 只是「有个名字」还不够，要么有明确的人物，要么时间与地点都交代了
  const hasPerson = memory.people.some((person) => person.name.trim().length > 0);
  const hasBackground = memory.events.some((event) => event.place.trim() && event.time.trim());
  if (hasPerson || hasBackground) score += 0.2;
  else missing.push('关键人物或背景');

  // 必须是真的具体细节，光有原话不算——规格里这一条是「至少一个具体细节」
  const hasDetail = memory.details.some((detail) => detail.detail.trim().length >= 2);
  if (hasDetail) score += 0.2;
  else missing.push('一个具体细节');

  // 一个变化或结果：有明确转折，或者事情本身已经铺开到能看出结果、用户也说出了自己的理解
  const hasTurn =
    memory.turning_points.length > 0 || (memory.events.length >= 4 && memory.meaning.length > 0);
  if (hasTurn) score += 0.2;
  else missing.push('一个变化或结果');

  const hasFeeling =
    memory.emotions.some((emotion) => emotion.emotion.trim().length > 0) ||
    memory.meaning.some((item) => item.interpretation.trim().length > 0);
  if (hasFeeling) score += 0.1;

  return {
    score: Math.min(1, Number(score.toFixed(3))),
    ready: missing.length === 0,
    missing,
    volume: measureVolume(messages),
  };
}

/**
 * 完整度：结构没齐之前一律压到 0.65 以下，不允许「聊两轮就说故事完整了」。
 * 结构齐了之后再让模型自评往上推，作为展示用的连续分。
 */
export function mergeCompleteness(memory: StoryMemory, llmSelfReport: number): number {
  const report = assessCompleteness(memory);
  const self = Math.min(1, Math.max(0, Number.isFinite(llmSelfReport) ? llmSelfReport : 0));
  if (!report.ready) return Math.min(report.score, 0.65);
  return Math.min(1, Number((0.6 + self * 0.4).toFixed(3)));
}

/* ---------------- 故事成熟度决策（修正1 / 修正4） ---------------- */

/**
 * ⚠️ MVP 启发式参数，**不代表经过用户研究验证的真实成熟度模型**。
 * 集中定义在这里，禁止散落到调用点；以后用 20~50 个真实案例调整这些数字即可，
 * 不需要改动决策逻辑本身。
 */
export const MATURITY_CONFIG = {
  /** 有效字数参考上限：用来把讲述量归一化 */
  FULL_CHARS: 400,
  /** 低于这个有效字数、且信息贫乏 → 只能是 seed */
  SEED_CHARS: 60,
  /** 信息丰富度达到这个值 → 至少是 fragment */
  INFO_FRAGMENT: 3,
  /** 信息丰富度达到这个值 → 有资格成为 full 的强证据 */
  INFO_FULL: 9,
  /** 综合分达到这个值 → fragment 门槛 */
  FRAGMENT_THRESHOLD: 0.4,
  /** 综合分达到这个值 且 有强证据 → full 门槛 */
  FULL_THRESHOLD: 0.7,
  /** 综合分达到这个值 → 采访中自动留存时判为 note（否则 seed） */
  NOTE_THRESHOLD: 0.18,
  /** LLM 自评在综合分里的最大贡献：修正4，绝不允许 LLM 单独把结论推到 full */
  LLM_COMPLETENESS_CAP: 0.3,
  WEIGHTS: {
    volume: 0.3,
    info: 0.3,
    scene: 0.15,
    organize: 0.15,
    complete: 0.1,
    llm: 0.1,
  },
} as const;

export interface MaturityInput {
  memory: StoryMemory;
  /** 用户这一轮之前的完整对话（用于算讲述量） */
  messages?: MessageLike[];
  /** 用户是否明确要求整理 / 保存（产品操作意图） */
  userRequestsOrganize?: boolean;
  /** 用户是否明确表示这个故事已经讲完（如「这就是全部了」） */
  userSaysComplete?: boolean;
  /** LLM1 自评完整度 0-1；**只作为输入信号**（修正4） */
  llmCompleteness?: number;
}

export interface MaturitySignals {
  people: number;
  events: number;
  details: number;
  turningPoints: number;
  emotions: number;
  quotes: number;
  /** 是否有具体场景（时间/地点，或带画面的事件描述） */
  hasScene: boolean;
  userRequestsOrganize: boolean;
  userSaysComplete: boolean;
  llmCompleteness: number;
}

export interface MaturityScore {
  /** 0-1 综合分（启发式，非科学分数） */
  score: number;
  /** 信息丰富度原始分（用于阈值判断） */
  rawInfo: number;
  volume: VolumeMetrics;
  signals: MaturitySignals;
}

/** 信息丰富度：具体人物 / 事件 / 细节 / 变化 / 情绪 / 原话，各按数量加权 */
function rawInfoRichness(memory: StoryMemory): number {
  return (
    1.0 * Math.min(memory.people.filter((person) => person.name.trim()).length, 3) +
    1.0 * Math.min(memory.events.filter((event) => event.description.trim()).length, 4) +
    0.7 * Math.min(memory.details.filter((detail) => detail.detail.trim()).length, 4) +
    0.6 * Math.min(memory.turning_points.length, 2) +
    0.5 * Math.min(memory.emotions.filter((emotion) => emotion.emotion.trim()).length, 3) +
    0.4 * Math.min(memory.user_quotes.filter((quote) => quote.trim()).length, 3)
  );
}

export function scoreMaturity(input: MaturityInput): MaturityScore {
  const { memory } = input;
  const volume = measureVolume(input.messages ?? []);
  const rawInfo = rawInfoRichness(memory);
  const hasScene =
    memory.events.some((event) => event.place.trim().length > 0 || event.time.trim().length > 0) ||
    memory.events.some((event) => event.description.trim().length >= 12);
  const organize = Boolean(input.userRequestsOrganize);
  const complete = Boolean(input.userSaysComplete);
  const rawLlm =
    typeof input.llmCompleteness === 'number' && Number.isFinite(input.llmCompleteness)
      ? input.llmCompleteness
      : 0;
  const llm = Math.min(Math.max(rawLlm, 0), 1);

  const volNorm = Math.min(volume.meaningfulChars / MATURITY_CONFIG.FULL_CHARS, 1);
  const infoNorm = Math.min(rawInfo / MATURITY_CONFIG.INFO_FULL, 1);

  const score =
    MATURITY_CONFIG.WEIGHTS.volume * volNorm +
    MATURITY_CONFIG.WEIGHTS.info * infoNorm +
    MATURITY_CONFIG.WEIGHTS.scene * (hasScene ? 1 : 0) +
    MATURITY_CONFIG.WEIGHTS.organize * (organize ? 1 : 0) +
    MATURITY_CONFIG.WEIGHTS.complete * (complete ? 1 : 0) +
    MATURITY_CONFIG.WEIGHTS.llm * Math.min(llm, MATURITY_CONFIG.LLM_COMPLETENESS_CAP);

  return {
    score: Number(Math.min(score, 1).toFixed(3)),
    rawInfo,
    volume,
    signals: {
      people: memory.people.filter((person) => person.name.trim()).length,
      events: memory.events.filter((event) => event.description.trim()).length,
      details: memory.details.filter((detail) => detail.detail.trim()).length,
      turningPoints: memory.turning_points.length,
      emotions: memory.emotions.filter((emotion) => emotion.emotion.trim()).length,
      quotes: memory.user_quotes.filter((quote) => quote.trim()).length,
      hasScene,
      userRequestsOrganize: organize,
      userSaysComplete: complete,
      llmCompleteness: llm,
    },
  };
}

/** 最终产出决策：seed → MemoryEntry；fragment / full → Story */
export type MaturityDecision = 'seed' | 'fragment' | 'full';

/**
 * 生成决策（修正4：由确定性业务逻辑综合，LLM 自评只是被封顶的一个输入）。
 * 不允许「LLM1 说 complete → 直接 full」。
 */
export function decideOutput(input: MaturityInput): MaturityDecision {
  const result = scoreMaturity(input);
  const { rawInfo, volume, signals } = result;

  // 1) 讲得极少且信息贫乏 → 只能是 seed；任何意图都不能把它变成完整故事（Case1/2/5）
  if (volume.meaningfulChars < MATURITY_CONFIG.SEED_CHARS && rawInfo < MATURITY_CONFIG.INFO_FRAGMENT) {
    return 'seed';
  }

  // 2) full 要求「分数够 + 至少一条强证据」；LLM 自评在分数里已被封顶，无法单独触发 full
  const strongEvidence =
    signals.userRequestsOrganize || signals.userSaysComplete || rawInfo >= MATURITY_CONFIG.INFO_FULL;
  if (result.score >= MATURITY_CONFIG.FULL_THRESHOLD && strongEvidence) return 'full';

  // 3) 达到片段门槛，或信息已经够丰富 → fragment（Case3）
  if (result.score >= MATURITY_CONFIG.FRAGMENT_THRESHOLD || rawInfo >= MATURITY_CONFIG.INFO_FRAGMENT) {
    return 'fragment';
  }

  // 4) 用户明确要求整理，但材料确实很薄 → 至少给一个诚实的片段（用户主权），仍不编造
  if (signals.userRequestsOrganize) return 'fragment';

  return 'seed';
}

/**
 * 采访过程中自动留存时判断 seed / note（只用于 MemoryEntry，不影响 Story）。
 */
export function classifyMemory(input: MaturityInput): 'seed' | 'note' {
  const result = scoreMaturity(input);
  if (result.score >= MATURITY_CONFIG.NOTE_THRESHOLD || result.rawInfo >= MATURITY_CONFIG.INFO_FRAGMENT) {
    return 'note';
  }
  return 'seed';
}

/**
 * 是否值得作为长期记忆入口留存（修正5）。
 * 只作为「AI 主动替你记」的闸门；**用户明确要求保存时必须绕过它**（修正5护栏）。
 * 纯情绪宣泄（如「今天好累」）没有具体人物/事件/细节/用户自己的理解 → 不自动留存。
 */
export function isWorthSaving(memory: StoryMemory): boolean {
  const hasPerson = memory.people.some((person) => person.name.trim().length > 0);
  const hasEvent = memory.events.some((event) => event.description.trim().length >= 4);
  const hasDetail = memory.details.some((detail) => detail.detail.trim().length >= 4);
  const hasUserInsight =
    memory.turning_points.length > 0 || memory.meaning.some((item) => item.interpretation.trim().length >= 6);
  return hasUserInsight || hasPerson || hasEvent || hasDetail;
}

/**
 * 对话流程状态（修正3）：由状态机位置 + 是否结束推导，与故事成熟度无关。
 * 例：ended + fragment 完全合法。paused 由「用户离开页面」这一信号在 UI 层触发，这里不臆造。
 */
export function deriveConversationStatus(state: InterviewState, ended: boolean): ConversationStatus {
  if (ended || state === 'SAVED') return 'ended';
  return 'active';
}

/**
 * F1-6：已经明确结束的会话，下一句必须**另起一段 session**，不得被静默续上。
 * store 的 send 依据它决定要不要重置会话（topic / thread 保持不变，长期记忆仍连得上）。
 */
export function beginsNewSessionAfterEnd(ended: boolean): boolean {
  return ended;
}

/* ---------------- 状态迁移 ---------------- */

const ORDER: Record<InterviewState, number> = {
  START: 0,
  OPENING: 1,
  EXPLORING: 2,
  DEEPENING: 3,
  TURNING_POINT: 4,
  COMPLETING: 5,
  SUMMARY_CONFIRM: 6,
  SAVED: 7,
};

/** 不允许因为一轮没聊到就回退状态，避免「越聊越浅」 */
function forward(current: InterviewState, next: InterviewState): InterviewState {
  return ORDER[next] > ORDER[current] ? next : current;
}

export function nextState(input: MachineInput): MachineOutput {
  const { current, understanding, memory, userTurn } = input;
  const { signals } = understanding;
  const ruleHits: string[] = [];
  const report = assessCompleteness(memory);

  /* 1) 旁路状态优先级最高：想停下 > 敏感 > 困惑 */
  if (signals.wantsToStop) {
    return {
      state: current,
      branch: 'USER_WANTS_TO_STOP',
      action: 'stop',
      canComplete: report.ready,
      ruleHits: ['用户想结束 → 立即尊重，不再追问'],
    };
  }

  if (signals.sensitive) {
    return {
      state: current,
      branch: 'SENSITIVE_TOPIC',
      action: 'sensitive_confirm',
      canComplete: report.ready,
      ruleHits: ['检测到敏感内容 → 先征求意愿，不为完整而深挖'],
    };
  }

  if (signals.confused) {
    return {
      state: current,
      branch: 'USER_CONFUSED',
      action: 'confused_hint',
      canComplete: report.ready,
      ruleHits: ['用户不知怎么说 → 不催促，给很轻的提示'],
    };
  }

  if (signals.offTopic) {
    ruleHits.push('用户换话题 → 先判断新话题价值，不强行拉回');
  }

  /* 2) 正常推进 */
  let state = current;

  if (userTurn <= 1) {
    state = forward(state, 'OPENING');
    ruleHits.push('首轮回复 → OPENING：建立安全感 + 找故事入口');
  } else {
    state = forward(state, 'EXPLORING');
  }

  const hasHighValueClue = understanding.newClues.some(
    (clue) => clue.importance >= 4 && (clue.kind === 'detail' || clue.kind === 'meaning' || clue.kind === 'person'),
  );
  const isRichEnough = memory.events.length + memory.details.length >= 3;
  if (hasHighValueClue || isRichEnough) {
    state = forward(state, 'DEEPENING');
    ruleHits.push('发现高价值线索 → DEEPENING：往值得继续的地方走');
  }

  const newTurn = understanding.newClues.some((clue) => clue.kind === 'turning_point');
  if (newTurn || memory.turning_points.length > 0) {
    state = forward(state, 'TURNING_POINT');
    ruleHits.push('故事出现变化 → TURNING_POINT：追问「发生了什么让它变了」');
  }

  const completeness = mergeCompleteness(memory, understanding.completeness);
  // 两个条件都要满足：结构达到最低标准，且模型自己也认为差不多了。
  // 只有一条就收尾，是「聊两轮就宣布故事完整」的典型 badcase。
  const canComplete = report.ready && understanding.completeness >= 0.75;
  if (canComplete) {
    state = forward(state, 'COMPLETING');
    ruleHits.push('已达到「故事能独立成立」的最低标准 → COMPLETING：不再为补字段继续采访');
  }

  return {
    state,
    branch: signals.offTopic ? 'USER_CHANGES_TOPIC' : undefined,
    action: signals.offTopic ? 'follow_new_topic' : 'ask',
    canComplete,
    ruleHits,
  };
}

/** 用户点了「结束今天的聊天」但还想整理：COMPLETING → SUMMARY_CONFIRM */
export function enterSummaryConfirm(current: InterviewState): InterviewState {
  return forward(current, 'SUMMARY_CONFIRM');
}

/** 用户确认「这是我的故事」：SUMMARY_CONFIRM → SAVED */
export function enterSaved(current: InterviewState): InterviewState {
  return forward(current, 'SAVED');
}

export function isBranchState(state: string): state is BranchState {
  return (
    state === 'USER_WANTS_TO_STOP' ||
    state === 'SENSITIVE_TOPIC' ||
    state === 'USER_CONFUSED' ||
    state === 'USER_CHANGES_TOPIC'
  );
}
