/**
 * Phase 3.2.4-B.1 · ASK Execution。
 *
 * 目标：把已通过 3.2.4-A.2 的 ASK_CANDIDATE 真正转换成一次用户可见的 ASK（不新增 LLM）。
 * 全部走真实 runTurn（受控 LLM stub）+ 决策层单元校验。
 *
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askExecution.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState, StoryMemory } from '../src/types/interview';
import {
  classifyAskDirection,
  buildAskQuestion,
  buildAskAnchor,
  selfCheckAskQuestion,
  evaluateAskExecution,
} from '../src/services/interventionDecision';

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

function und(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    newClues: [{ kind: 'emotion', text: '挺乱的', importance: 4, userInitiated: true, evidence: '挺乱的' }],
    signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.3 },
    memoryPatch: null, completeness: 0.6, focus: '那天', intent: 'ANSWER_STORY',
    ...extra,
  };
}
type Dir = 'CHANGE' | 'RELATIONSHIP' | 'UNDERSTANDING';

function q(target: string, value = 5, question = '是什么让你后来改变了想法？') {
  return {
    ack: '嗯。', question, ask: false, target_clue: target, story_value: value,
    user_initiative: 2, emotional_signal: 2, information_gain: 4, willingness: 3, disturbance_cost: 1, sensitivity_risk: 1,
  };
}

/**
 * 每个方向的「历史用户原话」（grounding 的锚点）。
 * ⚠️ H1 契约：CHANGE 必须有明确「变化」证据；RELATIONSHIP 必须有明确关系语义。
 */
const EARLIER: Record<Dir, string> = {
  CHANGE: '后来我不再去那个地方了。',
  // H2.3.1：RELATIONSHIP 夹具用「关系状态（非变化）」材料——未陈述关系变化，
  // 因此 ASK 应交付；已陈述变化的 RELATIONSHIP（如「我们后来就不怎么联系了」）由 askQuestionProgression 覆盖拦截。
  RELATIONSHIP: '我们之间一直很别扭。',
  // H2.2-B 契约变化：UNDERSTANDING 场景不能再用「用户已经自己说出意义」的材料
  // （那会被 D2 去重门正确拦截），因此改用「用户尚未明确表达意义」的 meaning 材料。
  UNDERSTANDING: '那年夏天，家里就安静了。',
};
/** 每个方向的 clue（text/evidence 都来自上面的原话，且方向互不污染）*/
const CLUE: Record<Dir, { id: string; kind: string; text: string; importance: number; userInitiated: boolean; evidence: string; turn: number }> = {
  CHANGE: { id: 'c_ch', kind: 'turning_point', text: '我不再去那个地方了', importance: 5, userInitiated: true, evidence: EARLIER.CHANGE, turn: 1 },
  RELATIONSHIP: { id: 'c_re', kind: 'turning_point', text: '我们之间一直很别扭', importance: 5, userInitiated: true, evidence: EARLIER.RELATIONSHIP, turn: 1 },
  UNDERSTANDING: { id: 'c_un', kind: 'meaning', text: '家里就安静了', importance: 5, userInitiated: true, evidence: EARLIER.UNDERSTANDING, turn: 1 },
};
/**
 * H2.1 契约变化：Candidate 会校验「提问器问题语义」与「将执行方向」是否一致，
 * 因此每个方向必须使用语义一致的提问器问题（旧夹具用同一句 CHANGE 问题造成了语义漂移）。
 */
const CAND: Record<Dir, ReturnType<typeof q>> = {
  CHANGE: q(CLUE.CHANGE.text, 5, '是什么让你后来改变了想法？'),
  RELATIONSHIP: q(CLUE.RELATIONSHIP.text, 5, '你们之间的关系有什么变化吗？'),
  UNDERSTANDING: q(CLUE.UNDERSTANDING.text, 5, '这件事对你来说意味着什么？'),
};
const CLUE_HALLUCINATED = { id: 'c_h', kind: 'turning_point', text: '他当众说我', importance: 5, userInitiated: true, evidence: '他当众说我', turn: 1 };

const PAUSE_USER = '反正那天挺乱的。';
/**
 * H2.3：最终 ASK = 「关于『anchor』，骨架」，anchor 来自 candidate.targetClueText。
 * 因此期望文本由 buildAskQuestion + buildAskAnchor 推出，而不是硬编码字面量。
 */
const askText = (direction: 'CHANGE' | 'RELATIONSHIP' | 'UNDERSTANDING', clueText: string, variant: 0 | 1 = 0) =>
  buildAskQuestion({ direction, anchor: buildAskAnchor(clueText), variant }).text ?? '';
const ASK_CHANGE = askText('CHANGE', CLUE.CHANGE.text);
const ASK_RELATION = askText('RELATIONSHIP', CLUE.RELATIONSHIP.text);
const ASK_UNDERSTANDING = askText('UNDERSTANDING', CLUE.UNDERSTANDING.text);
const ALL_ASK_TEXTS = [ASK_CHANGE, ASK_RELATION, ASK_UNDERSTANDING];
/** H2.3：ASK 的形状标记（anchor 无关，含重问前缀） */
const isAsk = (r: string) => /^(关于|再说回)「/.test((r ?? '').trim());
/** H2.3：本轮 ASK 是否真的被用户看到，且回复就是那次 ASK */
const askDelivered = (o: RunTurnOutput) =>
  execOf(o)?.delivered === true && o.result.reply === execOf(o)?.text && isAsk(o.result.reply);

let understandingRaw: Record<string, unknown> = und();
let questionCandidates: unknown[] = [CAND.CHANGE];
(globalThis as { fetch: unknown }).fetch = (async (_u: unknown, init: { body?: string }) => {
  let content = '{}';
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content?: string }[] };
  const last = String(body?.messages?.[body.messages.length - 1]?.content ?? '');
  if (last.includes('只输出一个 JSON 对象')) content = JSON.stringify(understandingRaw);
  else if (last.includes('候选回应的 JSON 数组')) content = JSON.stringify(questionCandidates);
  else content = JSON.stringify({ ack: '嗯。', question: '', ask: false, reply: '嗯。' });
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}) as unknown as typeof fetch;

function mem(): StoryMemory {
  return { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] };
}
interface Opts {
  U?: Record<string, unknown>;
  Q?: unknown[];
  M?: StoryMemory;
  clues?: unknown[];
  messages?: { role: 'user' | 'assistant'; text: string }[];
  focus?: ConversationFocus;
}
async function turn(userText: string, o: Opts = {}): Promise<RunTurnOutput> {
  understandingRaw = o.U ?? und();
  questionCandidates = o.Q ?? [CAND.CHANGE];
  const input = {
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: o.M ?? mem(), clues: (o.clues ?? []) as never[], highValueClues: [],
    messages: o.messages ?? [], userText, focus: o.focus,
  } as RunTurnInput;
  return runTurn(input);
}
/** 标准可执行场景：停顿 + 该方向的历史原话 + 对应 clue/candidate */
function pauseTurn(dir: Dir, o: Opts = {}): Promise<RunTurnOutput> {
  return turn(PAUSE_USER, {
    clues: [CLUE[dir]],
    Q: [CAND[dir]],
    messages: [{ role: 'user', text: EARLIER[dir] }, { role: 'assistant', text: '嗯，我记下了。' }],
    ...o,
  });
}
const execOf = (out: RunTurnOutput) => out.result.observer.decisionTrace?.askExecution;
const askOfT = (out: RunTurnOutput) => out.result.observer.decisionTrace?.askCandidate;
const askOf = (out: RunTurnOutput) => out.result.observer.decisionTrace?.askCandidate;


console.log('\n================ Phase 3.2.4-B.1 · ASK Execution ================\n');

/* ==================== A–C 正常三方向 ==================== */
console.log('\n[A–C] 三个方向的正常 ASK');
{
  const out = await pauseTurn('CHANGE');
  console.log(`  A 用户：${PAUSE_USER}（此前：${EARLIER.CHANGE}）\n  A AI：${out.result.reply}`);
  expect('A CHANGE ASK 已真实发出（delivered）', askDelivered(out));
  expect('A trace: allowed + direction=CHANGE', execOf(out)?.allowed === true && execOf(out)?.direction === 'CHANGE');
  expect('A observer 记录「ASK 已发出」', out.result.observer.ruleHits.some((h) => h.includes('ASK 已发出')));
}
{
  const out = await pauseTurn('RELATIONSHIP');
  console.log(`  B AI：${out.result.reply}`);
  expect('B RELATIONSHIP ASK 已真实发出（delivered）', askDelivered(out) && askOfT(out)?.direction === 'RELATIONSHIP');
  expect('B trace: direction=RELATIONSHIP', execOf(out)?.direction === 'RELATIONSHIP');
}
{
  const out = await pauseTurn('UNDERSTANDING');
  console.log(`  C AI：${out.result.reply}`);
  expect('C UNDERSTANDING ASK 已真实发出（delivered）', askDelivered(out) && askOfT(out)?.direction === 'UNDERSTANDING');
  expect('C trace: direction=UNDERSTANDING', execOf(out)?.direction === 'UNDERSTANDING');
}

/* ==================== D–K 不得执行 ==================== */
console.log('\n[D–K] 不得执行 ASK');
{
  const out = await turn(PAUSE_USER, {
    clues: [CLUE.CHANGE],
    messages: [{ role: 'user', text: EARLIER.CHANGE }, { role: 'assistant', text: '嗯，我记下了。' }],
    Q: [q(CLUE.CHANGE.text, 5, '你后来还见过吗？')],
  });
  console.log(`  D AI：${out.result.reply}`);
  expect('D 非 allowed candidate（MEDIUM）→ 不执行', !isAsk(out.result.reply) && execOf(out)?.allowed === false);
  expect('D askCandidate 也未 allowed', askOf(out)?.allowed === false);
}
{
  const out = await turn(PAUSE_USER, {
    clues: [CLUE_HALLUCINATED],
    Q: [q(CLUE_HALLUCINATED.text, 5)],
    messages: [{ role: 'user', text: EARLIER.CHANGE }, { role: 'assistant', text: '嗯，我记下了。' }],
  });
  console.log(`  E AI：${out.result.reply}`);
  expect('E 幻觉 clue（无原话证据）→ 不执行', !isAsk(out.result.reply) && execOf(out)?.allowed === false);
}
{
  const out = await turn('我们就一起回去了。', {
    clues: [CLUE.CHANGE], Q: [CAND.CHANGE],
    messages: [{ role: 'user', text: EARLIER.CHANGE }, { role: 'assistant', text: '嗯，我记下了。' }],
    U: und({ newClues: [{ kind: 'event', text: '一起回去', importance: 4, userInitiated: true, evidence: '一起回去' }] }),
  });
  console.log(`  F AI：${out.result.reply}`);
  expect('F fresh narrative → 不执行', !isAsk(out.result.reply) && askOf(out)?.freshNarrativeContribution === true);
}
{
  const out2 = await turn(`${PAUSE_USER.slice(0, -1)}，而且那时候我还……`, {
    clues: [CLUE.CHANGE], Q: [CAND.CHANGE],
    messages: [{ role: 'user', text: EARLIER.CHANGE }, { role: 'assistant', text: '嗯，我记下了。' }],
  });
  console.log(`  G AI：${out2.result.reply}`);
  expect('G active expression → 不执行', !isAsk(out2.result.reply) && execOf(out2)?.allowed === false);
}
{
  const t1 = await turn('那天我特别开心，但是一路上都装得很淡定。', { Q: [q('x', 2, '可以再讲讲吗？')] });
  const out = await pauseTurn('CHANGE', {
    focus: t1.focus,
    messages: [{ role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' }, { role: 'assistant', text: t1.result.reply }],
  });
  console.log(`  H AI：${out.result.reply}`);
  expect('H recent REFLECT → 不执行 ASK', !isAsk(out.result.reply) && execOf(out)?.allowed === false);
}
{
  const t1 = await turn('那天我特别开心，但是一路上都装得很淡定。', { Q: [q('x', 2, '可以再讲讲吗？')] });
  const t2 = await turn('对。', {
    focus: t1.focus,
    messages: [{ role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' }, { role: 'assistant', text: t1.result.reply }],
    Q: [q('x', 2, '可以再讲讲吗？')],
  });
  const out = await pauseTurn('CHANGE', {
    focus: t2.focus,
    messages: [
      { role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' },
      { role: 'assistant', text: t1.result.reply },
      { role: 'user', text: '对。' }, { role: 'assistant', text: t2.result.reply },
    ],
  });
  console.log(`  I AI：${out.result.reply}`);
  expect('I recent GENTLE_PUSH → 不执行 ASK', !isAsk(out.result.reply) && execOf(out)?.allowed === false);
}
{
  const out = await pauseTurn('CHANGE', {
    U: und({ signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.9 } }),
  });
  console.log(`  J AI：${out.result.reply}`);
  expect('J 高情绪 → 不执行 ASK', !isAsk(out.result.reply) && execOf(out)?.allowed === false);
}
{
  const out = await turn('我突然发现我其实一直在躲着他。', {
    clues: [CLUE.CHANGE], Q: [CAND.CHANGE],
    messages: [{ role: 'user', text: EARLIER.CHANGE }, { role: 'assistant', text: '嗯，我记下了。' }],
  });
  console.log(`  K AI：${out.result.reply}`);
  expect('K user-owned discovery → 不执行 ASK', !isAsk(out.result.reply) && execOf(out)?.allowed === false);
}

/* ==================== L–M self-check ==================== */
console.log('\n[L–M] self-check 拦截');
{
  const bad1 = selfCheckAskQuestion('是不是因为你其实很在意别人的看法？');
  console.log(`  L ${bad1.reason}`);
  expect('L AI 心理推断式问题被 self-check 拦截', bad1.ok === false);
  const bad2 = selfCheckAskQuestion('这件事之后你变了，是哪一件事？她当时怎么说？');
  console.log(`  M ${bad2.reason}`);
  expect('M 多问题 / 连续追问被拦截', bad2.ok === false);
  expect('M2 长度过短的追问被拦截', selfCheckAskQuestion('后来发生了什么？').ok === false);
  // H2.1 契约变化：Execution 只消费 Candidate 结果，不再自己接收 clue 重推方向
  const okCand = {
    value: 'HIGH' as const,
    timingValue: 'HIGH' as const,
    freshNarrativeContribution: false,
    allowed: true,
    reason: 'test',
    targetClueText: '我不再去了',
    direction: 'CHANGE' as const,
    questionIntent: 'CHANGE' as const,
    aligned: true,
  };
  expect('L2 合法方向仍可执行（对照）', evaluateAskExecution({ candidate: okCand }).allowed === true);
  expect('L3 candidate 未 allowed 时一律不执行', evaluateAskExecution({ candidate: { ...okCand, allowed: false } }).allowed === false);
  expect('L4 candidate 未对齐时不执行、不 fallback', evaluateAskExecution({ candidate: { ...okCand, aligned: false } }).allowed === false);
}

/* ==================== N 不新增 reception 状态 ==================== */
console.log('\n[N] ASK 之后不新增 reception 状态');
{
  const t1 = await pauseTurn('CHANGE');
  console.log(`  N t1 reply=${t1.result.reply}`);
  expect('N1 ASK 发出后 lastIntervention 记为 ASK_CANDIDATE', t1.focus.lastIntervention?.candidate === 'ASK_CANDIDATE');
  expect('N2 未新增 askReception 字段（沿用现有系统）', !Object.prototype.hasOwnProperty.call(t1.focus, 'askReception'));
  expect('N3 reflectionReception 仍为 NONE（无上一轮 REFLECT）', t1.focus.reflectionReception === 'NONE');
  const t2 = await turn('嗯。', {
    focus: t1.focus,
    clues: [CLUE.CHANGE], Q: [CAND.CHANGE],
    messages: [{ role: 'user', text: PAUSE_USER }, { role: 'assistant', text: t1.result.reply }],
  });
  console.log(`  N t2 reply=${t2.result.reply}`);
  expect('N4 下一轮不再连续追问（ASK 保护期生效）', execOf(t2)?.allowed === false && !isAsk(t2.result.reply));
}

/* ==================== O 既有 REFLECT / GENTLE_PUSH 回归 ==================== */
console.log('\n[O] REFLECT / GENTLE_PUSH 行为未被改变');
{
  const out = await turn('那天我特别开心，但是一路上都装得很淡定。', { Q: [CAND.CHANGE] });
  console.log(`  O AI：${out.result.reply}`);
  expect('O1 REFLECT 场景仍走 REFLECT（不是 ASK）', out.result.reply.includes('放在一起') && !isAsk(out.result.reply));
  expect('O2 REFLECT 场景 askExecution 未执行', execOf(out)?.allowed === false);
}
{
  const t1 = await turn('那天我特别开心，但是一路上都装得很淡定。', { Q: [q('x', 2, '可以再讲讲吗？')] });
  const t2 = await turn('对。', {
    focus: t1.focus,
    messages: [{ role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' }, { role: 'assistant', text: t1.result.reply }],
    Q: [q('x', 2, '可以再讲讲吗？')],
  });
  console.log(`  O AI：${t2.result.reply}`);
  expect('O3 GENTLE PUSH 场景仍走 GENTLE PUSH（不是 ASK）', t2.result.reply.includes('刚才那个地方') && !isAsk(t2.result.reply));
}

/* ==================== P 形态约束 ==================== */
console.log('\n[P] 形态约束');
{
  const out = await pauseTurn('CHANGE');
  const reply = out.result.reply;
  expect('P1 恰好一个问题', (reply.match(/[？?]/g) ?? []).length === 1);
  expect('P2 不加「我注意到」/身份说明', !reply.includes('我注意到') && !reply.includes('作为 AI'));
  expect('P3 不含诊断 / 人格 / AI 因果', !/(是不是因为|你其实|你本质上|说明你|为什么|讨好型|你有点)/.test(reply));
  const len = reply.replace(/[，。？！、,.!?]/g, '').length;
  expect(`P4 长度在 10–34（实际 ${len}）`, len >= 10 && len <= 34);
  expect('P5 三个方向模板互不相同', new Set(ALL_ASK_TEXTS).size === 3);
}
{
  // H1：open_thread 仅在材料存在关系语义时才判 RELATIONSHIP；否则 null
  expect(
    'P6 open_thread + 关系语义 → RELATIONSHIP',
    classifyAskDirection({ kind: 'open_thread', text: '没跟他说过', evidence: '我一直没跟他说过。' }) === 'RELATIONSHIP',
  );
  expect('P6b open_thread 无关系语义 → null', classifyAskDirection({ kind: 'open_thread', text: '留着那张照片' }) === null);
  expect('P7 meaning → UNDERSTANDING', classifyAskDirection({ kind: 'meaning', text: '那是一种告别' }) === 'UNDERSTANDING');
  expect('P8 无 clue → 不生成问题', buildAskQuestion({ direction: null }).text === null);
  expect('P9 非主线 kind（event）→ 无方向', classifyAskDirection({ kind: 'event', text: '那天下午在食堂' }) === null);
  expect('P10 turning_point 无变化证据 → null', classifyAskDirection({ kind: 'turning_point', text: '他当众说我' }) === null);
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-B.1 ASK Execution 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
