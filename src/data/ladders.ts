import type { StoryMemory } from '../types/interview';

/**
 * 两条阶梯（原则 3 + 原则 4）。
 *
 * 原则 4 说「不要害怕重复，要学会换入口」——但"换入口"这件事不能交给模型临场发挥，
 * 因为它最容易的反应就是重复问同一个入口（你截图里那次「路上什么样」问了两遍）。
 *
 * 所以做成**确定性轮换**：从历史发言里判断哪些入口已经用过，下一次就用没用过的那个。
 * 好处是：可复现、可解释（观察面板会写明"上一入口失败 → 换到场景入口"）、永不原地打转。
 */

export interface LadderStep {
  id: string;
  label: string;
  /** 历史 AI 发言里命中这些特征，就算这个入口已经用过 */
  usedPattern: RegExp;
  /** 切换到这个入口时问的那一句 */
  question: string;
}

/**
 * 记忆入口阶梯：时间 → 场景 → 人物 → 感受 → 后来得知 → 意义。
 * 用户说「想不起来了」时，不是故事结束，而是这个入口失败了，换下一个。
 */
export const ENTRY_LADDER: LadderStep[] = [
  {
    id: 'time',
    label: '时间入口',
    usedPattern: /(什么时候|哪一年|哪一天|几几年|多久以前|哪阵子)/,
    question: '大概是什么时候的事，你还记得吗？',
  },
  {
    id: 'scene',
    label: '场景入口',
    // 注意别写成「学校还是」：真正问出来的是「是在学校，还是在家里？」中间有逗号
    usedPattern: /(在哪儿|在哪里|什么地方|哪个地方|哪个城市|学校，?还是|家里，?还是|是在学校|是在家里)/,
    question: '你还记得那时候大概是在学校，还是在家里？',
  },
  {
    id: 'people',
    label: '人物入口',
    usedPattern: /(身边有谁|还有谁|谁在|和谁|谁陪|谁跟着)/,
    question: '那时候你身边有谁？',
  },
  {
    id: 'feeling',
    label: '感受入口',
    usedPattern: /(什么感觉|心里|感受|你觉得|难受|开心|踏实)/,
    question: '那我们不找细节了。你现在想起这件事，最明显的感觉是什么？',
  },
  {
    id: 'hearsay',
    label: '后来得知入口',
    usedPattern: /(听别人|谁告诉你|后来才知道|是你自己记得|怎么知道的)/,
    question: '这件事是你自己记得的，还是后来听别人讲才知道的？',
  },
  {
    id: 'meaning',
    label: '意义入口',
    usedPattern: /(为什么.{0,8}记得|意味着|对你来说|为什么会记|一直记着)/,
    question: '你觉得，你为什么到现在还会记得这件事？',
  },
];

/**
 * 抽象降维阶梯：画面 → 最近一次 → 动作 → 场所。
 * 用户说「我大学过得很迷茫」时，不要问「为什么迷茫」，而要往下压成具体的画面和动作。
 */
export const CONCRETE_LADDER: LadderStep[] = [
  {
    id: 'picture',
    label: '画面',
    usedPattern: /(画面|哪一幕|第一个想到|什么样子)/,
    question: '如果从那段时间里找一个最能代表它的画面，你第一个想到的是什么？',
  },
  {
    id: 'recent',
    label: '最近一次',
    usedPattern: /(最近一次|上一次|最后一次)/,
    question: '你还记得最近一次这样的时候吗？',
  },
  {
    id: 'action',
    label: '动作',
    usedPattern: /(具体在做什么|在做什么|在忙什么|干什么)/,
    question: '那一次，你具体在做什么？',
  },
  {
    id: 'place',
    label: '场所',
    usedPattern: /(在哪儿|在哪里|什么地方)/,
    question: '当时是在哪儿？',
  },
];

/** 从历史 AI 发言里判断哪些入口/步骤已经用过 */
export function detectUsedSteps(texts: string[], ladder: LadderStep[]): Set<string> {
  const used = new Set<string>();
  for (const step of ladder) {
    if (texts.some((text) => step.usedPattern.test(text))) used.add(step.id);
  }
  return used;
}

/** 挑下一个没用过的阶梯步骤；全用过了就回到最深的一级（意义 / 场所） */
export function pickStep(used: Set<string>, ladder: LadderStep[]): LadderStep {
  return ladder.find((step) => !used.has(step.id)) ?? ladder[ladder.length - 1];
}

/**
 * 抽象降维的第一问要把用户自己那个抽象的词语挂回去——
 * 「最能代表『迷茫』的画面」比「代表它的画面」具体得多。
 */
export function buildConcreteQuestion(step: LadderStep, anchorWord: string): string {
  if (step.id === 'picture' && anchorWord) {
    return `如果从那段时间里找一个最能代表「${anchorWord}」的画面，你第一个想到的是什么？`;
  }
  return step.question;
}

/** 用户自己的抽象词优先，其次才用 memory 里的情绪标签 */
export function pickAbstractAnchor(userText: string, memory: StoryMemory): string {
  const fromUser = userText.match(/(迷茫|压抑|孤独|麻木|疲惫|委屈|不甘|焦虑|空落|无力)/);
  if (fromUser) return fromUser[1];
  return memory.emotions[memory.emotions.length - 1]?.emotion ?? '';
}
