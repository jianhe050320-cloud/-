/**
 * Phase 3.2.4-B.1.x H2.3.1 · Question Progression Hardening。
 *
 * 只解决一件事：**ASK 不得重复询问用户已经明确表达过的信息。**
 *   - CHANGE       ：要「变化起点」→ target 已给起点 / 只剩变化谓词 → NO ASK
 *   - RELATIONSHIP ：要「关系变化的起点」→ target 已给起点 → NO ASK（骨架改为索取起点）
 *   - UNDERSTANDING：要「用户的判断」→ target 已直接给出判断 → NO ASK
 *
 * 冻结项：H1 evidence detection 与 polarity 判定不在本轮（留待 H1.1）。
 *
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/h23QuestionProgression.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState } from '../src/types/interview';
import {
  isQuestionAlreadyAnsweredByTarget,
  hasOnsetEvidence,
  buildAskQuestion,
  buildAskAnchor,
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

/** 提问器问题 = 骨架（H2.1 起 Value 与 Execution 同源） */
const Q_CHANGE = '你后来是从哪一件事开始变的？';
const Q_RELATION = '你们之间是从哪件事开始变成这样的？';
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
interface O {
  U?: Record<string, unknown>;
  Q?: unknown[];
  clues?: unknown[];
  messages?: { role: 'user' | 'assistant'; text: string }[];
  focus?: ConversationFocus;
}
async function turn(userText: string, o: O = {}): Promise<RunTurnOutput> {
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
const HIST = (t: string) => [{ role: 'user' as const, text: t }, { role: 'assistant' as const, text: '嗯，我记下了。' }];

const isAsk = (r: string) => /^(关于|再说回)「/.test((r ?? '').trim());
const askOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askCandidate;
const execOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution;
const progOf = (o: RunTurnOutput) => askOf(o)?.questionProgression;
const delivered = (o: RunTurnOutput) =>
  execOf(o)?.delivered === true && o.result.reply === execOf(o)?.text && isAsk(o.result.reply);

/** 标准探测：停顿发言 + 单一 clue（clue 文本即 target） */
function probe(kind: string, target: string, question: string) {
  return turn(PAUSE, {
    clues: [clueOf(kind, target, target)],
    Q: [cand(target, question)],
    messages: HIST(`${target}。`),
  });
}
const probeChange = (t: string) => probe('turning_point', t, Q_CHANGE);
const probeRelation = (t: string) => probe('turning_point', t, Q_RELATION);
const probeUnderstanding = (t: string) => probe('meaning', t, Q_UNDERSTANDING);

console.log('\n========== H2.3.1 · Question Progression ==========\n');

/* ═══════════ 单元：纯函数 ═══════════ */
console.log('\n[单元] isQuestionAlreadyAnsweredByTarget / hasOnsetEvidence');
{
  expect('U1 onset：含「之后」→ true', hasOnsetEvidence('那次考试之后我开始改变想法') === true);
  expect('U2 onset：不含起点 → false', hasOnsetEvidence('我后来就不去了') === false);
  expect('U3 CHANGE + 已给起点 → 已回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'CHANGE', targetClueText: '那次考试之后我开始改变想法' }).alreadyAnswered === true);
  expect('U4 CHANGE + 只有结果 → 未回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'CHANGE', targetClueText: '我后来就不去了' }).alreadyAnswered === false);
  expect('U5 CHANGE + 只剩变化谓词（循环）→ 已回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'CHANGE', targetClueText: '变了' }).alreadyAnswered === true);
  expect('U6 CHANGE + 语气填充（反正就是变了）→ 已回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'CHANGE', targetClueText: '反正就是变了' }).alreadyAnswered === true);
  expect('U7 RELATIONSHIP + 已给起点 → 已回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'RELATIONSHIP', targetClueText: '那次争吵以后我们就不怎么联系了' }).alreadyAnswered === true);
  expect('U8 RELATIONSHIP + 无起点 → 未回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'RELATIONSHIP', targetClueText: '我们就不怎么联系了' }).alreadyAnswered === false);
  expect('U9 UNDERSTANDING + 已给判断 → 已回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'UNDERSTANDING', targetClueText: '我不喜欢那里' }).alreadyAnswered === true);
  expect('U10 UNDERSTANDING + 未给判断 → 未回答',
    isQuestionAlreadyAnsweredByTarget({ direction: 'UNDERSTANDING', targetClueText: '家里就安静了' }).alreadyAnswered === false);
  expect('U11 direction=null → 不适用（由 direction 门处理）',
    isQuestionAlreadyAnsweredByTarget({ direction: null, targetClueText: '变了' }).allowed === true);
  expect('U12 无 target → 不适用（由 grounding 门处理）',
    isQuestionAlreadyAnsweredByTarget({ direction: 'CHANGE', targetClueText: null }).allowed === true);
}

/* ═══════════ CHANGE ═══════════ */
console.log('\n[CHANGE]');
{
  const c1a = await probeChange('那次考试之后我开始改变想法');
  console.log(`  1a ${c1a.result.reply} | dir=${askOf(c1a)?.direction} prog=${JSON.stringify(progOf(c1a))}`);
  expect('1a 原句不产生 ASK', askOf(c1a)?.allowed === false && !isAsk(c1a.result.reply));
  expect('1a 该句先被 direction 门拦（无变化证据）——记入报告，不阻断',
    askOf(c1a)?.direction === null || progOf(c1a)?.alreadyAnswered === true);

  const c1b = await probeChange('那次考试之后我就不再改变想法了');
  console.log(`  1b ${c1b.result.reply} | dir=${askOf(c1b)?.direction} prog=${JSON.stringify(progOf(c1b))}`);
  expect('1b 同义且已给起点 → NO ASK（由 Question Progression 拦下）',
    askOf(c1b)?.allowed === false && progOf(c1b)?.alreadyAnswered === true);
  expect('1b direction 已正确判为 CHANGE（不是被方向门拦）', askOf(c1b)?.direction === 'CHANGE');
  expect('1b 理由指向 Question Progression', (askOf(c1b)?.reason ?? '').includes('Question Progression'));

  const c2 = await probeChange('我后来就不去了');
  console.log(`  2  ${c2.result.reply}`);
  expect('2 只给结果未给起点 → 可以 ASK', delivered(c2));

  const c3 = await probeChange('我对他的看法变了');
  console.log(`  3  ${c3.result.reply}`);
  expect('3 含「变了」但不因此直接禁止', delivered(c3));
  expect('3b 判定依据明确：未满足 alreadyAnswered', progOf(c3)?.alreadyAnswered === false);

  const c4 = await probeChange('变了');
  console.log(`  4  ${c4.result.reply} | prog=${JSON.stringify(progOf(c4))}`);
  expect('4 只剩变化谓词 → 不产生循环式 ASK', askOf(c4)?.allowed === false && !isAsk(c4.result.reply));
  expect('4b 理由是「没有可定位内容」', (progOf(c4)?.reason ?? '').includes('没有可定位内容'));
}

/* ═══════════ RELATIONSHIP ═══════════ */
console.log('\n[RELATIONSHIP]');
{
  const r5 = await probeRelation('我们就不怎么联系了');
  console.log(`  5  ${r5.result.reply}`);
  expect('5 未给起点 → 可以 ASK 尚未表达的信息', delivered(r5));
  expect('5b 新骨架索取「从哪件事开始变」，不再重问「有没有变化」',
    r5.result.reply.includes('从哪件事开始变') && !r5.result.reply.includes('有什么不一样'));

  const r6 = await probeRelation('那次争吵以后我们就不怎么联系了');
  console.log(`  6  ${r6.result.reply} | dir=${askOf(r6)?.direction} prog=${JSON.stringify(progOf(r6))}`);
  expect('6 起点 / 转折已提供 → NO ASK', askOf(r6)?.allowed === false && !isAsk(r6.result.reply));
  expect('6b direction 已正确判为 RELATIONSHIP', askOf(r6)?.direction === 'RELATIONSHIP');
  expect('6c 理由指向转折点已提供', (progOf(r6)?.reason ?? '').includes('转折点'));

  const r7 = await probeRelation('我们后来重新联系上了');
  console.log(`  7  ${r7.result.reply}`);
  expect('7 关系重建但未给起点 → 可以 ASK 转折信息', delivered(r7));

  const r8 = await probeRelation('我们有联系');
  console.log(`  8  ${r8.result.reply} | prog=${JSON.stringify(progOf(r8))}`);
  expect('8 polarity 不在本轮范围：保持 H1 冻结（当前仍放行）', askOf(r8)?.allowed === true && delivered(r8));
  expect('8b 记为 H1.1 待办：提问仍会假定存在变化', r8.result.reply.includes('开始变成这样的'));
}

/* ═══════════ UNDERSTANDING ═══════════ */
console.log('\n[UNDERSTANDING]');
{
  const u9 = await probeUnderstanding('我不喜欢那里');
  console.log(`  9  ${u9.result.reply} | prog=${JSON.stringify(progOf(u9))}`);
  expect('9 target 已直接给出判断 → NO ASK', askOf(u9)?.allowed === false && !isAsk(u9.result.reply));
  expect('9b 理由指向「已直接表达判断」', (progOf(u9)?.reason ?? '').includes('判断'));

  const u10 = await probeUnderstanding('这不适合我');
  console.log(`  10 ${u10.result.reply}`);
  expect('10 target 已含结论 → NO ASK', askOf(u10)?.allowed === false && !isAsk(u10.result.reply));

  const u11 = await probeUnderstanding('家里就安静了');
  console.log(`  11 ${u11.result.reply}`);
  expect('11 状态描述、未给判断 → 可以 ASK', delivered(u11));

  const u12 = await probeUnderstanding('那段时间结束了');
  console.log(`  12 ${u12.result.reply}`);
  expect('12 状态描述、未给判断 → 可以 ASK', delivered(u12));
}

/* ═══════════ 回归 13–18 ═══════════ */
console.log('\n[回归]');
{
  // 13 · H2.1 alignment：矛盾问题必须被拦
  const al = await turn(PAUSE, {
    clues: [clueOf('turning_point', '我们就不怎么联系了', '后来我们就不怎么联系了。')],
    Q: [cand('我们就不怎么联系了', Q_CHANGE)],
    messages: HIST('后来我们就不怎么联系了。'),
  });
  expect('13 H2.1 alignment：语义漂移仍被拦', askOf(al)?.allowed === false && askOf(al)?.aligned === false);
  expect('13b 但 progression 本身是通过的（拦在 alignment）', progOf(al)?.allowed === true);

  // 14 · H2.2 redundancy：无新材料不重复
  const CH = clueOf('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。');
  const t1 = await turn(PAUSE, { clues: [CH], Q: [cand(CH.text, Q_CHANGE)], messages: HIST('后来我不再去那个地方了。') });
  const t2 = await turn('嗯。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], focus: t1.focus,
    messages: [{ role: 'user', text: '后来我不再去那个地方了。' }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [] }),
  });
  expect('14 H2.2：同方向 + 同 target + 无新材料 → 不重复 ASK', askOf(t2)?.allowed === false && !isAsk(t2.result.reply));

  // 15 · H2.3 delivered
  const d = await turn(PAUSE, { clues: [CH], Q: [cand(CH.text, Q_CHANGE)], messages: HIST('后来我不再去那个地方了。') });
  expect('15 H2.3：allowed 时必然 delivered', delivered(d) && execOf(d)?.delivered === true);

  // 16 · userOwned discovery
  const own = await turn('我突然发现我其实一直在躲着他。', {
    clues: [clueOf('meaning', '我其实一直在躲着他', '我其实一直在躲着他')],
    Q: [cand('我其实一直在躲着他', Q_UNDERSTANDING)],
  });
  expect('16 userOwned discovery 仍优先（不被 ASK 抢走）', askOf(own)?.allowed === false && !isAsk(own.result.reply));

  // 17 · activeExpression
  const active = await turn('反正那天挺乱的，而且那时候我还……', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], messages: HIST('后来我不再去那个地方了。'),
  });
  expect('17 activeExpression 仍优先', askOf(active)?.allowed === false && !isAsk(active.result.reply));

  // 18 · explicit intent
  const explicit = await turn('帮我整理成故事吧。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], messages: HIST('后来我不再去那个地方了。'),
  });
  expect('18 explicit intent 不被 ASK 抢走（回复层）', !isAsk(explicit.result.reply));
  expect('18b 且不伪装成 ASK 已发出', execOf(explicit)?.delivered === false);
}

/* ═══════════ 目标靶心：语义重复率 ═══════════ */
console.log('\n[靶心] 重复询问率（H2.3 Acceptance 的 42% 是否下降）');
{
  // (a) 应由 Question Progression 拦下的「重复询问」靶心
  const mustBlock = [
    ['turning_point', '那次考试之后我就不再改变想法了', Q_CHANGE],
    ['turning_point', '变了', Q_CHANGE],
    ['turning_point', '反正就是变了', Q_CHANGE],
    ['turning_point', '那次争吵以后我们就不怎么联系了', Q_RELATION],
    ['meaning', '我不喜欢那里', Q_UNDERSTANDING],
    ['meaning', '这不适合我', Q_UNDERSTANDING],
  ] as const;
  let blocked = 0;
  for (const [kind, target, question] of mustBlock) {
    const out = await probe(kind as string, target as string, question as string);
    if (!isAsk(out.result.reply)) blocked += 1;
  }
  console.log(`  「重复询问」靶心被拦下：${blocked}/${mustBlock.length}`);
  expect('靶心A：应拦的重复询问全部不 ASK', blocked === mustBlock.length);

  // (b) 只给了关系「结果」的 target：不拦，但骨架已改为索取转折点 → 不再是重复询问
  const res = await probe('turning_point', '我们后来就不怎么联系了', Q_RELATION);
  console.log(`  靶心B ${res.result.reply}`);
  expect('靶心B：只给结果的 RELATIONSHIP 仍可问，但问的是尚未表达的转折点（非重复）',
    delivered(res) && res.result.reply.includes('从哪件事开始变') && !res.result.reply.includes('有什么不一样'));
}

console.log('\n================ 结论 ================');
console.log(`断言数：${assertions}（真实 runTurn 场景：${runTurnCount}）`);
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-B.1.x H2.3.1 Question Progression 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
