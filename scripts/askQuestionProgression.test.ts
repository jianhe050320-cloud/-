/**
 * Phase 3.2.4-B.1.x H2.3.1 · ASK Question Progression Hardening。
 *
 * 只修一个问题：ASK 不能重新询问用户刚刚已经明确回答过的信息。
 *   - CHANGE       ：已给变化起点 → 不 ASK；只给结果 → 可 ASK
 *   - RELATIONSHIP ：已说出关系变化 → 不 ASK；只给相关事件/状态 → 可 ASK
 *   - UNDERSTANDING：已直接说出判断/结论 → 不 ASK；只给事实未给结论 → 可 ASK
 * 核心：问题与材料相关 ≠ 问题还能带来新信息。
 *
 * 覆盖：1 CHANGE 已答 / 2 CHANGE 仅结果 / 3 RELATIONSHIP 已答 / 4 RELATIONSHIP 未答
 *       5 UNDERSTANDING 已答 / 6 UNDERSTANDING 未答 / 7 不确定→保守 / 8 不影响 Direction Safety
 *
 *  node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askQuestionProgression.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { InterviewState } from '../src/types/interview';
import { isQuestionAlreadyAnsweredByTarget, classifyAskDirection } from '../src/services/interventionDecision';

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

function und(): Record<string, unknown> {
  return {
    newClues: [{ kind: 'emotion', text: '挺乱的', importance: 4, userInitiated: true, evidence: '挺乱的' }],
    signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.3 },
    memoryPatch: null, completeness: 0.6, focus: '那天', intent: 'ANSWER_STORY',
  };
}
function cand(target: string, value = 5, question = '这件事有什么变化吗？') {
  return {
    ack: '嗯。', question, ask: false, target_clue: target, story_value: value,
    user_initiative: 2, emotional_signal: 2, information_gain: 4, willingness: 3, disturbance_cost: 1, sensitivity_risk: 1,
  };
}
let understandingRaw: Record<string, unknown> = und();
let questionCandidates: unknown[] = [cand('x')];
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
const Q_CHANGE = '这件事有什么变化吗？';
const Q_RELATION = '你们之间的关系有什么变化吗？';
const Q_UNDERSTANDING = '这件事对你来说意味着什么？';

const dirOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution?.direction ?? null;
const execOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution;
const askOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askCandidate;
const progOf = (o: RunTurnOutput) => askOf(o)?.questionProgression;
/** H2.3：ASK 已真正交付给用户（回复就是那次 ASK） */
const askDelivered = (o: RunTurnOutput) => execOf(o)?.delivered === true && /^关于「|再说回「/.test(o.result.reply);

/** 真实 runTurn：历史原话（clue 锚点）+ 本轮停顿 + 目标 clue + 语义一致的提问器问题 */
async function scenario(history: string, kind: string, text: string, question: string): Promise<RunTurnOutput> {
  runTurnCount += 1;
  understandingRaw = und();
  questionCandidates = [cand(text, 5, question)];
  const input = {
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: [{ id: 'c1', kind, text, importance: 5, userInitiated: true, evidence: history, turn: 1 }] as never[],
    highValueClues: [], messages: [{ role: 'user', text: history }, { role: 'assistant', text: '嗯，我记下了。' }], userText: PAUSE,
  } as RunTurnInput;
  return runTurn(input);
}

console.log('\n================ Phase 3.2.4-B.1.x H2.3.1 · Question Progression ================\n');

/* ═══════════ 单元层（复用现有纯函数，不与 runTurn 混算） ═══════════ */
console.log('\n[unit] isQuestionAlreadyAnsweredByTarget 直接判定');
{
  expect('U1 CHANGE「那次考试之后我开始改变想法」→ 已回答', isQuestionAlreadyAnsweredByTarget({ direction: 'CHANGE', targetClueText: '那次考试之后我开始改变想法' }).allowed === false);
  expect('U2 CHANGE「我后来就不去了」→ 可追问', isQuestionAlreadyAnsweredByTarget({ direction: 'CHANGE', targetClueText: '我后来就不去了' }).allowed === true);
  expect('U3 RELATIONSHIP「我们后来就不怎么联系了」→ 已回答', isQuestionAlreadyAnsweredByTarget({ direction: 'RELATIONSHIP', targetClueText: '我们后来就不怎么联系了' }).allowed === false);
  expect('U4 RELATIONSHIP「我一直没跟他说过」→ 可追问', isQuestionAlreadyAnsweredByTarget({ direction: 'RELATIONSHIP', targetClueText: '我一直没跟他说过' }).allowed === true);
  expect('U5 UNDERSTANDING「我不喜欢那里」→ 已回答', isQuestionAlreadyAnsweredByTarget({ direction: 'UNDERSTANDING', targetClueText: '我不喜欢那里' }).allowed === false);
  expect('U6 UNDERSTANDING「家里就安静了」→ 可追问', isQuestionAlreadyAnsweredByTarget({ direction: 'UNDERSTANDING', targetClueText: '家里就安静了' }).allowed === true);
  expect('U7 不确定（空 clue）→ 保守不阻断', isQuestionAlreadyAnsweredByTarget({ direction: 'RELATIONSHIP', targetClueText: '' }).allowed === true);
}

/* ═══════════ 1. CHANGE 已回答 → 不 ASK ═══════════ */
console.log('\n[1] CHANGE 已给出变化起点 → 不 ASK');
{
  const cases: [string, string, string][] = [
    ['那次考试之后，我的看法就变了。', 'turning_point', '那次考试之后，我的看法就变了'],
    ['从那次吵架之后我就变了。', 'turning_point', '从那次吵架之后我就变了'],
  ];
  for (const [i, [hist, kind, text]] of cases.entries()) {
    const out = await scenario(hist, kind, text, Q_CHANGE);
    console.log(`  1-${i + 1} raw「${hist}」→ [${dirOf(out)}] reply=${out.result.reply}`);
    expect(`1-${i + 1}a askCandidate 被 Question Progression 拦下`, askOf(out)?.allowed === false);
    expect(`1-${i + 1}b questionProgression.alreadyAnswered=true`, progOf(out)?.alreadyAnswered === true);
    expect(`1-${i + 1}c ASK 未交付`, askDelivered(out) === false);
    expect(`1-${i + 1}d Direction 仍为 CHANGE（不影响 Direction Safety）`, askOf(out)?.direction === 'CHANGE');
  }
}

/* ═══════════ 2. CHANGE 只有结果 → 可以 ASK ═══════════ */
console.log('\n[2] CHANGE 只给结果、未给起点 → 可以 ASK');
{
  const cases: [string, string, string][] = [
    ['我后来就不去了。', 'turning_point', '我后来就不去了'],
    ['我对他的看法变了。', 'turning_point', '我对他的看法变了'],
  ];
  for (const [i, [hist, kind, text]] of cases.entries()) {
    const out = await scenario(hist, kind, text, Q_CHANGE);
    console.log(`  2-${i + 1} raw「${hist}」→ [${dirOf(out)}] reply=${out.result.reply}`);
    expect(`2-${i + 1}a askCandidate 放行`, askOf(out)?.allowed === true);
    expect(`2-${i + 1}b ASK 已交付`, askDelivered(out) === true);
    expect(`2-${i + 1}c direction=CHANGE`, dirOf(out) === 'CHANGE');
  }
}

/* ═══════════ 3. RELATIONSHIP 已回答 → 不 ASK ═══════════ */
console.log('\n[3] RELATIONSHIP 已说出关系变化 → 不 ASK（H2.3 Audit 修复点）');
{
  const cases: [string, string, string][] = [
    ['我们后来就不怎么联系了。', 'turning_point', '我们后来就不怎么联系了'],
    ['我们之间变得很疏远。', 'turning_point', '我们之间变得很疏远'],
    ['他后来和我彻底闹掰了。', 'turning_point', '他后来和我彻底闹掰了'],
  ];
  for (const [i, [hist, kind, text]] of cases.entries()) {
    const out = await scenario(hist, kind, text, Q_RELATION);
    console.log(`  3-${i + 1} raw「${hist}」→ [${dirOf(out)}] reply=${out.result.reply}`);
    expect(`3-${i + 1}a askCandidate 被 Question Progression 拦下`, askOf(out)?.allowed === false);
    expect(`3-${i + 1}b questionProgression.alreadyAnswered=true`, progOf(out)?.alreadyAnswered === true);
    expect(`3-${i + 1}c ASK 未交付`, askDelivered(out) === false);
    expect(`3-${i + 1}d Direction 仍为 RELATIONSHIP（不影响 Direction Safety）`, askOf(out)?.direction === 'RELATIONSHIP');
  }
}

/* ═══════════ 4. RELATIONSHIP 未回答 → 可以 ASK ═══════════ */
console.log('\n[4] RELATIONSHIP 只给相关事件/状态、未说变化 → 可以 ASK');
{
  const cases: [string, string, string][] = [
    ['我一直没跟他说过。', 'open_thread', '没跟他说过'],
    ['我们之间一直很僵。', 'open_thread', '我们之间一直很僵'],
  ];
  for (const [i, [hist, kind, text]] of cases.entries()) {
    const out = await scenario(hist, kind, text, Q_RELATION);
    console.log(`  4-${i + 1} raw「${hist}」→ [${dirOf(out)}] reply=${out.result.reply}`);
    expect(`4-${i + 1}a askCandidate 放行`, askOf(out)?.allowed === true);
    expect(`4-${i + 1}b ASK 已交付`, askDelivered(out) === true);
    expect(`4-${i + 1}c direction=RELATIONSHIP`, dirOf(out) === 'RELATIONSHIP');
  }
}

/* ═══════════ 5. UNDERSTANDING 已回答 → 不 ASK ═══════════ */
console.log('\n[5] UNDERSTANDING 已直接说出判断/结论 → 不 ASK');
{
  const cases: [string, string, string][] = [
    ['我不喜欢那里。', 'meaning', '我不喜欢那里'],
    ['这不适合我。', 'meaning', '这不适合我'],
  ];
  for (const [i, [hist, kind, text]] of cases.entries()) {
    const out = await scenario(hist, kind, text, Q_UNDERSTANDING);
    console.log(`  5-${i + 1} raw「${hist}」→ [${dirOf(out)}] reply=${out.result.reply}`);
    expect(`5-${i + 1}a askCandidate 被 Question Progression 拦下`, askOf(out)?.allowed === false);
    expect(`5-${i + 1}b questionProgression.alreadyAnswered=true`, progOf(out)?.alreadyAnswered === true);
    expect(`5-${i + 1}c ASK 未交付`, askDelivered(out) === false);
    expect(`5-${i + 1}d Direction 仍为 UNDERSTANDING（不影响 Direction Safety）`, askOf(out)?.direction === 'UNDERSTANDING');
  }
}

/* ═══════════ 6. UNDERSTANDING 未回答 → 可以 ASK ═══════════ */
console.log('\n[6] UNDERSTANDING 只给事实、未给结论 → 可以 ASK');
{
  const cases: [string, string, string][] = [
    ['家里就安静了。', 'meaning', '家里就安静了'],
    ['那天之后饭桌上没人说话了。', 'meaning', '那天之后饭桌上没人说话了'],
  ];
  for (const [i, [hist, kind, text]] of cases.entries()) {
    const out = await scenario(hist, kind, text, Q_UNDERSTANDING);
    console.log(`  6-${i + 1} raw「${hist}」→ [${dirOf(out)}] reply=${out.result.reply}`);
    expect(`6-${i + 1}a askCandidate 放行`, askOf(out)?.allowed === true);
    expect(`6-${i + 1}b ASK 已交付`, askDelivered(out) === true);
    expect(`6-${i + 1}c direction=UNDERSTANDING`, dirOf(out) === 'UNDERSTANDING');
  }
}

/* ═══════════ 7. 不确定 → 保守（不强行推断，仍允许 ASK） ═══════════ */
console.log('\n[7] 不确定 → 保守（precision 优先，可继续追问）');
{
  // RELATIONSHIP 但只给关系状态、未说变化：保守允许 ASK
  const out = await scenario('我们之间一直很别扭。', 'turning_point', '我们之间一直很别扭', Q_RELATION);
  console.log(`  7-1 raw「我们之间一直很别扭。」→ [${dirOf(out)}] reply=${out.result.reply}`);
  expect('7-1 关系状态但未明确变化 → 保守允许 ASK', askOf(out)?.allowed === true && askDelivered(out) === true);
  expect('7-2 direction 仍为 RELATIONSHIP', askOf(out)?.direction === 'RELATIONSHIP');
  // 无方向材料：direction 门处理，Question Progression 不适用
  expect('7-3 无方向时 questionProgression 不阻断（由 direction 门处理）',
    isQuestionAlreadyAnsweredByTarget({ direction: null, targetClueText: '随便什么' }).allowed === true);
}

/* ═══════════ 8. 不影响 Direction Safety（对照 classifyAskDirection） ═══════════ */
console.log('\n[8] 不影响现有 Direction Safety（classifyAskDirection 独立正确）');
{
  expect('8-1 CHANGE 仍判 CHANGE', classifyAskDirection({ kind: 'turning_point', text: '我对他的看法变了' }) === 'CHANGE');
  expect('8-2 RELATIONSHIP 仍判 RELATIONSHIP', classifyAskDirection({ kind: 'turning_point', text: '我们后来就不怎么联系了' }) === 'RELATIONSHIP');
  expect('8-3 UNDERSTANDING 仍判 UNDERSTANDING', classifyAskDirection({ kind: 'meaning', text: '那是一种告别' }) === 'UNDERSTANDING');
  expect('8-4 open_thread 无关系 → null', classifyAskDirection({ kind: 'open_thread', text: '那到底算什么' }) === null);
}

console.log('\n================ 结论 ================');
console.log(`断言数：${assertions}（其中真实 runTurn 场景：${runTurnCount}）`);
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-B.1.x H2.3.1 Question Progression 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
