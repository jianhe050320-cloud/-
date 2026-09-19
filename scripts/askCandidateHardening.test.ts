/**
 * Phase 3.2.4-A.2 · ASK Candidate Hardening。
 * 三个修复：① grounding 回溯用户原话 ② fresh narrative contribution ③ Timing Value 正向证据。
 *
 * 真实 runTurn（受控 LLM stub）+ 决策层单元校验。
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askCandidateHardening.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState, StoryMemory } from '../src/types/interview';
import {
  detectFreshNarrativeContribution,
  evaluateTimingValue,
  evaluateAskCandidate,
} from '../src/services/interventionDecision';
import type { ActiveExpressionState } from '../src/types/intervention';

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

/* ==================== stub ==================== */
useSettingsStore.getState().setLlm({ mode: 'auto', baseUrl: 'http://test.local/v1', apiKey: 'k', model: 'm' });

const TURNING = '他当众说我的那一下';
const EARLIER_USER = '他说了那句话之后我就再也没去过他家。';
const PAUSE_USER = '反正那天挺乱的。';

function und(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    newClues: [{ kind: 'emotion', text: '挺乱的', importance: 4, userInitiated: true, evidence: '挺乱的' }],
    signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.3 },
    memoryPatch: null, completeness: 0.6, focus: '那天', intent: 'ANSWER_STORY',
    ...extra,
  };
}
const Q_HIGH = {
  ack: '嗯。', question: '是什么让你后来改变了对他的看法？', ask: false, target_clue: TURNING,
  story_value: 5, user_initiative: 2, emotional_signal: 2, information_gain: 4, willingness: 3, disturbance_cost: 1, sensitivity_risk: 1,
};
const Q_MED: Record<string, unknown> = { ...Q_HIGH, question: '你后来还见过他吗？' };
const Q_FACT: Record<string, unknown> = { ...Q_HIGH, question: '那天是几点去的？' };
const Q_COMPLETENESS: Record<string, unknown> = { ...Q_HIGH, question: '这个故事里还有什么没讲到的？' };

const CLUE_TRACEABLE = {
  id: 'c1', kind: 'turning_point', text: TURNING, importance: 5, userInitiated: true, evidence: '我就再也没去过他家', turn: 1,
};
const CLUE_HALLUCINATED = {
  id: 'c2', kind: 'turning_point', text: TURNING, importance: 5, userInitiated: true, evidence: '他当众说我', turn: 1,
};
const EARLIER_MESSAGES = [
  { role: 'user' as const, text: EARLIER_USER },
  { role: 'assistant' as const, text: '嗯，我记下了。' },
];

let understandingRaw: Record<string, unknown> = und();
let questionCandidates: unknown[] = [Q_HIGH];
(globalThis as { fetch: unknown }).fetch = (async (_u: unknown, init: { body?: string }) => {
  let content = '{}';
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content?: string }[] };
  const last = String(body?.messages?.[body.messages.length - 1]?.content ?? '');
  if (last.includes('只输出一个 JSON 对象')) content = JSON.stringify(understandingRaw);
  else if (last.includes('候选回应的 JSON 数组')) content = JSON.stringify(questionCandidates);
  else content = JSON.stringify({ ack: '嗯。', question: '', ask: false, reply: '嗯。' });
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}) as unknown as typeof fetch;

function mem(withMaterial = true): StoryMemory {
  return withMaterial ? { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] } : createEmptyMemory();
}

interface TurnOpts {
  U?: Record<string, unknown>;
  Q?: unknown[];
  M?: StoryMemory;
  clues?: unknown[];
  messages?: { role: 'user' | 'assistant'; text: string }[];
  focus?: ConversationFocus;
}
async function turn(userText: string, o: TurnOpts = {}): Promise<RunTurnOutput> {
  understandingRaw = o.U ?? und();
  questionCandidates = o.Q ?? [Q_HIGH];
  const input = {
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: o.M ?? mem(), clues: (o.clues ?? []) as never[], highValueClues: [],
    messages: o.messages ?? [], userText, focus: o.focus,
  } as RunTurnInput;
  return runTurn(input);
}
const askOf = (out: RunTurnOutput) => out.result.observer.decisionTrace?.askCandidate;

/** 允许场景：停顿 + 未展开的重要线索 + 可回溯 evidence */
async function turnPause() {
  return turn(PAUSE_USER, { U: und(), Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
}

console.log('\n================ Phase 3.2.4-A.2 · ASK Candidate Hardening ================\n');

/* ==================== A. Grounding 回溯用户原话 ==================== */
console.log('\n[A] Grounding（User Raw → Evidence → Clue → Question）');
{
  const out = await turnPause();
  console.log(`  A1 askCandidate=${JSON.stringify(askOf(out))}`);
  expect('A1 clue 有用户原话证据 → 通过 grounding → ASK_CANDIDATE', askOf(out)?.allowed === true);
}
{
  // clue.evidence 与原话无重叠（只存在于 LLM interpretation）
  const out = await turn(PAUSE_USER, { U: und(), Q: [Q_HIGH], clues: [CLUE_HALLUCINATED], messages: EARLIER_MESSAGES });
  console.log(`  A2 reason=${askOf(out)?.reason}`);
  expect('A2 clue 只有 LLM 解释、原话无对应证据 → NO_ASK', askOf(out)?.allowed === false);
  expect('A2 理由是「无法回溯到用户原话」', (askOf(out)?.reason ?? '').includes('无法回溯'));
}
{
  // K 类：幻觉 clue + candidate，用户原话完全无关
  const out = await turn('今天天气不错。', { U: und(), Q: [Q_HIGH], clues: [CLUE_HALLUCINATED], messages: [] });
  expect('A3 LLM 幻觉 clue + candidate（K 类）→ NO_ASK', askOf(out)?.allowed === false);
}
{
  // evidence 逐字出现在更早的用户消息里
  const out = await turn(PAUSE_USER, { U: und(), Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
  expect('A4 evidence 逐字出自更早的用户消息 → 通过', askOf(out)?.allowed === true);
}
{
  // target_clue 不在任何线索中
  const out = await turn(PAUSE_USER, { U: und(), Q: [{ ...Q_HIGH, target_clue: '根本不存在的线索' }], clues: [], messages: EARLIER_MESSAGES });
  expect('A5 target_clue 不在线索表 → NO_ASK', askOf(out)?.allowed === false);
}

/* ==================== B. Fresh Narrative Contribution ==================== */
console.log('\n[B] Fresh Narrative Contribution');
{
  const cases: { id: string; text: string }[] = [
    { id: 'B1', text: '我们就一起回去了。' },
    { id: 'B2', text: '后来我们就一起回去了。' },
    { id: 'B3', text: '然后我就离开了。' },
    { id: 'B4', text: '我去了他家。' },
    { id: 'B5', text: '第二天我们见了一面。' },
  ];
  for (const c of cases) {
    const out = await turn(c.text, { U: und({ newClues: [{ kind: 'event', text: '一起回去', importance: 4, userInitiated: true, evidence: '一起回去' }] }), Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
    console.log(`  ${c.id}「${c.text}」→ allowed=${askOf(out)?.allowed} fresh=${askOf(out)?.freshNarrativeContribution}`);
    expect(`${c.id}「${c.text}」→ NO_ASK（新叙述推进）`, askOf(out)?.allowed === false && askOf(out)?.freshNarrativeContribution === true);
  }
}
{
  const ae: ActiveExpressionState = { active: false, streak: 0, lastUserExpanded: false, lastNaturalStop: false, confidence: 'LOW' };
  const r = detectFreshNarrativeContribution({ userText: '也许吧。', activeExpression: ae });
  expect('B6 不确定是否还会继续讲 → 保守视为推进（NO_ASK）', r.value === true);
  const ok = detectFreshNarrativeContribution({
    userText: PAUSE_USER,
    activeExpression: { active: false, streak: 0, lastUserExpanded: false, lastNaturalStop: true, confidence: 'LOW' },
  });
  expect('B7 真正停顿且没有新叙述 → 不算推进（才允许继续评估）', ok.value === false);
}
{
  const out = await turnPause();
  expect('B8 停顿 + 无新叙述 → 才可能进入 ASK_CANDIDATE', askOf(out)?.allowed === true && askOf(out)?.freshNarrativeContribution === false);
}

/* ==================== C. Timing Value ==================== */
console.log('\n[C] Timing Value（正向证据）');
{
  const t1 = evaluateTimingValue({ freshNarrativeContribution: false, activeExpression: { active: false, streak: 0, lastUserExpanded: false, lastNaturalStop: true, confidence: 'LOW' }, targetIsUnresolvedThread: true, userReadiness: true });
  expect('C1 停顿 + 未展开线索 + readiness → Timing HIGH', t1.value === 'HIGH');
  expect('C2 fresh narrative → Timing LOW', evaluateTimingValue({ freshNarrativeContribution: true, activeExpression: { active: false, streak: 0, lastUserExpanded: false, lastNaturalStop: true, confidence: 'LOW' }, targetIsUnresolvedThread: true, userReadiness: true }).value === 'LOW');
  expect('C3 无自然停顿 → Timing LOW', evaluateTimingValue({ freshNarrativeContribution: false, activeExpression: { active: false, streak: 0, lastUserExpanded: false, lastNaturalStop: false, confidence: 'LOW' }, targetIsUnresolvedThread: true, userReadiness: true }).value === 'LOW');
  expect('C4 无 unresolved thread → Timing LOW', evaluateTimingValue({ freshNarrativeContribution: false, activeExpression: { active: false, streak: 0, lastUserExpanded: false, lastNaturalStop: true, confidence: 'LOW' }, targetIsUnresolvedThread: false, userReadiness: true }).value === 'LOW');
  expect('C5 无 user readiness → Timing LOW', evaluateTimingValue({ freshNarrativeContribution: false, activeExpression: { active: false, streak: 0, lastUserExpanded: false, lastNaturalStop: true, confidence: 'LOW' }, targetIsUnresolvedThread: true, userReadiness: false }).value === 'LOW');
  expect('C6 仍在连续表达 → Timing LOW', evaluateTimingValue({ freshNarrativeContribution: false, activeExpression: { active: true, streak: 1, lastUserExpanded: true, lastNaturalStop: false, confidence: 'HIGH' }, targetIsUnresolvedThread: true, userReadiness: true }).value === 'LOW');
}
{
  const out = await turnPause();
  expect('C7 Question HIGH + Timing HIGH → ASK_CANDIDATE', askOf(out)?.allowed === true);
}
{
  // 目标线索不是「未展开的重要线索」（memory.meaning 非空 → 视为已展开）
  const m = { ...mem(), meaning: [{ interpretation: '他其实在意我', confirmed_by_user: false }] };
  const out = await turn(PAUSE_USER, { U: und(), Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES, M: m });
  console.log(`  C8 reason=${askOf(out)?.reason}`);
  expect('C8 该线索已展开（meaning 非空）→ Timing LOW → NO_ASK', askOf(out)?.allowed === false && askOf(out)?.timingValue === 'LOW');
}
{
  // 无 user readiness（回答意愿 LOW）
  const out = await turn(PAUSE_USER, {
    U: und({ userState: { expressionWillingness: 'LOW', answeringWillingness: 'LOW', storyCompletionExpectation: 'LOW', initiative: 'LOW' } }),
    Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES,
  });
  expect('C9 无 user readiness → NO_ASK', askOf(out)?.allowed === false);
}

/* ==================== D. 既有保护 ==================== */
console.log('\n[D] 既有保护（保持不变）');
{
  const out = await turn(`${PAUSE_USER.slice(0, -1)}，而且那时候我还……`, { U: und(), Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
  expect('D1 activeExpression → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn(PAUSE_USER, {
    U: und({ signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.9 } }),
    Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES,
  });
  expect('D2 情绪高 → NO_ASK', askOf(out)?.allowed === false);
}
{
  expect('D3 interruptionCost HIGH → NO_ASK（单元）', evaluateAskCandidate({ value: 'HIGH', timingValue: 'HIGH', interruptionCost: 'HIGH', hasPriorMaterial: true, groundedInUserMaterial: true }).allowed === false);
}
{
  const t1 = await turn('那天我特别开心，但是一路上都装得很淡定。', { Q: [Q_MED] });
  const out = await turn(PAUSE_USER, { U: und(), Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: [{ role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' }, { role: 'assistant', text: t1.result.reply }], focus: t1.focus });
  expect('D4 刚 REFLECT → NO_ASK', askOf(out)?.allowed === false);
}
{
  const t1 = await turn('那天我特别开心，但是一路上都装得很淡定。', { Q: [Q_MED] });
  const t2 = await turn('对。', { focus: t1.focus, messages: [{ role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' }, { role: 'assistant', text: t1.result.reply }], Q: [Q_MED] });
  const out = await turn(PAUSE_USER, {
    U: und(), Q: [Q_HIGH], clues: [CLUE_TRACEABLE],
    messages: [{ role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' }, { role: 'assistant', text: t1.result.reply }, { role: 'user', text: '对。' }, { role: 'assistant', text: t2.result.reply }],
    focus: t2.focus,
  });
  expect('D5 刚 GENTLE PUSH → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn('我突然发现我其实一直在躲着他。', { U: und(), Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
  expect('D6 USER_OWNED_DISCOVERY → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn('这个先不说了。', { Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
  expect('D7 refusal → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn('不是这样的。', { Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: [{ role: 'assistant', text: '你刚才说我其实很在意，对吗？' }] });
  expect('D8 correction → NO_ASK', askOf(out)?.allowed === false);
}
{
  const out = await turn(PAUSE_USER, {
    U: und({ userState: { expressionWillingness: 'HIGH', answeringWillingness: 'HIGH', storyCompletionExpectation: 'LOW', initiative: 'HIGH' } }),
    Q: [Q_HIGH], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES,
  });
  expect('D9 userInitiative HIGH → NO_ASK', askOf(out)?.allowed === false);
}

/* ==================== E. 既有价值判断 ==================== */
console.log('\n[E] 既有价值判断（未扩大 HIGH 范围）');
{
  const out = await turn(PAUSE_USER, { U: und(), Q: [Q_MED], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
  console.log(`  E1 reason=${askOf(out)?.reason}`);
  expect('E1 MEDIUM → NO_ASK', askOf(out)?.allowed === false && askOf(out)?.value === 'MEDIUM');
}
{
  const out = await turn(PAUSE_USER, { U: und(), Q: [Q_FACT], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
  expect('E2 LOW（资料型）→ NO_ASK', askOf(out)?.allowed === false && askOf(out)?.value === 'LOW');
}
{
  const out = await turn(PAUSE_USER, { U: und(), Q: [Q_COMPLETENESS], clues: [CLUE_TRACEABLE], messages: EARLIER_MESSAGES });
  expect('E3 纯故事完整度 → NO_ASK', askOf(out)?.allowed === false);
}
{
  expect('E4 Timing HIGH 但 Question MEDIUM → NO_ASK（单元）', evaluateAskCandidate({ value: 'MEDIUM', timingValue: 'HIGH', interruptionCost: 'LOW', hasPriorMaterial: true, groundedInUserMaterial: true }).allowed === false);
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-A.2 ASK Candidate Hardening 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
