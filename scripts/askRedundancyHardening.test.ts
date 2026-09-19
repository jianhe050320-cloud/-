/**
 * Phase 3.2.4-B.1.x H2.2 · Redundancy Hardening。
 *
 * H2.2-A 统一 Execution Template 与 Question Value（Question Intent → Value Dimension → Execution Question）
 * H2.2-B D2：用户已经自己说出的意义，不再被要求重新解释
 * H2.2-C D3：同方向重复 ASK 只在「没有新增材料」时阻止（不机械禁止）
 *
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askRedundancyHardening.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState } from '../src/types/interview';
import {
  classifyQuestionValue,
  classifyQuestionIntent,
  valueDimensionOfQuestion,
  valueDimensionOfDirection,
  isMeaningAlreadyVoicedByUser,
  classifyRepeatAsk,
  countNewMaterialClues,
  classifyReflectionReception,
} from '../src/services/interventionDecision';

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
    newClues: [],
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

/**
 * 提问器问题使用「系统真正会问的骨架」——用于证明 Value 与 Execution 已同源。
 * ⚠️ H2.3 起，最终 ASK 文本 = 关于「anchor」+ 骨架（anchor 来自 targetClueText），
 *    因此对「最终回复」的断言改为 delivered + reply === askExecution.text（见 askIs）。
 */
const Q_CHANGE = '你后来是从哪一件事开始变的？';
const Q_RELATION = '你们之间后来有什么不一样吗？';
const Q_UNDERSTANDING = '你后来发现的是什么？';

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
/** H2.3 起，ASK 的形状是「关于「…」，…」/ 重问为「再说回「…」，…」——形状标记（anchor 无关） */
const isAsk = (r: string) => /^(关于|再说回)「/.test((r ?? '').trim());
const askOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askCandidate;
const execOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution;
/** H2.3：本轮 ASK 是否真的被用户看到，且回复就是那次 ASK */
const askDelivered = (o: RunTurnOutput) =>
  execOf(o)?.delivered === true && o.result.reply === execOf(o)?.text && isAsk(o.result.reply);

interface TurnOpts {
  U?: Record<string, unknown>;
  Q?: unknown[];
  clues?: unknown[];
  messages?: { role: 'user' | 'assistant'; text: string }[];
  focus?: ConversationFocus;
}
async function turn(userText: string, o: TurnOpts = {}): Promise<RunTurnOutput> {
  runTurnCount += 1;
  understandingRaw = o.U ?? und();
  questionCandidates = o.Q ?? [cand('x', Q_CHANGE)];
  const input = {
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: (o.clues ?? []) as never[], highValueClues: [],
    messages: o.messages ?? [], userText, focus: o.focus,
  } as RunTurnInput;
  return runTurn(input);
}
const HIST = (text: string) => [{ role: 'user' as const, text }, { role: 'assistant' as const, text: '嗯，我记下了。' }];

/* ---- 三个方向的标准材料 ---- */
const CH = clueOf('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。');
const REL = clueOf('turning_point', '我们就不怎么联系了', '后来我们就不怎么联系了。');
const MEAN = clueOf('meaning', '家里就安静了', '那年夏天，家里就安静了。');
const CH_HIST = '后来我不再去那个地方了。';
const REL_HIST = '后来我们就不怎么联系了。';
const MEAN_HIST = '那年夏天，家里就安静了。';

/**
 * 第一轮：发出一轮真实 ASK，返回跨轮 focus。
 * 本轮必须是「自然停顿」的发言（否则会被 fresh-narrative 门正确拦下）。
 */
function askTurn(clue: { text: string }, question: string, hist: string) {
  return turn(PAUSE, { clues: [clue], Q: [cand(clue.text, question)], messages: HIST(hist) });
}

console.log('\n========== Phase 3.2.4-B.1.x H2.2 · Redundancy ==========\n');

/* ═══════════ N/O/P · Template ↔ Value 一致性（H2.2-A） ═══════════ */
console.log('\n[N/O/P] Template ↔ Value ↔ Dimension');
{
  const tpls: [string, string, string][] = [
    [Q_CHANGE, 'CHANGE', 'STRUCTURAL'],
    [Q_RELATION, 'RELATIONSHIP', 'RELATIONAL'],
    [Q_UNDERSTANDING, 'UNDERSTANDING', 'MEANING'],
  ];
  for (const [tpl, intent, dim] of tpls) {
    expect(`N 模板「${tpl}」→ intent=${intent}`, classifyQuestionIntent(tpl) === intent);
    expect(`N 模板「${tpl}」→ valueDimension=${dim}`, valueDimensionOfQuestion(tpl) === dim);
    expect(
      `N 模板「${tpl}」在主线目标上判 HIGH`,
      classifyQuestionValue({ question: tpl, targetClue: CH.text, clues: [CH] as never, questionerValue: 5 }) === 'HIGH',
    );
  }
  // O：不允许「命中关键词即 HIGH」——仍需 strongTarget 与 story_value 两道门槛
  expect('O1 关键词命中但目标重要度不足（imp=2）→ 非 HIGH',
    classifyQuestionValue({ question: Q_CHANGE, targetClue: '弱线索', clues: [clueOf('turning_point', '弱线索', '弱线索', 2)] as never, questionerValue: 5 }) !== 'HIGH');
  expect('O2 关键词命中但提问器价值低（2）→ 非 HIGH',
    classifyQuestionValue({ question: Q_CHANGE, targetClue: CH.text, clues: [CH] as never, questionerValue: 2 }) !== 'HIGH');
  expect('O3 事实型问题仍判 LOW',
    classifyQuestionValue({ question: '那天是几点去的？', targetClue: CH.text, clues: [CH] as never, questionerValue: 5 }) === 'LOW');
  expect('O4 无价值维度的问题（无法映射）→ 非 HIGH',
    classifyQuestionValue({ question: '你后来还见过吗？', targetClue: CH.text, clues: [CH] as never, questionerValue: 5 }) !== 'HIGH');
  expect('O5 方向 → 价值维度映射完备',
    valueDimensionOfDirection('CHANGE') === 'STRUCTURAL' &&
    valueDimensionOfDirection('RELATIONSHIP') === 'RELATIONAL' &&
    valueDimensionOfDirection('UNDERSTANDING') === 'MEANING');

  // P：真实链路中 Candidate 的 HIGH 与 Execution 的价值维度一致
  const p1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  expect('P1 真实 ASK：Candidate=HIGH 且价值维度一致',
    askOf(p1)?.value === 'HIGH' &&
    valueDimensionOfDirection(askOf(p1)?.direction ?? null) === 'STRUCTURAL' &&
    valueDimensionOfQuestion(Q_CHANGE) === 'STRUCTURAL');
  expect('P1b 真实 ASK 已发出（delivered）', askDelivered(p1));
}

/* ═══════════ D2 · A–E：已表达的意义不再索取 ═══════════ */
console.log('\n[D2-A] 用户已经自己说出意义 → NO ASK');
{
  const out = await turn(PAUSE, {
    clues: [clueOf('meaning', '那是一种告别', '我说过，那对我来说是一种告别。')],
    Q: [cand('那是一种告别', Q_UNDERSTANDING)],
    messages: HIST('我说过，那对我来说是一种告别。'),
  });
  console.log(`  A direction=${askOf(out)?.direction} allowed=${askOf(out)?.allowed} | ${out.result.reply}`);
  expect('A2-1 方向仍是 UNDERSTANDING（说明拦在语义门，不是方向门）', askOf(out)?.direction === 'UNDERSTANDING');
  expect('A2-2 用户已说出的意义 → 不 ASK', askOf(out)?.allowed === false && !isAsk(out.result.reply));
  expect('A2-3 拒绝理由指向「已经自己说出」', (askOf(out)?.reason ?? '').includes('已经自己说出'));
  expect('A2-4 单元：该材料被判为已表达', isMeaningAlreadyVoicedByUser('那是一种告别 我说过，那对我来说是一种告别。') === true);
}
console.log('\n[D2-B] 只是 AI 推断 → 不误判为已回答');
{
  expect('B2-1 单元：无用户语气标志的 meaning 文本 → 不判为已回答', isMeaningAlreadyVoicedByUser('一句很重的话') === false);
  const out = await turn(PAUSE, {
    clues: [clueOf('meaning', '一句很重的话', '一句很重的话')],
    Q: [cand('一句很重的话', Q_UNDERSTANDING)],
    messages: HIST('她说那句话的时候我什么都没说。'),
  });
  console.log(`  B reason=${askOf(out)?.reason}`);
  expect('B2-2 AI 推断、原话无佐证 → 不 ASK', askOf(out)?.allowed === false);
  expect('B2-3 但不是因为「已回答」（而是 grounding 失败）', (askOf(out)?.reason ?? '').includes('无法回溯') && !(askOf(out)?.reason ?? '').includes('已经自己说出'));
}
console.log('\n[D2-C] 用户明确纠正 → NO ASK');
{
  const out = await turn('不是这样的，我不是这个意思。', {
    clues: [MEAN],
    Q: [cand(MEAN.text, Q_UNDERSTANDING)],
    messages: [{ role: 'user', text: MEAN_HIST }, { role: 'assistant', text: '你后来说的那是一种告别，对吗？' }],
  });
  console.log(`  C reason=${askOf(out)?.reason}`);
  expect('C2-1 纠正场景 → 不 ASK', askOf(out)?.allowed === false && !isAsk(out.result.reply));
  expect('C2-2 走既有 Correction Recovery', (askOf(out)?.reason ?? '').includes('纠正'));
}
console.log('\n[D2-D] meaning 新出现（用户尚未明确表达）→ 可正常评估');
{
  const out = await askTurn(MEAN, Q_UNDERSTANDING, MEAN_HIST);
  console.log(`  D allowed=${askOf(out)?.allowed} | ${out.result.reply}`);
  expect('D2-1 未被误封 → 允许 ASK', askOf(out)?.allowed === true);
  expect('D2-2 真实发出 UNDERSTANDING ASK（delivered）', askDelivered(out) && askOf(out)?.direction === 'UNDERSTANDING');
  expect('D2-3 单元：该材料不算已回答', isMeaningAlreadyVoicedByUser('家里就安静了') === false);
}
console.log('\n[D2-E] SELF_REALIZATION 仍保持 userOwned 保护');
{
  const out = await turn('我突然发现我其实一直在躲着他。', {
    clues: [clueOf('meaning', '我其实一直在躲着他', '我其实一直在躲着他')],
    Q: [cand('我其实一直在躲着他', Q_UNDERSTANDING)],
  });
  console.log(`  E reason=${askOf(out)?.reason}`);
  expect('E2-1 user-owned discovery → 不 ASK', askOf(out)?.allowed === false && !isAsk(out.result.reply));
  expect('E2-2 理由仍是 userOwned 保护（未被 H2.2 改动）', (askOf(out)?.reason ?? '').includes('自己已经发现'));
}

/* ═══════════ D3 · F–M：同方向重复去重 ═══════════ */
console.log('\n[D3-F] 上轮 CHANGE + 无新材料 → NO ASK');
{
  const t1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  const t2 = await turn('嗯。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], focus: t1.focus,
    messages: [{ role: 'user', text: CH_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [] }),
  });
  console.log(`  F t1=${t1.result.reply} / t2=${t2.result.reply}`);
  expect('F2-1 上一轮确实问过 CHANGE', askDelivered(t1));
  expect('F2-2 同方向 + 同线索 + 无新材料 → 不重复 ASK', askOf(t2)?.allowed === false && !isAsk(t2.result.reply));
  expect('F2-3 拒绝理由指向 H2.2 去重', (askOf(t2)?.reason ?? '').includes('去重'));
  expect('F2-4 单元：机械重复被判为 repeat', classifyRepeatAsk({
    priorCandidate: 'ASK_CANDIDATE', priorDirection: 'CHANGE', priorTargetClueText: CH.text,
    direction: 'CHANGE', targetClueText: CH.text, reception: 'NOT_PICKED_UP', newMaterialClueCount: 0,
  }).repeat === true);
}
console.log('\n[D3-G] 上轮 CHANGE + 新材料 → 可重新评估');
{
  const t1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  const t2 = await turn('这个我一直没想明白。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], focus: t1.focus,
    messages: [{ role: 'user', text: CH_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [{ kind: 'open_thread', text: '没想明白', importance: 5, userInitiated: true, evidence: '没想明白' }] }),
  });
  console.log(`  G t2=${t2.result.reply} allowed=${askOf(t2)?.allowed}`);
  expect('G2-1 出现新局面（新材料）→ 不机械阻止', askOf(t2)?.allowed === true && !(askOf(t2)?.reason ?? '').includes('去重'));
  expect('G2-2 决策层可再次放行 ASK（表现层是否逐字重复由 avoidRepeat 兜底）', execOf(t2)?.allowed === true);
  expect('G2-3 单元：有新材料 → 不算重复', classifyRepeatAsk({
    priorCandidate: 'ASK_CANDIDATE', priorDirection: 'CHANGE', priorTargetClueText: CH.text,
    direction: 'CHANGE', targetClueText: CH.text, reception: 'NOT_PICKED_UP', newMaterialClueCount: 1,
  }).repeat === false);
  expect('G2-4 countNewMaterialClues 只认实质线索类型', countNewMaterialClues([{ kind: 'emotion', importance: 5 }]) === 0 && countNewMaterialClues([{ kind: 'event', importance: 4 }]) === 1);
}
console.log('\n[D3-H] 上轮 RELATIONSHIP + 新关系材料 → 可重新评估');
{
  const t1 = await askTurn(REL, Q_RELATION, REL_HIST);
  const t2 = await turn('我们彻底不联系了。', {
    clues: [REL], Q: [cand(REL.text, Q_RELATION)], focus: t1.focus,
    messages: [{ role: 'user', text: REL_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [{ kind: 'open_thread', text: '彻底不联系了', importance: 5, userInitiated: true, evidence: '我们彻底不联系了' }] }),
  });
  console.log(`  H t1=${t1.result.reply} / t2=${t2.result.reply}`);
  expect('H2-1 上轮确实问过 RELATIONSHIP', askDelivered(t1));
  expect('H2-2 新关系材料 → 允许重新评估（决策层）', askOf(t2)?.allowed === true && !(askOf(t2)?.reason ?? '').includes('去重'));
  expect('H2-3 askExecution 也放行', execOf(t2)?.allowed === true);
  // H2.3 修复验证：同方向 + 同 target 的重问改为「换措辞」，真的被用户看到，且与上一轮不逐字相同
  expect('H2-4 有新材料的重问真的被看到（H2.3 修复）', askDelivered(t2));
  expect('H2-5 重问文本与上一轮不相同（H2.2-c）', t2.result.reply !== t1.result.reply);
  expect('H2-3 方向仍为 RELATIONSHIP', askOf(t2)?.direction === 'RELATIONSHIP');
}
console.log('\n[D3-I] 上轮 UNDERSTANDING + 已明确表达 → NO ASK');
{
  const t1 = await askTurn(MEAN, Q_UNDERSTANDING, MEAN_HIST);
  const voiced = '那对我来说就是一种告别';
  const t2 = await turn('那对我来说就是一种告别。', {
    clues: [MEAN], Q: [cand(voiced, Q_UNDERSTANDING)], focus: t1.focus,
    messages: [{ role: 'user', text: MEAN_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [{ kind: 'meaning', text: voiced, importance: 5, userInitiated: true, evidence: voiced }] }),
  });
  console.log(`  I t1=${t1.result.reply} / t2=${t2.result.reply}`);
  expect('I2-1 上轮确实问过 UNDERSTANDING', askDelivered(t1));
  expect('I2-2 用户已明确表达该意义 → 不重复 ASK', askOf(t2)?.allowed === false && !isAsk(t2.result.reply));
  expect('I2-3 拒绝理由指向「已经自己说出」', (askOf(t2)?.reason ?? '').includes('已经自己说出'));
}
console.log('\n[D3-J] 上轮 ASK 后用户主动展开 → 不机械阻止');
{
  const t1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  const t2 = await turn('对，因为那时候我其实特别怕别人看出来。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], focus: t1.focus,
    messages: [{ role: 'user', text: CH_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [] }),
  });
  console.log(`  J t2=${t2.result.reply} allowed=${askOf(t2)?.allowed}`);
  expect('J2-0 该回应被判为 PICKED_UP（说明 ASK 也有了 reception 判定）',
    classifyReflectionReception(t1.focus.lastIntervention, '对，因为那时候我其实特别怕别人看出来。') === 'PICKED_UP');
  expect('J2-1 用户主动展开（PICKED_UP）→ 不按机械重复处理', askOf(t2)?.allowed === true && !(askOf(t2)?.reason ?? '').includes('去重'));
  expect('J2-2 单元：reception=PICKED_UP → 不算重复', classifyRepeatAsk({
    priorCandidate: 'ASK_CANDIDATE', priorDirection: 'CHANGE', priorTargetClueText: CH.text,
    direction: 'CHANGE', targetClueText: CH.text, reception: 'PICKED_UP', newMaterialClueCount: 0,
  }).repeat === false);
}
console.log('\n[D3-K] 上轮 ASK 后用户只是「嗯」→ 不重复 ASK');
{
  const t1 = await askTurn(REL, Q_RELATION, REL_HIST);
  const t2 = await turn('嗯。', {
    clues: [REL], Q: [cand(REL.text, Q_RELATION)], focus: t1.focus,
    messages: [{ role: 'user', text: REL_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [] }),
  });
  console.log(`  K t2=${t2.result.reply}`);
  expect('K2-1 最小回应 → 不重复 ASK', askOf(t2)?.allowed === false && !isAsk(t2.result.reply));
  expect('K2-2 单元：PICKED_UP_NOT_EXPANDED 不视为新材料', classifyRepeatAsk({
    priorCandidate: 'ASK_CANDIDATE', priorDirection: 'RELATIONSHIP', priorTargetClueText: REL.text,
    direction: 'RELATIONSHIP', targetClueText: REL.text, reception: 'PICKED_UP_NOT_EXPANDED', newMaterialClueCount: 0,
  }).repeat === true);
}
console.log('\n[D3-L] lastIntervention 正确记录 ASK 的方向 / 线索 / intent');
{
  const t1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  const li = t1.focus.lastIntervention;
  console.log(`  L lastIntervention=${JSON.stringify(li)}`);
  expect('L2-1 candidate=ASK_CANDIDATE', li?.candidate === 'ASK_CANDIDATE');
  expect('L2-2 direction=CHANGE', li?.direction === 'CHANGE');
  expect('L2-3 targetClueText 被记录', li?.targetClueText === CH.text);
  expect('L2-4 questionIntent 被记录', li?.questionIntent === 'CHANGE');
  const t2 = await turn('嗯。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], focus: t1.focus,
    messages: [{ role: 'user', text: CH_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [] }),
  });
  expect('L2-5 跨轮使用该记录触发去重', (askOf(t2)?.reason ?? '').includes('去重'));
}
console.log('\n[D3-M] targetClue 不同 → 不因同方向直接阻止');
{
  const t1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  const CH2 = clueOf('turning_point', '我不再住在那里了', '那年夏天我就不再住在那里了。');
  const t2 = await turn(PAUSE, {
    clues: [CH2], Q: [cand(CH2.text, Q_CHANGE)], focus: t1.focus,
    messages: [
      { role: 'user', text: CH_HIST }, { role: 'assistant', text: t1.result.reply },
      { role: 'user', text: '那年夏天我就不再住在那里了。' }, { role: 'assistant', text: '嗯，我记下了。' },
    ],
    U: und({ newClues: [] }),
  });
  console.log(`  M t2 direction=${askOf(t2)?.direction} target=${askOf(t2)?.targetClueText} allowed=${askOf(t2)?.allowed}`);
  expect('M2-1 同为 CHANGE 但 target clue 不同 → 不判重复', askOf(t2)?.allowed === true && !(askOf(t2)?.reason ?? '').includes('去重'));
  expect('M2-2 单元：target clue 变化 → 不算重复', classifyRepeatAsk({
    priorCandidate: 'ASK_CANDIDATE', priorDirection: 'CHANGE', priorTargetClueText: CH.text,
    direction: 'CHANGE', targetClueText: CH2.text, reception: 'NOT_PICKED_UP', newMaterialClueCount: 0,
  }).repeat === false);
  expect('M2-3 单元：方向不同 → 不算重复', classifyRepeatAsk({
    priorCandidate: 'ASK_CANDIDATE', priorDirection: 'CHANGE', priorTargetClueText: CH.text,
    direction: 'RELATIONSHIP', targetClueText: CH.text, reception: 'NOT_PICKED_UP', newMaterialClueCount: 0,
  }).repeat === false);
}

/* ═══════════ Q · H2.1 alignment 回归 ═══════════ */
console.log('\n[Q] H2.1 alignment 回归');
{
  const q1 = await turn(PAUSE, {
    clues: [REL], Q: [cand(REL.text, Q_CHANGE)], messages: HIST(REL_HIST),
  });
  console.log(`  Q direction=${askOf(q1)?.direction} intent=${askOf(q1)?.questionIntent} allowed=${askOf(q1)?.allowed}`);
  expect('Q2-1 语义漂移仍被拦截（CHANGE 问题 + RELATIONSHIP 方向）', askOf(q1)?.allowed === false && askOf(q1)?.aligned === false);
  expect('Q2-2 不产出 ASK', !isAsk(q1.result.reply));
  const q2 = await askTurn(REL, Q_RELATION, REL_HIST);
  expect('Q2-3 对齐场景仍可执行（delivered）', askDelivered(q2));
}

console.log('\n================ 结论 ================');
console.log(`断言数：${assertions}（真实 runTurn 场景：${runTurnCount}）`);
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-B.1.x H2.2 Redundancy Hardening 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
