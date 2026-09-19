/**
 * Phase 3.2.4-A · ASK Candidate（只决策、只记录，绝不执行提问）。
 *
 * 真实 runTurn（受控 LLM stub）+ 决策层单元校验。
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askCandidate.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState, StoryMemory } from '../src/types/interview';
import { classifyQuestionValue, evaluateAskCandidate } from '../src/services/interventionDecision';

let failed = 0;
const failures: string[] = [];
function expect(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

/* ==================== 受控 LLM stub ==================== */
useSettingsStore.getState().setLlm({
  mode: 'auto',
  baseUrl: 'http://test.local/v1',
  apiKey: 'test-key',
  model: 'test-model',
});

const TURNING_CLUE = '他当众说我的那一下';

function defaultUnderstanding(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    newClues: [{ kind: 'turning_point', text: TURNING_CLUE, importance: 5, userInitiated: true, evidence: '他当众说我' }],
    signals: {
      wantsToStop: false,
      sensitive: false,
      confused: false,
      offTopic: false,
      uncertainFact: false,
      emotionalIntensity: 0.3,
    },
    memoryPatch: null,
    completeness: 0.6,
    focus: '他当众说我',
    intent: 'ANSWER_STORY',
    ...extra,
  };
}

interface Q {
  [k: string]: unknown;
}
const HIGH_Q: Q = {
  ack: '嗯。',
  question: '是什么让你后来改变了对他的看法？',
  ask: false,
  target_clue: TURNING_CLUE,
  story_value: 5,
  user_initiative: 2,
  emotional_signal: 2,
  information_gain: 4,
  willingness: 3,
  disturbance_cost: 1,
  sensitivity_risk: 1,
};
const MEDIUM_Q: Q = {
  ...HIGH_Q,
  question: '你后来还见过他吗？',
  target_clue: TURNING_CLUE,
};
const FACT_Q: Q = {
  ...HIGH_Q,
  question: '那天是几点去的？',
};
const INFERENCE_Q: Q = {
  ...HIGH_Q,
  question: '是不是因为你其实很在意别人的看法？',
};

let questionCandidates: Q[] = [HIGH_Q];
let understandingRaw: Record<string, unknown> = defaultUnderstanding();

(globalThis as { fetch: unknown }).fetch = (async (_url: unknown, init: { body?: string }) => {
  let content = '{}';
  try {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content?: string }[] };
    const last = String(body?.messages?.[body.messages.length - 1]?.content ?? '');
    if (last.includes('只输出一个 JSON 对象')) content = JSON.stringify(understandingRaw);
    else if (last.includes('候选回应的 JSON 数组')) content = JSON.stringify(questionCandidates);
    else content = JSON.stringify({ ack: '嗯。', question: '', ask: false, reply: '嗯。' });
  } catch {
    /* ignore */
  }
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}) as unknown as typeof fetch;

/* ==================== 驱动 ==================== */
function memoryWithMaterial(): StoryMemory {
  return {
    ...createEmptyMemory(),
    turning_points: [{ before: '以前', after: '后来', trigger: '那天' }],
  };
}

async function turn(
  userText: string,
  options: {
    focus?: ConversationFocus;
    messages?: { role: 'user' | 'assistant'; text: string }[];
    understanding?: Record<string, unknown>;
    questions?: Q[];
    memory?: StoryMemory;
    clues?: unknown[];
  } = {},
): Promise<RunTurnOutput> {
  understandingRaw = options.understanding ?? defaultUnderstanding();
  questionCandidates = options.questions ?? [HIGH_Q];
  const input: RunTurnInput = {
    topicId: 'topic_ask_test',
    topicLabel: '一段经历',
    state: 'EXPLORING' as InterviewState,
    scriptStep: 1,
    memory: options.memory ?? memoryWithMaterial(),
    clues: (options.clues ?? []) as never[],
    highValueClues: [],
    messages: options.messages ?? [],
    userText,
    focus: options.focus,
  };
  return runTurn(input);
}

const askOf = (out: RunTurnOutput) => out.result.observer.decisionTrace?.askCandidate;
const execOf = (out: RunTurnOutput) => out.result.observer.decisionTrace?.askExecution;
const HIGH_USER = '他说了那句话之后我就再也没去过他家。';
const CONTRAST_USER = '那天我特别开心，但是一路上都装得很淡定。';

async function startWithReflect(): Promise<{
  focus: ConversationFocus;
  messages: { role: 'user' | 'assistant'; text: string }[];
}> {
  const t = await turn(CONTRAST_USER, { questions: [{ ...MEDIUM_Q, question: '可以再讲讲吗？' }] });
  return {
    focus: t.focus,
    messages: [
      { role: 'user', text: CONTRAST_USER },
      { role: 'assistant', text: t.result.reply },
    ],
  };
}

console.log('\n================ Phase 3.2.4-A · ASK Candidate ================\n');

/* ==================== 一、Question Value 判定 ==================== */
console.log('\n[一] Question Value（确定性）');
{
  const clues = [
    { id: 'c1', kind: 'turning_point', text: TURNING_CLUE, importance: 5, userInitiated: true, evidence: '', turn: 1 },
    { id: 'c2', kind: 'detail', text: '他手里的杯子', importance: 3, userInitiated: true, evidence: '', turn: 1 },
    { id: 'c3', kind: 'event', text: '我们去食堂吃饭', importance: 4, userInitiated: true, evidence: '', turn: 1 },
  ] as never[];
  expect('V1 转折线索 + 主线问题 + story_value 5 → HIGH',
    classifyQuestionValue({ question: '是什么让你后来改变了对他的看法？', targetClue: TURNING_CLUE, clues, questionerValue: 5 }) === 'HIGH');
  expect('V2 事件线索 → MEDIUM',
    classifyQuestionValue({ question: '你后来还见过他吗？', targetClue: '我们去食堂吃饭', clues, questionerValue: 5 }) === 'MEDIUM');
  expect('V3 资料型问题（几点）→ LOW',
    classifyQuestionValue({ question: '那天是几点去的？', targetClue: TURNING_CLUE, clues, questionerValue: 5 }) === 'LOW');
  expect('V4 细节线索 + 资料问题 → LOW',
    classifyQuestionValue({ question: '那个杯子是什么颜色的？', targetClue: '他手里的杯子', clues, questionerValue: 5 }) === 'LOW');
}

/* ==================== 二、真实 runTurn：允许产生 ASK 候选（A.2 后必须是「停顿 + 未展开线索」） ==================== */
console.log('\n[二] 允许产生 ASK_CANDIDATE');
const EARLIER_USER = '他说了那句话之后我就再也没去过他家。';
/** 累计线索：来自更早的用户原话（evidence 可回溯） */
const ACCUMULATED_CLUE = {
  id: 'c_turn', kind: 'turning_point', text: TURNING_CLUE, importance: 5,
  userInitiated: true, evidence: '我就再也没去过他家', turn: 1,
};
const EARLIER_MESSAGES = [
  { role: 'user' as const, text: EARLIER_USER },
  { role: 'assistant' as const, text: '嗯，我记下了。' },
];
/** 停顿型输入：没有新的故事推进（不是叙事/不涉及新事件） */
const PAUSE_USER = '反正那天挺乱的。';
function pauseUnderstanding(): Record<string, unknown> {
  return defaultUnderstanding({
    newClues: [{ kind: 'emotion', text: '挺乱的', importance: 4, userInitiated: true, evidence: '挺乱的' }],
  });
}
async function turnPause() {
  return turn(PAUSE_USER, {
    understanding: pauseUnderstanding(),
    questions: [HIGH_Q],
    clues: [ACCUMULATED_CLUE],
    messages: EARLIER_MESSAGES,
  });
}
{
  const out = await turnPause();
  console.log(`  用户：${PAUSE_USER}（此前：${EARLIER_USER}）\n  AI：${out.result.reply}`);
  console.log(`  askCandidate=${JSON.stringify(askOf(out))}`);
  expect('#1 HIGH Question Value + Timing HIGH（停顿 + 未展开线索）→ ASK_CANDIDATE', askOf(out)?.allowed === true);
  expect('#2 Question Value = HIGH', askOf(out)?.value === 'HIGH');
  expect('#2b Timing Value = HIGH', askOf(out)?.timingValue === 'HIGH');
  // Phase 3.2.4-B.1：allowed 的候选现在会真正执行（ASK Execution）
  // Phase 3.2.4-B.1.x H1：方向必须来自「材料证据」而非「是否出现人物」——
  // 本用例 evidence 含「我就再也没去过他家」→ 命中变化证据 → CHANGE（不再是 RELATIONSHIP）
  expect('#3 askExecution 允许执行且方向已判定', execOf(out)?.allowed === true && execOf(out)?.direction === 'CHANGE');
  expect('#4 ASK 已真正发出（observer 记录「ASK 已发出」）', out.result.observer.ruleHits.some((h) => h.includes('ASK 已发出')));
}
{
  // A.2：用户刚刚推进故事（A 类）→ 即使问题价值 HIGH，也不再产生候选
  const out = await turn(HIGH_USER);
  console.log(`  A.2 校验用户刚推进故事 → ${JSON.stringify(askOf(out))}`);
  expect('#4b 用户刚推进故事 → NO_ASK（fresh narrative）', askOf(out)?.allowed === false && askOf(out)?.freshNarrativeContribution === true);
}

/* ==================== 三、真实 runTurn：必须 NO_ASK ==================== */
console.log('\n[三] 必须 NO_ASK');
{
  const out = await turn(HIGH_USER, { questions: [MEDIUM_Q] });
  expect('#5 MEDIUM → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn(HIGH_USER, { questions: [FACT_Q] });
  console.log(`  reason=${askOf(out)?.reason}`);
  expect('#6 LOW（资料型）→ NO_ASK', askOf(out)?.allowed === false && askOf(out)?.value === 'LOW');
}
{
  const out = await turn(HIGH_USER, { questions: [{ ...HIGH_Q, question: '这个故事里还有什么没讲到的？' }] });
  expect('#7 仅为故事完整度（MEDIUM）→ NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn(HIGH_USER, { questions: [INFERENCE_Q] });
  console.log(`  reason=${askOf(out)?.reason}`);
  expect('#8 依赖 AI 心理解释的问法 → NO_ASK', askOf(out)?.allowed === false);
}
{
  const text = '他说了那句话之后我就再也没去过他家，而且那时候我还……';
  const out = await turn(text);
  expect('#9 activeExpression → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn(HIGH_USER, {
    understanding: defaultUnderstanding({
      signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.9 },
    }),
  });
  console.log(`  reason=${askOf(out)?.reason}`);
  expect('#10 情绪强度高 → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn(HIGH_USER, {
    understanding: defaultUnderstanding({
      userState: { expressionWillingness: 'HIGH', answeringWillingness: 'HIGH', storyCompletionExpectation: 'LOW', initiative: 'HIGH' },
    }),
  });
  expect('#11 userInitiative HIGH → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn(HIGH_USER, { memory: createEmptyMemory() });
  console.log(`  reason=${askOf(out)?.reason}`);
  expect('#12 没有上一轮用户材料 → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn('我突然发现我其实一直在躲着他。');
  expect('#13 用户自己已经发现 → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn('这个先不说了。');
  expect('#14 refusal → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn('不是这样的。', {
    messages: [{ role: 'assistant', text: '你刚才说我其实很在意，对吗？' }],
  });
  expect('#15 correction → NO_ASK', askOf(out)?.allowed === false);
}
{
  const base = await startWithReflect();
  const out = await turn(HIGH_USER, { focus: base.focus, messages: base.messages });
  console.log(`  reason=${askOf(out)?.reason}`);
  expect('#16 刚刚发生 REFLECT → NO_ASK（保护期）', askOf(out)?.allowed === false);
}
{
  const base = await startWithReflect();
  const t2 = await turn('对。', { focus: base.focus, messages: base.messages, questions: [MEDIUM_Q] });
  const t3 = await turn(HIGH_USER, {
    focus: t2.focus,
    messages: [...base.messages, { role: 'user', text: '对。' }, { role: 'assistant', text: t2.result.reply }],
  });
  console.log(`  reason=${askOf(t3)?.reason}`);
  expect('#17 刚刚发生 GENTLE PUSH → NO_ASK（保护期）', askOf(t3)?.allowed === false);
}
{
  const base = await startWithReflect();
  const out = await turn('后来我们就一起回去了。', { focus: base.focus, messages: base.messages });
  console.log(`  reason=${askOf(out)?.reason}`);
  expect('#18 用户正在主动继续原故事 → NO_ASK', askOf(out)?.allowed === false);
}
{
  const base = await startWithReflect();
  const out = await turn('因为那时候我其实很怕。', { focus: base.focus, messages: base.messages });
  expect('#19 用户已经自然展开（SELF_EXPANDED）→ NO_ASK', askOf(out)?.allowed === false);
}

/* ==================== 四、ASK 候选 → ASK 执行（Phase 3.2.4-B.1） ==================== */
console.log('\n[四] ASK_CANDIDATE → ASK Execution');
{
  const out = await turnPause();
  const hits = out.result.observer.ruleHits.join(' | ');
  console.log(`  ruleHits=${hits}`);
  expect('#20 allowed=true 且已真正执行', askOf(out)?.allowed === true && hits.includes('ASK 已发出'));
  expect('#21 一次只问一个（reply 里恰好 1 个问号）', (out.result.reply.match(/[？?]/g) ?? []).length === 1);
  expect('#22 reply 不来自 LLM 提问器（不是它给的那句问话）', !out.result.reply.includes('是什么让你后来改变了对他的看法'));
}

/* ==================== 五、决策层单元校验 ==================== */
console.log('\n[五] evaluateAskCandidate 单元校验');
{
  // H2.1 契约变化：Candidate 现在必须能产出可执行的 direction 与对齐的 question intent，
  // 否则即使其它条件全满足也不允许放行（Invariant 5）。因此 base 需带 clue + question。
  const base = {
    value: 'HIGH' as const,
    timingValue: 'HIGH' as const,
    interruptionCost: 'LOW' as const,
    hasPriorMaterial: true,
    groundedInUserMaterial: true,
    clue: { kind: 'turning_point', text: '我不再去那个地方了', evidence: '后来我不再去那个地方了。' },
    question: '你后来是从哪一件事开始变的？',
  };
  expect('U1 全部条件满足（含 Timing HIGH）→ allowed', evaluateAskCandidate(base).allowed === true);
  expect('U1b Timing LOW → 拒绝', evaluateAskCandidate({ ...base, timingValue: 'LOW' }).allowed === false);
  expect('U1c fresh narrative → 拒绝', evaluateAskCandidate({ ...base, freshNarrativeContribution: true }).allowed === false);
  expect('U2 interruptionCost HIGH → 拒绝', evaluateAskCandidate({ ...base, interruptionCost: 'HIGH' }).allowed === false);
  expect('U3 active → 拒绝', evaluateAskCandidate({
    ...base,
    activeExpression: { active: true, streak: 1, lastUserExpanded: true, lastNaturalStop: false, confidence: 'HIGH' },
  }).allowed === false);
  expect('U4 emotion 高 → 拒绝', evaluateAskCandidate({ ...base, emotionIntensity: 0.8 }).allowed === false);
  expect('U5 userInitiative 高 → 拒绝', evaluateAskCandidate({ ...base, userInitiative: 'VERY_HIGH' }).allowed === false);
  expect('U6 刚 REFLECT → 拒绝', evaluateAskCandidate({ ...base, priorCandidate: 'REFLECT_CANDIDATE' }).allowed === false);
  expect('U7 刚 GENTLE PUSH → 拒绝', evaluateAskCandidate({ ...base, priorCandidate: 'GENTLE_PUSH_CANDIDATE' }).allowed === false);
  expect('U8 用户继续故事 → 拒绝', evaluateAskCandidate({ ...base, continuedStory: true }).allowed === false);
  expect('U9 userOwned → 拒绝', evaluateAskCandidate({ ...base, userOwnedDiscovery: true }).allowed === false);
  expect('U10 refusal → 拒绝', evaluateAskCandidate({ ...base, refusal: true }).allowed === false);
  expect('U11 correction → 拒绝', evaluateAskCandidate({ ...base, correction: true }).allowed === false);
  expect('U12 无 previous material → 拒绝', evaluateAskCandidate({ ...base, hasPriorMaterial: false }).allowed === false);
  expect('U13 AI 推断 → 拒绝', evaluateAskCandidate({ ...base, dependsOnAiInference: true }).allowed === false);
  expect('U14 非用户材料 → 拒绝', evaluateAskCandidate({ ...base, groundedInUserMaterial: false }).allowed === false);
  expect('U15 MEDIUM → 拒绝', evaluateAskCandidate({ ...base, value: 'MEDIUM' }).allowed === false);
  expect('U16 LOW → 拒绝', evaluateAskCandidate({ ...base, value: 'LOW' }).allowed === false);
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-A ASK Candidate 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
