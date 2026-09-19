/**
 * Phase 3.2.4-B.1.x H1 · Direction Safety。
 *
 * 原则：「人物出现」≠「关系」。他/她/妈/爸/老师/朋友 只能证明材料里有人，
 * 不能单独构成 RELATIONSHIP。证据不足一律 null（→ 不执行 ASK → 保持 WAIT）。
 *
 * 覆盖：
 *   A. turning_point + 人物但非关系（6+）
 *   B. turning_point + 明确关系（6）
 *   C. open_thread + 关系（4）
 *   D. open_thread + 非关系（4）
 *   E. CHANGE 有变化证据（5）
 *   F. CHANGE 无变化证据（5）
 *   G. 我们 / 咱们 边界（4）
 *   另含真实 runTurn 全链路验证（spec 第四节 7 例 + open_thread P0 两例 + CHANGE 门）
 *
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askDirectionHardening.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { InterviewState } from '../src/types/interview';
import { classifyAskDirection, hasRelationshipEvidence, hasChangeEvidence } from '../src/services/interventionDecision';

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
// H2.3：最终 ASK = 「关于（重问「再说回」）『anchor』，骨架」；骨架如下（仍用于 E6/E7 检查）
const ASK_RELATION = '你们之间后来有什么不一样吗？';
const ASK_CHANGE = '你后来是从哪一件事开始变的？';
const ASK_UNDERSTANDING = '你后来发现的是什么？';
/** H2.3：形状标记（anchor 无关） */
const isAsk = (r: string) => /^(关于|再说回)「/.test((r ?? '').trim());
/** H2.3：本轮 ASK 是否真的被用户看到，且回复就是那次 ASK */
const askDeliveredH1 = (o: RunTurnOutput) =>
  execOf(o)?.delivered === true && o.result.reply === execOf(o)?.text && isAsk(o.result.reply);
const dirOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution?.direction ?? null;
const execOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution;
const askOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askCandidate;

const Q_CHANGE = '这件事有什么变化吗？';
const Q_RELATION = '你们之间的关系有什么变化吗？';
const Q_UNDERSTANDING = '这件事对你来说意味着什么？';

/** 真实 runTurn：历史原话（clue 的锚点）+ 本轮停顿 + 目标 clue + 语义一致的提问器问题 */
async function scenario(history: string, kind: string, text: string, question = Q_CHANGE): Promise<RunTurnOutput> {
  runTurnCount += 1;
  understandingRaw = und();
  questionCandidates = [cand(text, 5, question)];
  const input = {
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    // hasPriorMaterial 依赖「之前已经攒下的材料」，ASK 候选才会被允许
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: [{ id: 'c1', kind, text, importance: 5, userInitiated: true, evidence: history, turn: 1 }] as never[],
    highValueClues: [], messages: [{ role: 'user', text: history }, { role: 'assistant', text: '嗯，我记下了。' }], userText: PAUSE,
  } as RunTurnInput;
  return runTurn(input);
}
/** open_thread 的 clue 文本常是原话片段，evidence 用原话 */
const dirOfClue = (kind: string, text: string, evidence?: string) =>
  classifyAskDirection({ kind, text, evidence: evidence ?? text });

console.log('\n================ Phase 3.2.4-B.1.x H1 · Direction Safety ================\n');

/* ═══════════ A. turning_point + 人物但非关系（绝不能变成 RELATIONSHIP） ═══════════ */
console.log('\n[A] turning_point + 人物但非关系');
{
  const cases = [
    '他当众说我',
    '我一直在躲着他',
    '老师那句话',
    '朋友帮我搬了家',
    '我妈给我做了饭',
    '他后来考上了大学',
  ];
  for (const [i, text] of cases.entries()) {
    const d = dirOfClue('turning_point', text);
    expect(`A${i + 1} 「${text}」不因出现人物判 RELATIONSHIP`, d !== 'RELATIONSHIP');
    expect(`A${i + 1}b 「${text}」无变化证据 → null（不猜）`, d === null);
  }
}

/* ═══════════ B. turning_point + 明确关系 ═══════════ */
console.log('\n[B] turning_point + 明确关系');
{
  const cases = [
    ['我们之间变得很疏远', 'RELATIONSHIP'],
    ['后来我们就不怎么联系了', 'RELATIONSHIP'],
    ['他后来和我彻底闹掰了', 'RELATIONSHIP'],
    ['我们后来就不怎么说话了', 'RELATIONSHIP'],
    ['我们分开之后就再没见过', 'RELATIONSHIP'],
    ['我们后来重新联系上了', 'RELATIONSHIP'],
  ] as const;
  for (const [i, [text, want]] of cases.entries()) {
    expect(`B${i + 1} 「${text}」→ ${want}`, dirOfClue('turning_point', text) === want);
  }
}

/* ═══════════ C. open_thread + 关系 ═══════════ */
console.log('\n[C] open_thread + 关系');
{
  const cases = [
    '没跟他说过',
    '我们之间一直有个疙瘩没解开',
    '后来一直没联系',
    '分开之后我没再见过他',
  ];
  for (const [i, text] of cases.entries()) {
    expect(`C${i + 1} open_thread「${text}」→ RELATIONSHIP`, dirOfClue('open_thread', text) === 'RELATIONSHIP');
  }
}

/* ═══════════ D. open_thread + 非关系（P0 修复点） ═══════════ */
console.log('\n[D] open_thread + 非关系');
{
  const cases = ['那到底算什么', '留着那张照片', '一直没想明白', '没交出去的辞职信'];
  for (const [i, text] of cases.entries()) {
    const d = dirOfClue('open_thread', text);
    expect(`D${i + 1} open_thread「${text}」→ null（绝不 fallback RELATIONSHIP）`, d === null);
  }
}

/* ═══════════ E. CHANGE 有变化证据 ═══════════ */
console.log('\n[E] CHANGE 有明确变化证据');
{
  const cases = [
    '我对他的看法变了',
    '后来再也不想去了',
    '我不再想参加了',
    '从那以后我就不去了',
    '他变得不一样了',
  ];
  for (const [i, text] of cases.entries()) {
    expect(`E${i + 1} 「${text}」→ CHANGE`, dirOfClue('turning_point', text) === 'CHANGE');
  }
  expect('E6 新 CHANGE 模板不再断言「想法 / 看法」', !/想法|看法/.test(ASK_CHANGE));
  expect('E7 新 CHANGE 模板断言的是「变化」本身', /开始变的/.test(ASK_CHANGE));
}

/* ═══════════ F. CHANGE 无变化证据 ═══════════ */
console.log('\n[F] turning_point 但无变化证据');
{
  const cases = ['他当众说我的那一下', '我一直在躲着他', '老师那句话', '那天下午在食堂吃饭', '我把工位收拾干净就走了'];
  for (const [i, text] of cases.entries()) {
    expect(`F${i + 1} 「${text}」→ null（不因 kind=turning_point 自动 CHANGE）`, dirOfClue('turning_point', text) === null);
  }
}

/* ═══════════ G. 我们 / 咱们 边界 ═══════════ */
console.log('\n[G] 我们 / 咱们 边界');
{
  expect('G1 「我们一起去了北京」不判 RELATIONSHIP', dirOfClue('turning_point', '我们一起去了北京') !== 'RELATIONSHIP');
  expect('G2 「我们一起去了北京」无变化证据 → null', dirOfClue('turning_point', '我们一起去了北京') === null);
  expect('G3 「咱们一起吃了饭」不判 RELATIONSHIP', dirOfClue('turning_point', '咱们一起吃了饭') !== 'RELATIONSHIP');
  expect('G4 「我们之间一直很别扭」→ RELATIONSHIP（关系状态成立）', dirOfClue('turning_point', '我们之间一直很别扭') === 'RELATIONSHIP');
  expect('G5 关系证据不以「出现人物」为条件', hasRelationshipEvidence('他当众说我') === false && hasRelationshipEvidence('我们之间') === true);
  expect('G6 变化证据独立可测', hasChangeEvidence('看法变了') === true && hasChangeEvidence('他当众说我') === false);
}

/* ═══════════ 真实 runTurn 全链路（spec 第四节） ═══════════ */
console.log('\n[runTurn] spec 第四节 7 例');
{
  const spec: [string, string, string, string | null][] = [
    ['他当众说我的那一下。', 'turning_point', '他当众说我的那一下', null],
    ['我一直在躲着他。', 'turning_point', '我一直在躲着他', null],
    ['后来我们就不怎么联系了。', 'turning_point', '我们就不怎么联系了', 'RELATIONSHIP'],
    ['后来我们之间变得很疏远。', 'turning_point', '我们之间变得很疏远', 'RELATIONSHIP'],
    ['他后来和我彻底闹掰了。', 'turning_point', '他后来和我彻底闹掰了', 'RELATIONSHIP'],
    ['我们一起回去了。', 'turning_point', '我们一起回去了', null],
    ['我们后来就不怎么说话了。', 'turning_point', '我们后来就不怎么说话了', 'RELATIONSHIP'],
  ];
  for (const [i, [hist, kind, text, want]] of spec.entries()) {
    const out = await scenario(hist, kind, text, want === 'RELATIONSHIP' ? Q_RELATION : Q_CHANGE);
    const d = dirOf(out);
    console.log(`  R${i + 1} raw「${hist}」→ [${d}] ${out.result.reply}`);
    expect(`R${i + 1} 真实链路 direction=${want}`, d === want);
    if (want === 'RELATIONSHIP') {
      // H2.3.1：这些 RELATIONSHIP 用例都已直接说出关系变化 → 被 Question Progression 拦截，
      // 不再重复问「有什么不一样」。Direction 仍是 RELATIONSHIP（Direction Safety 不受影响）。
      expect(`R${i + 1}b 关系方向已判定，但被 Question Progression 拦截（不重复问已说出的变化）`, !askDeliveredH1(out) && askOf(out)?.allowed === false);
      expect(`R${i + 1}c questionProgression.alreadyAnswered=true`, askOf(out)?.questionProgression?.alreadyAnswered === true);
    } else {
      expect(`R${i + 1}b 绝不产出关系方向 ASK`, d !== 'RELATIONSHIP');
    }
    expect(`R${i + 1}d askCandidate 层未被改动`, askOf(out) !== undefined);
    expect(`R${i + 1}e askExecution.allowed 与 askCandidate.allowed 一致`, execOf(out)?.allowed === askOf(out)?.allowed);
    expect(`R${i + 1}f Question Value / Timing Value 仍由原 Candidate 层判定`, askOf(out)?.value === 'HIGH' && askOf(out)?.timingValue === 'HIGH');
  }
}
console.log('\n[runTurn] open_thread P0 两例（Audit 记录 → H1 修复验证）');
{
  const p0: [string, string, string, string][] = [
    ['我一直没想明白，那到底算什么。', 'open_thread', '那到底算什么', '嗯。'],
    ['我把那张照片一直留着。', 'open_thread', '留着那张照片', '嗯。'],
  ];
  for (const [i, [hist, kind, text, fallback]] of p0.entries()) {
    const out = await scenario(hist, kind, text);
    console.log(`  P0-${i + 1} raw「${hist}」→ [${dirOf(out)}] ${out.result.reply}`);
    expect(`P0-${i + 1} direction 为 null（不再凭空引入「你们」）`, dirOf(out) === null);
    expect(`P0-${i + 1}b askExecution 未执行`, execOf(out)?.allowed === false);
    expect(`P0-${i + 1}c 不产出任何 ASK`, !isAsk(out.result.reply));
    expect(`P0-${i + 1}d 回复回落到非 ASK（WAIT / 原回复）`, out.result.reply.length > 0 && out.result.reply !== '');
    // H2.1 契约变化：direction 门已移入 Candidate（Candidate 与 Execution 共享同一 direction），
    // 因此 direction=null 时 Candidate 本身就拒绝放行（不再是 Execution 单侧拦截）。
    expect(`P0-${i + 1}e askCandidate 也拒绝放行（H2.1：方向门在 Candidate 内）`, askOf(out)?.allowed === false && askOf(out)?.direction === null);
    expect(`P0-${i + 1}f 拒绝原因是「没有可用 direction」`, (execOf(out)?.reason ?? '').includes('direction'));
    void fallback;
  }
}
console.log('\n[runTurn] CHANGE 门 + 关系门（真实链路）');
{
  const g: [string, string, string, string][] = [
    ['后来我对他的看法变了。', 'turning_point', '我对他的看法变了', 'CHANGE'],
    ['以前我很喜欢那里，后来再也不想去了。', 'turning_point', '以前我很喜欢那里，后来再也不想去了', 'CHANGE'],
    ['从那以后，我不再想参加了。', 'turning_point', '我不再想参加了', 'CHANGE'],
    ['我一直没跟他说过。', 'open_thread', '没跟他说过', 'RELATIONSHIP'],
    ['那天下午我在食堂吃饭。', 'turning_point', '在食堂吃饭', null],
  ];
  for (const [i, [hist, kind, text, want]] of g.entries()) {
    const out = await scenario(hist, kind, text, want === 'RELATIONSHIP' ? Q_RELATION : Q_CHANGE);
    console.log(`  G-${i + 1} raw「${hist}」→ [${dirOf(out)}] ${out.result.reply}`);
    expect(`G-${i + 1} direction=${want}`, dirOf(out) === want);
    expect(`G-${i + 1}a askExecution.allowed 与 direction 一致`, execOf(out)?.allowed === (want !== null));
    if (want === 'CHANGE') expect(`G-${i + 1}b 产出 CHANGE ASK（delivered）`, askDeliveredH1(out));
    if (want === 'RELATIONSHIP') expect(`G-${i + 1}b 产出 RELATIONSHIP ASK（delivered）`, askDeliveredH1(out));
    if (want === null) expect(`G-${i + 1}b 不产出 ASK`, !isAsk(out.result.reply));
  }
}

console.log('\n================ 结论 ================');
console.log(`断言数：${assertions}（其中真实 runTurn 场景：${runTurnCount}）`);
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.4-B.1.x H1 Direction Safety 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
