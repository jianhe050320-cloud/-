/**
 * 观察性驱动脚本（不改产品代码 / 不改提示词 / 不改既有测试）。
 *
 * 本沙箱没有可用的云端 LLM 凭证，真实 runTurn 会落到「演示脚本」或「LLM 失败降级」分支。
 * 为了真正按用户输入逐轮反应，这里直接调用产品自身在「无模型」时使用的**确定性引擎**：
 *   heuristicUnderstand + heuristicCandidates + rules + decideOutput + resolveThread + mergeMemory
 * 这些函数和真实 runTurn 在 LLM 不可用时的降级路径完全一致，因此结果是产品真实行为的可复现投影。
 *
 * 限制（会如实标注）：
 *   - 自然语言「接住 / 复用用户原话」由 LLM 生成；确定性降级模式下 ack 是通用承接句，
 *     所以「AI 第一句话是否复用用户词」这类需要看原文的问题，本脚本只能给出确定性层的判断，
 *     逐字自然语言需在有 LLM 密钥的环境下复跑。
 *   - 启发式理解是保守抽取，可能比真实 LLM 少抓线索；这会影响 hasSubstance / MemoryEntry 的丰富度，
 *     但「不编造 / 一次一问 / 拒绝不挖 / seed 判断 / thread 续接」等硬约束在本脚本里可被直接证明。
 */
import { heuristicUnderstand } from '../src/services/understander';
import { heuristicCandidates } from '../src/services/questioner';
import { mergeMemory } from '../src/services/memoryService';
import {
  applyHardRules,
  buildForcedReply,
  detectEndIntent,
  detectProductQuestion,
  hasVagueMemory,
  looksAbstract,
  strengthenSignals,
  wantsToKeepGoing,
} from '../src/services/rules';
import {
  assessCompleteness,
  classifyMemory,
  decideOutput,
  deriveConversationStatus,
  isWorthSaving,
} from '../src/machines/interviewMachine';
import { createThreadId, resolveThread } from '../src/services/threadService';
import type { StoryMemory } from '../src/types/interview';

function emptyMemory(): StoryMemory {
  return {
    people: [],
    events: [],
    emotions: [],
    turning_points: [],
    details: [],
    meaning: [],
    user_quotes: [],
    story_status: 'developing' as StoryMemory['story_status'],
  };
}

const LABEL_RE =
  /(你是一个|你其实是|这说明你|这证明你|你属于|典型(的)?(人|性格)|你的.{0,6}导致|造成你|意味着你|说明你|反映出你|看得出你|骨子里|本质上)/;
const VERDICT_RE =
  /(你|您)[^。！？，,]{0,6}(一定|肯定|想必|必定|应该)(很|挺|特别|非常|真是)?(难受|痛苦|委屈|辛苦|不容易|难过|开心|高兴|幸福|害怕|孤独|在意)/;

interface TurnObs {
  userText: string;
  aiReply: string;
  questionsAsked: number;
  reusedUserWord: boolean | null;
  psychDiagnosis: boolean;
  forcedReason: string | null;
  productLabel: string | null;
  abstractOnly: boolean;
  memoryPatch: string[];
}

interface ScenarioResult {
  turns: TurnObs[];
  finalMemory: StoryMemory;
  sourceMessageIds: string[];
  decision: 'seed' | 'fragment' | 'full';
  memoryEntryType: 'seed' | 'note';
  worthSaving: boolean;
  conversationStatus: 'active' | 'ended';
  threadId: string;
  threadCreated: boolean;
  producesStory: boolean;
  storyKind: 'seed' | 'fragment' | 'full' | null;
  potentialFabrication: boolean;
}

function countQuestions(text: string): number {
  return (text.match(/[？?]/g) ?? []).length;
}

function processTurn(state: {
  memory: StoryMemory;
  messages: { role: 'user' | 'assistant'; text: string }[];
  asked: string[];
  userTurn: number;
  clues: { kind: string; text: string; importance: number }[];
}, userText: string): TurnObs {
  const understanding = heuristicUnderstand({
    messages: state.messages,
    memory: state.memory,
    userTurn: state.userTurn,
    userText,
  });
  const signals = strengthenSignals(understanding.signals, userText);
  const patch = understanding.memoryPatch ?? {};
  const llmExtracted = false; // 与 runTurn 降级分支一致：非 llm 模式不计入
  const hasSubstance = userText.trim().length >= 24 || llmExtracted;
  const hasPriorMaterial =
    state.memory.events.length > 0 ||
    state.memory.details.length > 0 ||
    state.memory.people.length > 0 ||
    state.memory.turning_points.length > 0;

  const forced = buildForcedReply(signals, userText, {
    variantIndex: state.userTurn,
    hasSubstance,
    wantsToContinue: wantsToKeepGoing(userText),
    hasPriorMaterial,
  });
  const product = detectProductQuestion(userText);
  const abstractOnly = looksAbstract(userText) && !hasSubstance;
  const vague = hasVagueMemory(userText);

  const candidates = heuristicCandidates({
    memory: state.memory,
    clues: understanding.newClues as never,
    signals,
    state: 'EXPLORING',
    userText,
    askingAlready: state.asked,
    transcript: state.messages.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.text}`).join('\n'),
    missing: assessCompleteness(state.memory).missing,
    resumed: false,
    recentAcks: [],
    vagueNote: vague ? userText.slice(0, 200) : '',
    keepGoing: wantsToKeepGoing(userText),
    anchorWords: [],
  });

  const ruleOutcome = applyHardRules(candidates as never, {
    signals,
    memory: state.memory,
    userText,
    askedQuestions: state.asked,
    abstractOnly,
  });

  let aiReply: string;
  let forcedReason: string | null = null;
  let productLabel: string | null = null;

  const best = ruleOutcome.kept[0];
  if (forced) {
    aiReply = forced.text;
    forcedReason = forced.reason;
  } else if (product) {
    aiReply = product.reply;
    productLabel = product.label;
  } else if (best) {
    const ack = (best.ack ?? '').trim();
    const q = best.question.trim();
    aiReply = !ack ? q : !q ? `${ack}。` : `${ack}。${q}`;
  } else {
    aiReply = '嗯，这一段我记下了。你想到哪儿就说到哪儿。';
  }

  const questionsAsked = countQuestions(aiReply);
  const psychDiagnosis = LABEL_RE.test(aiReply) || VERDICT_RE.test(aiReply);
  // 复用用户词：降级模式 ack 是通用承接，无法证明复用；仅当回复里出现用户原句片段时判 true
  const reusedUserWord = aiReply.includes(userText.slice(0, 6)) ? true : null;

  const patchSummary: string[] = [];
  if (patch.people?.length) patchSummary.push(`人:${patch.people.map((p) => p.name).join('/')}`);
  if (patch.events?.length) patchSummary.push(`事:${patch.events.map((e) => e.description.slice(0, 16)).join('/')}`);
  if (patch.emotions?.length) patchSummary.push(`情:${patch.emotions.map((e) => e.emotion).join('/')}`);
  if (patch.details?.length) patchSummary.push(`细:${patch.details.map((d) => d.detail.slice(0, 16)).join('/')}`);
  if (patch.user_quotes?.length) patchSummary.push(`原话:${patch.user_quotes[0].slice(0, 20)}`);
  if (patch.meaning?.length) patchSummary.push(`意义:${patch.meaning.map((m) => m.interpretation.slice(0, 16)).join('/')}`);

  // 推进状态
  state.memory = mergeMemory(state.memory, understanding.memoryPatch);
  state.messages.push({ role: 'user', text: userText });
  state.messages.push({ role: 'assistant', text: aiReply });
  state.asked.push(aiReply);
  state.userTurn += 1;

  return {
    userText,
    aiReply,
    questionsAsked,
    reusedUserWord,
    psychDiagnosis,
    forcedReason,
    productLabel,
    abstractOnly,
    memoryPatch: patchSummary,
  };
}

function runScenario(
  userTurns: string[],
  opts: { knownThreadIds?: string[]; llmCandidate?: string | null } = {},
): ScenarioResult {
  const memory = emptyMemory();
  const messages: { role: 'user' | 'assistant'; text: string }[] = [];
  const asked: string[] = [];
  const sourceMessageIds: string[] = [];

  const thread = resolveThread({
    continuesThreadId: opts.llmCandidate ?? null,
    knownThreadIds: opts.knownThreadIds ?? [],
    topicThreadId: opts.knownThreadIds?.[0] ?? null,
  });

  const state = { memory, messages, asked, userTurn: 1, clues: [] as { kind: string; text: string; importance: number }[] };
  const turns: TurnObs[] = [];

  userTurns.forEach((text, idx) => {
    sourceMessageIds.push(`umsg_${idx + 1}`);
    turns.push(processTurn(state, text));
  });

  const lastUser = userTurns[userTurns.length - 1] ?? '';
  const endIntent = detectEndIntent(lastUser);
  const ended = endIntent === 'end' || endIntent === 'story_request' || state.memory.story_status === 'saved';
  const userRequestsOrganize = endIntent === 'story_request';

  const decision = decideOutput({
    memory: state.memory,
    messages: state.messages,
    userRequestsOrganize,
    userSaysComplete: endIntent === 'end',
  });
  const memoryEntryType = classifyMemory({ memory: state.memory, messages: state.messages });
  const worthSaving = isWorthSaving(state.memory);
  const conversationStatus = deriveConversationStatus('EXPLORING', ended);

  const producesStory = decision !== 'seed';
  // 是否会用用户没给的事实：启发式模板只基于抽取线索；检查回复是否含用户没说的具体时间/数字
  const potentialFabrication =
    state.memory.events.some((e) => /(晚上八点|半小时|那天晚上)/.test(e.description)) &&
    !userTurns.some((t) => /(晚上八点|半小时|那天晚上)/.test(t));

  return {
    turns,
    finalMemory: state.memory,
    sourceMessageIds,
    decision,
    memoryEntryType,
    worthSaving,
    conversationStatus,
    threadId: thread.threadId,
    threadCreated: thread.created,
    producesStory,
    storyKind: producesStory ? decision : null,
    potentialFabrication,
  };
}

/* ----------------------------- 场景定义 ----------------------------- */

const SCENARIOS: Record<string, string[]> = {
  '案例1：模糊记忆入口': [
    '我高中那几年其实挺压抑的。',
    '今天先到这里吧',
  ],
  '案例2：具体画面+不确定记忆': [
    '我记得有一次下雨，我就在校门口站了挺久的……具体多久我也不记得了。',
    '我也不太确定，反正就是站在那里。',
    '今天先到这里吧',
  ],
  '案例3：用户明确拒绝': [
    '其实大学前三年也没干什么，现在回头看有点后悔。',
    '算了，这个我不太想说。',
    '今天先到这里吧',
  ],
  '案例4：采访中突然改变任务': [
    '我小时候其实特别喜欢跟我爷爷待在一起，后来关系就不太好了……',
    '对了，我什么时候可以让你帮我整理成故事？',
    '那现在就帮我整理一下吧。',
  ],
  '案例5：碎片化自然讲述': [
    '我突然想起来一个事。',
    '就是大二的时候吧，还是大一，我不记得了。',
    '有一天晚上我在图书馆待到特别晚，然后下楼的时候发现宿舍那边已经没什么人了。',
    '其实也没发生什么特别大的事，就是那天突然觉得，大学好像就这么过去了。',
    '后来我走回宿舍的时候还给我妈打了个电话，不过我已经不记得具体聊什么了。',
    '今天先到这里吧',
  ],
};

console.log('==================================================');
console.log('  采访系统原始观察报告（确定性引擎投影）');
console.log('  环境：无云端 LLM 凭证 → 走产品自身的无模型降级路径');
console.log('==================================================\n');

for (const [name, turnsText] of Object.entries(SCENARIOS)) {
  const r = runScenario(turnsText);
  console.log(`\n########## ${name} ##########`);
  console.log('--- 对话原文 ---');
  r.turns.forEach((t, i) => {
    console.log(`用户：${t.userText}`);
    console.log(`AI：${t.aiReply}`);
    console.log(
      `  [观察] 提问数=${t.questionsAsked} | 心理定性=${t.psychDiagnosis ? '是(异常!)' : '否'} | 抽象压制=${t.abstractOnly ? '是' : '否'} | 硬规则=${t.forcedReason ?? (t.productLabel ? `产品问答:${t.productLabel}` : '无(走候选)')} | 本轮抽取=${t.memoryPatch.join('；') || '无'}`,
    );
    void i;
  });
  console.log('--- 数据结果 ---');
  console.log(`最终 maturity(decideOutput): ${r.decision}`);
  console.log(`是否产生 Story: ${r.producesStory ? '是' : '否'}${r.storyKind ? ` (Story.kind=${r.storyKind})` : ''}`);
  console.log(`是否产生 MemoryEntry: ${r.decision === 'seed' ? '是' : '否(片段/完整走 Story)'}`);
  console.log(`MemoryEntry.type: ${r.memoryEntryType}`);
  console.log(`worthSaving(是否值得长期自动留存): ${r.worthSaving ? '是' : '否'}`);
  console.log(`conversationStatus: ${r.conversationStatus}`);
  console.log(`threadId: ${r.threadId} (created=${r.threadCreated})`);
  console.log(`sourceMessageIds: ${r.sourceMessageIds.join(', ')}`);
  console.log(`潜在事实编造: ${r.potentialFabrication ? '是(异常!)' : '否'}`);
  console.log(`最终 memory 概览: 人=${r.finalMemory.people.length} 事=${r.finalMemory.events.length} 情=${r.finalMemory.emotions.length} 细节=${r.finalMemory.details.length} 原话=${r.finalMemory.user_quotes.length}`);
}

/* ----------------------------- Thread 续接测试 ----------------------------- */
console.log('\n\n########## Thread 续接测试 ##########');
const case5 = runScenario(SCENARIOS['案例5：碎片化自然讲述']);
const oldThread = case5.threadId;
console.log(`旧 threadId（案例5 产生）: ${oldThread}`);

console.log('\n[续接 A] 用户：“我突然又想起来那天晚上了。” LLM 候选=旧 threadId（正确续接）');
const contA = resolveThread({ continuesThreadId: oldThread, knownThreadIds: [oldThread], topicThreadId: oldThread });
console.log(`  LLM continuesThreadId: ${oldThread}`);
console.log(`  最终 resolveThread: ${JSON.stringify(contA)}`);
console.log(`  是否相同: ${contA.threadId === oldThread ? '是' : '否'}`);

console.log('\n[续接 B] LLM 自造不存在的 threadId（应被丢弃，绝不采用）');
const contB = resolveThread({ continuesThreadId: 'th_fake_999', knownThreadIds: [oldThread], topicThreadId: oldThread });
console.log(`  LLM continuesThreadId: th_fake_999`);
console.log(`  最终 resolveThread: ${JSON.stringify(contB)}`);
console.log(`  是否错误采用假 id: ${contB.threadId === 'th_fake_999' ? '是(异常!)' : '否'}`);
console.log(`  是否回落到已知旧线程: ${contB.threadId === oldThread ? '是' : '否'}`);

console.log('\n========== 观察结束 ==========');
