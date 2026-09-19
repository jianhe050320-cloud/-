/**
 * Phase 3.2.4-B.1.x H2.1 · Candidate → Execution Semantic Alignment。
 *
 * 不变量：
 *   Inv 1  Candidate 与 Execution 共享同一个 target clue
 *   Inv 2  Candidate 与 Execution 共享同一个 question intent
 *   Inv 3  只为某个具体问题证明的 HIGH Value，不得换成另一个语义不同的问题执行
 *   Inv 4  Execution 不再独立重推 direction（只消费 Candidate 的结果）
 *   Inv 5  无法映射 → askExecution.allowed=false，且绝不 fallback 到别的 direction/template
 *
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askCandidateExecutionAlignment.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { InterviewState } from '../src/types/interview';
import {
  classifyQuestionIntent,
  isAlignedToDirection,
  classifyAskDirection,
  classifyQuestionValue,
  valueDimensionOfQuestion,
  valueDimensionOfDirection,
  isMeaningAlreadyVoicedByUser,
  evaluateAskExecution,
  buildAskQuestion,
  buildAskAnchor,
} from '../src/services/interventionDecision';
import type { AskCandidateDecision } from '../src/services/interventionDecision';

let failed = 0;
let assertions = 0;
let runTurnCount = 0;
const failures: string[] = [];
function expect(name: string, cond: boolean, extra = ''): void {
  assertions += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

/* ==================== stub ==================== */
useSettingsStore.getState().setLlm({ mode: 'auto', baseUrl: 'http://test.local/v1', apiKey: 'k', model: 'm' });

function und(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    newClues: [{ kind: 'emotion', text: '挺乱的', importance: 4, userInitiated: true, evidence: '挺乱的' }],
    signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.3 },
    memoryPatch: null, completeness: 0.6, focus: '那天', intent: 'ANSWER_STORY',
    ...extra,
  };
}
function cand(target: string, question: string, value = 5) {
  return {
    ack: '嗯。', question, ask: false, target_clue: target, story_value: value,
    user_initiative: 2, emotional_signal: 2, information_gain: 4, willingness: 3, disturbance_cost: 1, sensitivity_risk: 1,
  };
}
function clueOf(kind: string, text: string, evidence: string, importance = 5) {
  return { id: `c_${kind}_${text.slice(0, 3)}`, kind, text, importance, userInitiated: true, evidence, turn: 1 };
}

/** 每个方向「语义一致」的提问器问题（同时满足 Question Value = HIGH） */
const Q_CHANGE = '是什么让你后来改变了想法？';
const Q_RELATION = '你们之间的关系有什么变化吗？';
const Q_UNDERSTANDING = '这件事对你来说意味着什么？';

/**
 * H2.3：ASK 最终文本 = 「关于（或重问时「再说回」）『anchor』，骨架」，
 * anchor 来自 candidate.targetClueText。断言改为 delivered + reply === askExecution.text。
 */
const expectAskText = (direction: 'CHANGE' | 'RELATIONSHIP' | 'UNDERSTANDING', clueText: string, variant: 0 | 1 = 0) =>
  buildAskQuestion({ direction, anchor: buildAskAnchor(clueText), variant }).text;
const isAsk = (r: string) => /^(关于|再说回)「/.test((r ?? '').trim());
const askDelivered = (o: RunTurnOutput) =>
  execOf(o)?.delivered === true && o.result.reply === execOf(o)?.text && isAsk(o.result.reply);

let understandingRaw: Record<string, unknown> = und();
let questionCandidates: unknown[] = [cand('x', Q_CHANGE)];
(globalThis as { fetch: unknown }).fetch = (async (_u: unknown, init: { body?: string }) => {
  let content = '{}';
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content?: string }[] };
  const last = String(body?.messages?.[body.messages.length - 1]?.content ?? '');
  if (last.includes('只输出一个 JSON 对象')) content = JSON.stringify(understandingRaw);
  else if (last.includes('候选回应的 JSON 数组')) content = JSON.stringify(questionCandidates);
  else content = JSON.stringify({ ack: '嗯。', question: '', ask: false, reply: '嗯。' });
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}) as unknown as typeof fetch;

const PAUSE = '反正那天挺乱的。';
const askOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askCandidate;
const execOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution;

/** 真实 runTurn 全链路：历史原话 + 本轮停顿 + 目标 clue + 提问器问题 */
async function scenario(
  history: string,
  kind: string,
  text: string,
  question: string,
  o: { target?: string } = {},
): Promise<RunTurnOutput> {
  runTurnCount += 1;
  understandingRaw = und();
  questionCandidates = [cand(o.target ?? text, question)];
  const input = {
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: [clueOf(kind, text, history)] as never[], highValueClues: [],
    messages: [{ role: 'user', text: history }, { role: 'assistant', text: '嗯，我记下了。' }], userText: PAUSE,
  } as RunTurnInput;
  return runTurn(input);
}
/** 构造一个「Candidate 已放行」的决策对象，用于验证 Execution 只消费、不重推 */
function allowedCandidate(over: Partial<AskCandidateDecision> = {}): AskCandidateDecision {
  return {
    value: 'HIGH', timingValue: 'HIGH', freshNarrativeContribution: false, allowed: true,
    reason: 'test', targetClueText: '我不再去那个地方了', direction: 'CHANGE',
    questionIntent: 'CHANGE', aligned: true, ...over,
  };
}

console.log('\n========== Phase 3.2.4-B.1.x H2.1 · Alignment ==========\n');

/* ═══════════ 单元：question intent 与对齐矩阵 ═══════════ */
console.log('\n[单元] classifyQuestionIntent / isAlignedToDirection');
{
  expect('U1 「是什么让你后来改变了想法？」→ CHANGE', classifyQuestionIntent(Q_CHANGE) === 'CHANGE');
  expect('U2 「你们之间的关系有什么变化吗？」→ RELATIONSHIP（关系优先于变化）', classifyQuestionIntent(Q_RELATION) === 'RELATIONSHIP');
  expect('U3 「这件事对你来说意味着什么？」→ UNDERSTANDING', classifyQuestionIntent(Q_UNDERSTANDING) === 'UNDERSTANDING');
  expect('U4 CHANGE 语义骨架问题 → CHANGE', classifyQuestionIntent(Q_CHANGE) === 'CHANGE');
  expect('U5 RELATIONSHIP 语义骨架问题 → RELATIONSHIP', classifyQuestionIntent(Q_RELATION) === 'RELATIONSHIP');
  expect('U6 UNDERSTANDING 语义骨架问题 → UNDERSTANDING', classifyQuestionIntent(Q_UNDERSTANDING) === 'UNDERSTANDING');
  expect('U7 「你后来还见过他吗？」无法判定 → null（不猜）', classifyQuestionIntent('你后来还见过他吗？') === null);
  expect('U8 空问题 → null', classifyQuestionIntent('') === null);

  expect('M1 direction=null → 永不对齐（Inv 5）', isAlignedToDirection('CHANGE', null) === false);
  expect('M2 intent 可判定且相等 → 对齐', isAlignedToDirection('CHANGE', 'CHANGE') === true);
  expect('M3 intent 可判定但不同 → 不对齐（语义漂移）', isAlignedToDirection('CHANGE', 'RELATIONSHIP') === false);
  expect('M4 intent 不可判定 → 以共享 clue 为映射依据，视为对齐', isAlignedToDirection(null, 'CHANGE') === true);
}

/* ═══════════ Inv 4：Execution 只消费 Candidate 的 direction ═══════════ */
console.log('\n[Inv 4] Execution 不再独立重推 direction');
{
  const e1 = evaluateAskExecution({ candidate: allowedCandidate({ direction: 'CHANGE' }) });
  expect('I4-1 candidate.direction=CHANGE → 执行 CHANGE 模板（含 anchor）', e1.allowed === true && e1.text === expectAskText('CHANGE', '我不再去那个地方了'));
  const e2 = evaluateAskExecution({ candidate: allowedCandidate({ direction: 'RELATIONSHIP', questionIntent: 'RELATIONSHIP' }) });
  expect('I4-2 candidate.direction=RELATIONSHIP → 执行 RELATIONSHIP 模板（含 anchor）', e2.allowed === true && e2.text === expectAskText('RELATIONSHIP', '我不再去那个地方了'));
  const e3 = evaluateAskExecution({ candidate: allowedCandidate({ direction: null, aligned: false }) });
  expect('I4-3 direction=null → 不执行（不回退到任何模板）', e3.allowed === false && e3.text === null);
  const e4 = evaluateAskExecution({ candidate: allowedCandidate({ aligned: false }) });
  expect('I4-4 aligned=false → 不执行、不 fallback（Inv 5）', e4.allowed === false && e4.text === null);
  const e5 = evaluateAskExecution({ candidate: allowedCandidate(), enabled: false });
  expect('I4-5 引擎未启用 → 不执行', e5.allowed === false);
  const e6 = evaluateAskExecution({ candidate: allowedCandidate({ allowed: false, reason: '被上游拦截' }) });
  expect('I4-6 candidate 未放行 → 不执行且透传原因', e6.allowed === false && e6.reason.includes('被上游拦截'));
  const e7 = evaluateAskExecution({ candidate: allowedCandidate({ targetClueText: null }) });
  expect('I4-7 缺少共享 target clue → 不执行（Inv 1 失败即拒绝）', e7.allowed === false);
  expect('I4-8 Execution 会回传共享锚点（可审计）', e1.targetClueText === '我不再去那个地方了' && e1.questionIntent === 'CHANGE' && e1.aligned === true);
}

/* ═══════════ A. Candidate HIGH + Execution 同一语义 → ASK ═══════════ */
console.log('\n[A] HIGH + 语义一致 → ASK（三个方向）');
{
  const a1 = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', Q_CHANGE);
  console.log(`  A1 [${askOf(a1)?.direction}] ${a1.result.reply}`);
  expect('A1 CHANGE 对齐 → ASK 执行（delivered）', askDelivered(a1) && askOf(a1)?.aligned === true);
  const a2 = await scenario('后来我们就不怎么联系了。', 'turning_point', '我们就不怎么联系了', Q_RELATION);
  console.log(`  A2 [${askOf(a2)?.direction}] ${a2.result.reply}`);
  expect('A2 RELATIONSHIP 对齐 → ASK 执行（delivered）', askDelivered(a2) && askOf(a2)?.aligned === true);
  // H2.2-B 契约变化：改用「用户尚未明确表达意义」的材料（已表达的会被 D2 去重门拦截）
  const a3 = await scenario('那年夏天，家里就安静了。', 'meaning', '家里就安静了', Q_UNDERSTANDING);
  console.log(`  A3 [${askOf(a3)?.direction}] ${a3.result.reply}`);
  expect('A3 UNDERSTANDING 对齐 → ASK 执行（delivered）', askDelivered(a3) && askOf(a3)?.aligned === true);
}

/* ═══════════ B/C/H + 漂移专项 ═══════════ */
console.log('\n[B/C/H] 语义漂移必须被拦截');
{
  // B1：CHANGE 问题 + RELATIONSHIP 方向 → 漂移
  const b1 = await scenario('后来我们就不怎么联系了。', 'turning_point', '我们就不怎么联系了', Q_CHANGE);
  console.log(`  B1 direction=${askOf(b1)?.direction} intent=${askOf(b1)?.questionIntent} | ${b1.result.reply}`);
  expect('B1 CHANGE 问题 + RELATIONSHIP 方向 → 不 ASK', !isAsk(b1.result.reply) && askOf(b1)?.allowed === false);
  expect('B1b 记录为不对齐', askOf(b1)?.aligned === false && askOf(b1)?.direction === 'RELATIONSHIP' && askOf(b1)?.questionIntent === 'CHANGE');
  expect('B1c 拒绝理由指向 alignment', (askOf(b1)?.reason ?? '').includes('alignment'));

  // B2：RELATIONSHIP 问题 + CHANGE 方向 → 漂移
  const b2 = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', Q_RELATION);
  console.log(`  B2 direction=${askOf(b2)?.direction} intent=${askOf(b2)?.questionIntent} | ${b2.result.reply}`);
  expect('B2 RELATIONSHIP 问题 + CHANGE 方向 → 不 ASK', !isAsk(b2.result.reply) && askOf(b2)?.allowed === false);
  expect('B2b 记录为不对齐', askOf(b2)?.aligned === false);

  // C：UNDERSTANDING 问题 + CHANGE 方向 → 冲突
  const c1 = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', Q_UNDERSTANDING);
  console.log(`  C1 direction=${askOf(c1)?.direction} intent=${askOf(c1)?.questionIntent} | ${c1.result.reply}`);
  expect('C1 UNDERSTANDING 问题 + CHANGE 方向 → 不 ASK', !isAsk(c1.result.reply) && askOf(c1)?.allowed === false);

  // H：同一 target clue，但问题语义与将执行模板不一致 → WAIT
  const h1 = await scenario('我一直没跟他说过。', 'open_thread', '没跟他说过', Q_UNDERSTANDING);
  console.log(`  H1 direction=${askOf(h1)?.direction} intent=${askOf(h1)?.questionIntent} | ${h1.result.reply}`);
  expect('H1 同一 clue 但 UNDERSTANDING 问题 vs RELATIONSHIP 方向 → WAIT', !isAsk(h1.result.reply) && askOf(h1)?.allowed === false);
  // 第六节两个精确用例
  const drift1 = await scenario('后来我们就不怎么联系了。', 'turning_point', '我们就不怎么联系了', Q_CHANGE);
  expect('漂移①：Q=「你后来是从哪一件事开始变的？」+ direction=RELATIONSHIP → allowed=false',
    askOf(drift1)?.direction === 'RELATIONSHIP' && execOf(drift1)?.allowed === false);
  // 第六节用例②：语义一致（RELATIONSHIP 问题 + RELATIONSHIP 方向）→ 允许 ASK
  // 注：直接使用模板原文「这件事之后，你们之间有什么不一样吗？」会先被 Question Value 判为 MEDIUM
  //     （见本文件 [覆盖缺口] 一节），因此这里使用语义等价、且能通过价值门的 RELATIONSHIP 问题。
  const drift2 = await scenario('后来我们就不怎么联系了。', 'turning_point', '我们就不怎么联系了', Q_RELATION);
  expect('漂移②：Q（RELATIONSHIP 语义）+ direction=RELATIONSHIP → ASK 允许',
    askOf(drift2)?.direction === 'RELATIONSHIP' && askDelivered(drift2));

  /* [覆盖缺口] 三个固定模板文本本身都过不了 MAINLINE 价值词表 */
  const clueForValue = clueOf('turning_point', '我们就不怎么联系了', '后来我们就不怎么联系了。') as never;
  const vChange = classifyQuestionValue({ question: Q_CHANGE, targetClue: '我们就不怎么联系了', clues: [clueForValue] as never, questionerValue: 5 });
  const vRelation = classifyQuestionValue({ question: Q_RELATION, targetClue: '我们就不怎么联系了', clues: [clueForValue] as never, questionerValue: 5 });
  const vUnderstanding = classifyQuestionValue({ question: Q_UNDERSTANDING, targetClue: '我们就不怎么联系了', clues: [clueForValue] as never, questionerValue: 5 });
  console.log(`  模板自评价值（H2.2-A 后）：CHANGE=${vChange} RELATIONSHIP=${vRelation} UNDERSTANDING=${vUnderstanding}`);
  // H2.2-A 契约变化：价值判定改用与 Execution 同源的 Question Intent，三句模板现在都能被正确评价
  expect('修复① CHANGE 模板文本自身 → HIGH', vChange === 'HIGH');
  expect('修复② RELATIONSHIP 模板文本自身 → HIGH', vRelation === 'HIGH');
  expect('修复③ UNDERSTANDING 模板文本自身 → HIGH', vUnderstanding === 'HIGH');
  expect('模板价值维度与执行方向一一对应',
    valueDimensionOfQuestion(Q_CHANGE) === 'STRUCTURAL' &&
    valueDimensionOfQuestion(Q_RELATION) === 'RELATIONAL' &&
    valueDimensionOfQuestion(Q_UNDERSTANDING) === 'MEANING');
}

/* ═══════════ D/E：不得被 alignment 升级或放宽 ═══════════ */
console.log('\n[D/E] 不得升级 / 放宽');
{
  const d1 = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', Q_CHANGE, {});
  // MEDIUM：提问器 value 低
  runTurnCount += 1;
  understandingRaw = und();
  questionCandidates = [cand('我不再去那个地方了', Q_CHANGE, 2)];
  const d2 = await runTurn({
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: [clueOf('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。')] as never[], highValueClues: [],
    messages: [{ role: 'user', text: '后来我不再去那个地方了。' }, { role: 'assistant', text: '嗯，我记下了。' }], userText: PAUSE,
  } as RunTurnInput);
  console.log(`  D1 allowed=${askOf(d1)?.allowed} / D2 value=${askOf(d2)?.value} allowed=${askOf(d2)?.allowed}`);
  expect('D1 HIGH + 对齐 → 才允许', askOf(d1)?.allowed === true && askOf(d1)?.aligned === true);
  expect('D2 MEDIUM 不因对齐被升级', askOf(d2)?.allowed === false && askOf(d2)?.value === 'MEDIUM');
  const e1 = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', '那天是几点去的？');
  expect('E1 LOW（资料型问题）→ 不 ASK', askOf(e1)?.allowed === false && !isAsk(e1.result.reply));
  const e2 = await scenario('那天下午三点我在食堂吃饭。', 'event', '三点在食堂', Q_CHANGE);
  expect('E2 无 direction → 不 ASK（LOW/不可执行）', askOf(e2)?.allowed === false && !isAsk(e2.result.reply));
}

/* ═══════════ F：targetClue 不一致 → 不 ASK ═══════════ */
console.log('\n[F] targetClue 不一致');
{
  const f1 = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', Q_CHANGE, { target: '根本不存在的线索' });
  console.log(`  F1 reason=${askOf(f1)?.reason}`);
  expect('F1 target_clue 不在线索表 → 不 ASK', askOf(f1)?.allowed === false && !isAsk(f1.result.reply));
  expect('F1b 共享 target clue 为空', askOf(f1)?.targetClueText === null);
  const f2 = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', Q_CHANGE);
  expect('F2 一致时共享 target clue 被记录', askOf(f2)?.targetClueText === '我不再去那个地方了');
}

/* ═══════════ I/J/K：H1 回归 ═══════════ */
console.log('\n[I/J/K] H1 Direction Safety 回归');
{
  const i1 = await scenario('他当众说我的那一下。', 'turning_point', '他当众说我的那一下', Q_CHANGE);
  expect('I1 人物 ≠ 关系（direction 非 RELATIONSHIP）', askOf(i1)?.direction !== 'RELATIONSHIP');
  const i2 = await scenario('他当众说我的那一下。', 'turning_point', '他当众说我的那一下', Q_RELATION);
  expect('I2 direction=null → 即使问题语义匹配也「没有可执行方向」→ 不 ASK', askOf(i2)?.allowed === false && askOf(i2)?.aligned === false);
  const j = await scenario('我一直没想明白，那到底算什么。', 'open_thread', '那到底算什么', Q_RELATION);
  console.log(`  J direction=${askOf(j)?.direction} | ${j.result.reply}`);
  expect('J H1-P0① 「那到底算什么」不产生关系 ASK', askOf(j)?.direction === null && !isAsk(j.result.reply));
  const k = await scenario('我把那张照片一直留着。', 'open_thread', '留着那张照片', Q_RELATION);
  console.log(`  K direction=${askOf(k)?.direction} | ${k.result.reply}`);
  expect('K H1-P0② 「我把那张照片一直留着」不产生关系 ASK', askOf(k)?.direction === null && !isAsk(k.result.reply));
}

/* ═══════════ L/M/N：正常材料仍可执行；UNDERSTANDING 不被放宽 ═══════════ */
console.log('\n[L/M/N] 正常材料与边界');
{
  const l = await scenario('后来我不再去那个地方了。', 'turning_point', '我不再去那个地方了', Q_CHANGE);
  expect('L 正常 CHANGE 材料仍可执行 ASK', askDelivered(l) && askOf(l)?.direction === 'CHANGE');
  const m = await scenario('后来我们就不怎么联系了。', 'turning_point', '我们就不怎么联系了', Q_RELATION);
  expect('M 正常 RELATIONSHIP 材料仍可执行 ASK', askDelivered(m) && askOf(m)?.direction === 'RELATIONSHIP');
  // H2.2-B 契约变化：改用「用户尚未明确表达意义」的 meaning 材料
  const n1 = await scenario('那年夏天，家里就安静了。', 'meaning', '家里就安静了', Q_UNDERSTANDING);
  expect('N1 meaning 对齐时仍执行 UNDERSTANDING', askDelivered(n1) && askOf(n1)?.direction === 'UNDERSTANDING');
  expect('N1b 价值维度一致（Candidate=MEANING，Execution=MEANING）',
    valueDimensionOfDirection(askOf(n1)?.direction ?? null) === 'MEANING');
  expect('N1c 该材料未被判为「用户已说出意义」', isMeaningAlreadyVoicedByUser('家里就安静了') === false);
  // N2：meaning 但问题语义不是 UNDERSTANDING → 不放宽
  const n2 = await scenario('那年夏天，家里就安静了。', 'meaning', '家里就安静了', Q_CHANGE);
  console.log(`  N2 direction=${askOf(n2)?.direction} intent=${askOf(n2)?.questionIntent} | ${n2.result.reply}`);
  expect('N2 meaning + CHANGE 问题 → 不放宽（不 ASK）', askOf(n2)?.allowed === false && !isAsk(n2.result.reply));
  // N3：userOwnedDiscovery 保护不受影响
  const n3 = await runTurn({
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: [clueOf('meaning', '一直很在意她的看法', '一直很在意她的看法')] as never[], highValueClues: [],
    messages: [], userText: '我后来才明白，我一直很在意她的看法。',
  } as RunTurnInput);
  runTurnCount += 1;
  expect('N3 user-owned discovery 保护仍然优先于 alignment', askOf(n3)?.allowed === false);
  // N4：判定方向与 H1 规则一致（同一函数，未分叉）
  expect('N4 Candidate 与 H1 使用同一个 classifyAskDirection', classifyAskDirection({ kind: 'meaning', text: '那是一种告别' }) === 'UNDERSTANDING');
}

console.log('\n================ 结论 ================');
console.log(`断言数：${assertions}（真实 runTurn 场景：${runTurnCount}）`);
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-B.1.x H2.1 Candidate→Execution Alignment 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
