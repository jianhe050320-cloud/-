/**
 * Phase 3.2.4-B.1.x H2.3 · Presentation Fidelity。
 *
 * 只验证一件事：**askExecution.allowed === true 之后，最终 reply 是否忠实呈现了这次 ASK。**
 *   - 模板参数化：ASK = 「关于（重问「再说回」）『anchor』，骨架」，anchor 来自 candidate.targetClueText
 *   - avoidRepeat 对合法 ASK 不再静默降级
 *   - askExecution.delivered 成为「本轮 ASK 是否真的被用户看到」的唯一事实来源
 *
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/h23PresentationFidelity.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState } from '../src/types/interview';
import { buildAskQuestion, buildAskAnchor } from '../src/services/interventionDecision';

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

/** 提问器问题（= 骨架；H2.1 起 Value 与 Execution 同源） */
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
const execOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution;
const askOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askCandidate;
/** H2.3：本轮 ASK 是否真的被用户看到（唯一事实来源），且 reply 就是那次 ASK */
const delivered = (o: RunTurnOutput) =>
  execOf(o)?.delivered === true && o.result.reply === execOf(o)?.text && isAsk(o.result.reply);
const askText = (dir: 'CHANGE' | 'RELATIONSHIP' | 'UNDERSTANDING', clueText: string, variant: 0 | 1 = 0) =>
  buildAskQuestion({ direction: dir, anchor: buildAskAnchor(clueText), variant }).text;

/* ---- 标准材料 ---- */
const CH = clueOf('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。');
const REL = clueOf('turning_point', '我们就不怎么联系了', '后来我们就不怎么联系了。');
const MEAN = clueOf('meaning', '家里就安静了', '那年夏天，家里就安静了。');
const CH_HIST = '后来我不再去那个地方了。';
const REL_HIST = '后来我们就不怎么联系了。';
const MEAN_HIST = '那年夏天，家里就安静了。';

/** 第一轮：发出一轮真实 ASK */
function askTurn(clue: { text: string }, question: string, hist: string) {
  return turn(PAUSE, { clues: [clue], Q: [cand(clue.text, question)], messages: HIST(hist) });
}

console.log('\n========== Phase 3.2.4-B.1.x H2.3 · Presentation Fidelity ==========\n');

/* ═══════════ A · 首次 ASK 必须真实输出 ═══════════ */
console.log('\n[A] 首次 ASK');
{
  const out = await askTurn(CH, Q_CHANGE, CH_HIST);
  console.log(`  A reply=${out.result.reply}`);
  expect('A1 askExecution.allowed === true', execOf(out)?.allowed === true);
  expect('A2 askExecution.delivered === true', execOf(out)?.delivered === true);
  expect('A3 reply === askExecution.text', out.result.reply === execOf(out)?.text);
  expect('A4 lastIntervention.candidate === ASK_CANDIDATE', out.focus.lastIntervention?.candidate === 'ASK_CANDIDATE');
  expect('A5 ASK 文本带用户原话锚点', out.result.reply.includes('我不再去那个地方了'));
  expect('A6 observer 记录「ASK 已发出」', out.result.observer.ruleHits.some((h) => h.includes('ASK 已发出')));
}

/* ═══════════ B · 同 dir + 同 target + 无新 material → 不 ASK（H2.2 保持） ═══════════ */
console.log('\n[B] 同方向无新材料 → 不 ASK');
{
  const t1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  const t2 = await turn('嗯。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], focus: t1.focus,
    messages: [{ role: 'user', text: CH_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [] }),
  });
  console.log(`  B t2=${t2.result.reply}`);
  expect('B1 askCandidate 未放行（H2.2 去重仍生效）', askOf(t2)?.allowed === false);
  expect('B2 askExecution.delivered === false', execOf(t2)?.delivered === false);
  expect('B3 最终不是 ASK', !isAsk(t2.result.reply));
}

/* ═══════════ C · 同 dir + 同 target + 有新 material（H2.3 核心） ═══════════ */
console.log('\n[C] 同方向 + 同 target + 有新 material');
{
  const t1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  const t2 = await turn('这个我一直没想明白。', {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)], focus: t1.focus,
    messages: [{ role: 'user', text: CH_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [{ kind: 'open_thread', text: '没想明白', importance: 5, userInitiated: true, evidence: '没想明白' }] }),
  });
  console.log(`  C t1=${t1.result.reply}\n    t2=${t2.result.reply}`);
  expect('C1 askCandidate.allowed === true', askOf(t2)?.allowed === true);
  expect('C2 askExecution.allowed === true', execOf(t2)?.allowed === true);
  expect('C3 askExecution.delivered === true', execOf(t2)?.delivered === true);
  expect('C4 reply === askExecution.text', t2.result.reply === execOf(t2)?.text);
  expect('C5 reply 与上一轮 ASK 文本不同（H2.2-c）', t2.result.reply !== t1.result.reply);
  expect('C6 direction 相同', askOf(t2)?.direction === askOf(t1)?.direction && askOf(t2)?.direction === 'CHANGE');
  expect('C7 targetClue 相同', askOf(t2)?.targetClueText === askOf(t1)?.targetClueText);
  expect('C8 questionIntent 相同', askOf(t2)?.questionIntent === askOf(t1)?.questionIntent);
  expect('C9 重问使用「再说回」措辞', t2.result.reply.startsWith('再说回「'));
}

/* ═══════════ D · 合法 ASK 不被 avoidRepeat 改写 ═══════════ */
console.log('\n[D] ASK + avoidRepeat');
{
  const expected = askText('CHANGE', CH.text) as string;
  const out = await turn(PAUSE, {
    clues: [CH], Q: [cand(CH.text, Q_CHANGE)],
    // 构造「上一轮 assistant text 与本轮 ASK 完全相同」的最坏情况
    messages: [...HIST(CH_HIST), { role: 'assistant', text: expected }],
  });
  console.log(`  D reply=${out.result.reply}`);
  expect('D1 合法 ASK 未被替换成 STEP_BACK', out.result.reply === expected && isAsk(out.result.reply));
  expect('D2 delivered === true', execOf(out)?.delivered === true);
  expect('D3 reply === askExecution.text', out.result.reply === execOf(out)?.text);
  expect('D4 没有退一步话术的痕迹', !out.result.reply.includes('我们先放着'));
}

/* ═══════════ E · 三个方向都必须带 anchor ═══════════ */
console.log('\n[E] 模糊指代');
{
  const ch = await askTurn(CH, Q_CHANGE, CH_HIST);
  const re = await askTurn(REL, Q_RELATION, REL_HIST);
  const un = await askTurn(MEAN, Q_UNDERSTANDING, MEAN_HIST);
  console.log(`  E CHANGE      =${ch.result.reply}`);
  console.log(`  E RELATIONSHIP=${re.result.reply}`);
  console.log(`  E UNDERSTANDING=${un.result.reply}`);
  expect('E1 CHANGE 带锚点', delivered(ch) && ch.result.reply.includes('我不再去那个地方了'));
  expect('E2 RELATIONSHIP 带锚点', delivered(re) && re.result.reply.includes('我们就不怎么联系了'));
  expect('E3 UNDERSTANDING 带锚点', delivered(un) && un.result.reply.includes('家里就安静了'));
  // 锚点替换掉了原先的泛指：句首不再是「这件事」/「那个」
  expect('E4 不再以「这件事之后」开头', ![ch, re, un].some((o) => o.result.reply.startsWith('这件事')));
  expect('E5 UNDERSTANDING 不再用「那个」指代', !un.result.reply.includes('那个'));
  expect('E6 三个方向文本互不相同', new Set([ch.result.reply, re.result.reply, un.result.reply]).size === 3);
}

/* ═══════════ F · 长 targetClueText ═══════════ */
console.log('\n[F] 长 targetClueText');
{
  // F1：超长但有自然句读 → 取最长完整片段作为 anchor，仍然成功 ASK
  const longOk = '他当众说我的那一下，我到现在都还记得，后来我就不再去了';
  const f1 = await turn(PAUSE, {
    clues: [clueOf('turning_point', longOk, longOk)],
    Q: [cand(longOk, Q_CHANGE)],
    messages: HIST(`${longOk}。`),
  });
  console.log(`  F1 anchor 场景 reply=${f1.result.reply}`);
  expect('F1 超长但有完整片段 → 仍能 ASK 并 delivered', delivered(f1));
  expect(
    'F1b anchor 是原话里的完整片段（只删除、不改写）',
    f1.result.reply.includes('「他当众说我的那一下」') && longOk.includes('他当众说我的那一下'),
  );
  // F2：超长且无任何安全片段 → Execution 明确不执行（绝不出现「假已发出」）
  const longBad = '他说什么我都不记得了后来也不再去想了';
  const f2 = await turn(PAUSE, {
    clues: [clueOf('turning_point', longBad, longBad)],
    Q: [cand(longBad, Q_CHANGE)],
    messages: HIST(`${longBad}。`),
  });
  console.log(`  F2 无法形成 anchor：candidate=${askOf(f2)?.allowed} exec=${execOf(f2)?.allowed} delivered=${execOf(f2)?.delivered} reply=${f2.result.reply}`);
  expect('F2 无法安全形成 anchor → askExecution.allowed === false', execOf(f2)?.allowed === false);
  expect('F2b 绝不出现「trace 说已发出但没有 ASK」', execOf(f2)?.delivered === false && !isAsk(f2.result.reply));
  expect('F2c 拒绝原因明确指向 anchor/self-check', /未能生成合规 ASK/.test(execOf(f2)?.reason ?? ''));
  expect('F2d 不写入 ASK 跨轮状态', f2.focus.lastIntervention?.candidate !== 'ASK_CANDIDATE');
}

/* ═══════════ G · 被更高优先级分支覆盖 ═══════════ */
console.log('\n[G] 高优先级分支覆盖');
{
  const base = { clues: [CH], Q: [cand(CH.text, Q_CHANGE)] };
  const hist = HIST(CH_HIST);
  const cases: [string, string][] = [
    ['G1 activeExpression', '反正那天挺乱的，而且那时候我还……'],
    ['G2 explicit user intent', '帮我整理成故事吧。'],
    ['G3 correction', '不是这样的，我没这么说过。'],
    ['G4 refusal', '我不想聊这个了。'],
  ];
  for (const [label, text] of cases) {
    const out = await turn(text, { ...base, messages: hist, U: und({ newClues: [] }) });
    console.log(`  ${label} reply=${out.result.reply}`);
    expect(`${label} → 可以不是 ASK`, !isAsk(out.result.reply));
    expect(`${label} → delivered === false`, execOf(out)?.delivered === false);
    expect(`${label} → 不伪装成 ASK 已发出`, out.focus.lastIntervention?.candidate !== 'ASK_CANDIDATE');
  }
}

/* ═══════════ H · H2.1 语义一致回归 ═══════════ */
console.log('\n[H] H2.1 一致性（加了 anchor 也不得重推）');
{
  const h1 = await askTurn(CH, Q_CHANGE, CH_HIST);
  console.log(`  H candidate=${JSON.stringify(askOf(h1))}\n    exec=${JSON.stringify(execOf(h1))}`);
  expect('H1 Candidate.direction === Execution.direction', askOf(h1)?.direction === execOf(h1)?.direction);
  expect('H2 Candidate.targetClueText === Execution.targetClueText', askOf(h1)?.targetClueText === execOf(h1)?.targetClueText);
  expect('H3 Candidate.questionIntent === Execution.questionIntent', askOf(h1)?.questionIntent === execOf(h1)?.questionIntent);
  expect('H4 anchor 就来自 Execution.targetClueText（不另找 clue）', execOf(h1)?.targetClueText === CH.text && h1.result.reply.includes(CH.text));
}

/* ═══════════ I · H2.2 redundancy 回归 ═══════════ */
console.log('\n[I] H2.2 冗余保护回归');
{
  const t1 = await askTurn(REL, Q_RELATION, REL_HIST);
  const i1 = await turn('嗯。', {
    clues: [REL], Q: [cand(REL.text, Q_RELATION)], focus: t1.focus,
    messages: [{ role: 'user', text: REL_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [] }),
  });
  expect('I1 同方向 + 同 target + 无新 material → NO ASK', askOf(i1)?.allowed === false && !isAsk(i1.result.reply));
  const i2 = await turn('我们彻底不联系了。', {
    clues: [REL], Q: [cand(REL.text, Q_RELATION)], focus: t1.focus,
    messages: [{ role: 'user', text: REL_HIST }, { role: 'assistant', text: t1.result.reply }],
    U: und({ newClues: [{ kind: 'open_thread', text: '彻底不联系了', importance: 5, userInitiated: true, evidence: '我们彻底不联系了' }] }),
  });
  expect('I2 有新 material → 可以 ASK（且真的被看到）', delivered(i2) && i2.result.reply !== t1.result.reply);
  const i3 = await turn(PAUSE, {
    clues: [clueOf('meaning', '那是一种告别', '我说过，那对我来说是一种告别。')],
    Q: [cand('那是一种告别', Q_UNDERSTANDING)],
    messages: HIST('我说过，那对我来说是一种告别。'),
  });
  expect('I3 用户已说出的 meaning → 不重新索取', askOf(i3)?.allowed === false && !isAsk(i3.result.reply));
  const i4 = await turn('我突然发现我其实一直在躲着他。', {
    clues: [clueOf('meaning', '我其实一直在躲着他', '我其实一直在躲着他')],
    Q: [cand('我其实一直在躲着他', Q_UNDERSTANDING)],
  });
  expect('I4 user-owned discovery → 不被 ASK 抢走', askOf(i4)?.allowed === false && !isAsk(i4.result.reply));
}

console.log('\n================ 结论 ================');
console.log(`断言数：${assertions}（真实 runTurn 场景：${runTurnCount}）`);
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-B.1.x H2.3 Presentation Fidelity 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
