/**
 * Phase 3.2.4-B.1 Audit（已按 B.1.x H1 · Direction Safety 更新契约）。
 *
 * 目的不变：审计「执行出来的问题，是不是我们真正想让 AI 问的问题」。
 *   expect()   = 对「当前契约」的确认（失败 = 测试失败）
 *   record()   = 仍未解决的产品语义风险（P0/P1/P2/P3）
 *   resolved() = 原 B.1 Audit 记录、已被 H1 修复的问题（保留可追溯性）
 *
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/askExecutionAudit.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { InterviewState } from '../src/types/interview';
import { classifyAskDirection, classifyQuestionValue } from '../src/services/interventionDecision';

let failed = 0;
let assertions = 0;
let runTurnCount = 0;
const failures: string[] = [];
const findings: { level: string; title: string; detail: string }[] = [];
const resolvedList: string[] = [];

function expect(name: string, cond: boolean, extra = ''): void {
  assertions += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}
function record(level: 'P0' | 'P1' | 'P2' | 'P3', title: string, detail: string): void {
  findings.push({ level, title, detail });
  console.log(`  ⚠ [${level}] ${title}\n        ${detail}`);
}
function resolved(title: string, detail: string): void {
  resolvedList.push(title);
  console.log(`  ✓ [已修复] ${title}\n        ${detail}`);
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
function cand(target: string, value = 5, question = '这件事有什么变化吗？') {
  return {
    ack: '嗯。', question, ask: false, target_clue: target, story_value: value,
    user_initiative: 2, emotional_signal: 2, information_gain: 4, willingness: 3, disturbance_cost: 1, sensitivity_risk: 1,
  };
}
function clue(kind: string, text: string, evidence: string, importance = 5) {
  return { id: `c_${kind}_${text.slice(0, 3)}`, kind, text, importance, userInitiated: true, evidence, turn: 1 };
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

interface Opts {
  U?: Record<string, unknown>;
  Q?: unknown[];
  clues?: unknown[];
  messages?: { role: 'user' | 'assistant'; text: string }[];
}
async function turn(userText: string, o: Opts = {}): Promise<RunTurnOutput> {
  runTurnCount += 1;
  understandingRaw = o.U ?? und();
  questionCandidates = o.Q ?? [cand('x')];
  const input = {
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: (o.clues ?? []) as never[], highValueClues: [],
    messages: o.messages ?? [], userText,
  } as RunTurnInput;
  return runTurn(input);
}

const PAUSE = '反正那天挺乱的。';
/** H2.1：提问器问题必须与将执行的方向语义一致，否则会被 alignment 拦截 */
const Q_CHANGE = '这件事有什么变化吗？';
const Q_RELATION = '你们之间的关系有什么变化吗？';
const Q_UNDERSTANDING = '这件事对你来说意味着什么？';
// H2.3：最终 ASK = 「关于（重问「再说回」）『anchor』，骨架」；下面是骨架
const ASK_CHANGE = '你后来是从哪一件事开始变的？';
const ASK_RELATION = '你们之间后来有什么不一样吗？';
const ASK_UNDERSTANDING = '你后来发现的是什么？';
/** H2.3：形状标记（anchor 无关） */
const isAsk = (r: string) => /^(关于|再说回)「/.test((r ?? '').trim());
/** H2.3：本轮 ASK 是否真的被用户看到，且回复就是那次 ASK */
const askDeliveredA = (o: RunTurnOutput) =>
  execOf(o)?.delivered === true && o.result.reply === execOf(o)?.text && isAsk(o.result.reply);
const dirOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution?.direction ?? null;
const execOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askExecution;
const askOf = (o: RunTurnOutput) => o.result.observer.decisionTrace?.askCandidate;
const HIST = (text: string) => [{ role: 'user' as const, text }, { role: 'assistant' as const, text: '嗯，我记下了。' }];

/** 完整链路场景：历史原话（grounding 锚点）+ 本轮停顿 + 目标 clue + 与方向语义一致的提问器问题 */
function scenario(
  history: string,
  clueObj: { kind: string; text: string; evidence: string },
  opts: Opts & { question?: string } = {},
  pauseText = PAUSE,
) {
  const { question, ...rest } = opts;
  return turn(pauseText, { clues: [clueObj], Q: [cand(clueObj.text, 5, question ?? Q_CHANGE)], messages: HIST(history), ...rest });
}

console.log('\n========= Phase 3.2.4-B.1 Audit（H1 契约） =========\n');

/* ═══════════ Audit A · Semantic Grounding ═══════════ */
console.log('\n[Audit A] Semantic Grounding');
{
  // A1：用户只说「看法变了」→ H1 后应为 CHANGE，不再凭空断言「你们之间」
  const out = await scenario('后来我对他的看法变了。', clue('turning_point', '我对他的看法变了', '后来我对他的看法变了。'));
  console.log(`  A1 user raw：后来我对他的看法变了。\n     ASK：${out.result.reply}`);
  expect('A1 该场景确实执行了 ASK', isAsk(out.result.reply));
  expect('A1 direction=CHANGE（不再因「他」判 RELATIONSHIP）', dirOf(out) === 'CHANGE');
  expect('A1 不再凭空断言关系变化', !out.result.reply.includes('你们之间'));
  resolved('A1 用户只说「看法变了」，AI 却断言「你们之间不一样」', 'H1 后由「变化证据」驱动 → CHANGE 方向，问「你后来是从哪一件事开始变的？」');
}
{
  // A2：只描述一个事件 → H1 后 direction = null，不执行
  const out = await scenario('他当众说我的那一下。', clue('turning_point', '他当众说我的那一下', '他当众说我的那一下。'));
  console.log(`  A2 user raw：他当众说我的那一下。\n     ASK：${out.result.reply}  [direction=${dirOf(out)}]`);
  expect('A2 无变化/关系证据 → 不执行 ASK', !isAsk(out.result.reply) && execOf(out)?.allowed === false);
  expect('A2 direction=null（不猜）', dirOf(out) === null);
  resolved('A2 用户只描述事件，AI 却断言关系变化', 'H1 后 direction=null → 不执行 ASK，回落到非 ASK 回复');
}
{
  // A3：用户确实说了「变化」→ 模板忠实且不再断言「想法」
  const out = await scenario('后来我不再去那个地方了。', clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。'));
  console.log(`  A3 user raw：后来我不再去那个地方了。\n     ASK：${out.result.reply}`);
  expect('A3 direction=CHANGE', dirOf(out) === 'CHANGE');
  expect('A3 问「开始变的」忠实于用户的变化表达', out.result.reply.includes('开始变的'));
  expect('A3 不再预设「你的想法 / 看法」变了', !/想法|看法/.test(out.result.reply));
}
{
  // A4：用户已经说过「后来才发现」→ 不该被 AI 抢走
  const out = await turn('后来我才发现，我其实一直很在意她怎么看我。', {
    clues: [clue('meaning', '我其实一直很在意', '我其实一直很在意')],
    Q: [cand('我其实一直很在意', 5, '这对你来说意味着什么？')],
  });
  console.log(`  A4 user raw：后来我才发现，我其实一直很在意她怎么看我。\n     ASK：${out.result.reply}`);
  expect('A4 用户自己的发现被保护（不执行 ASK）', !isAsk(out.result.reply) && askOf(out)?.allowed === false);
}
{
  // A5–A14：三个方向的泄漏词审计
  // H2.3 起 ASK = 骨架 + 用户原话锚点；锚点是用户自己的话，必须豁免（否则会误报「偷带」）
  const ch = (await scenario('后来我不再去那个地方了。', clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。'))).result.reply;
  // H2.3.1：A16 的 RELATIONSHIP 样例改用「关系状态（非已陈述变化）」材料，
  // 这样 ASK 仍能交付、可验证锚点；已陈述变化的 RELATIONSHIP 由 askQuestionProgression 覆盖。
  const re = (await scenario('我们之间一直很别扭。', clue('turning_point', '我们之间一直很别扭', '我们之间一直很别扭。'), {
    question: Q_RELATION,
  })).result.reply;
  const un = (await scenario('那年夏天，家里就安静了。', clue('meaning', '家里就安静了', '家里就安静了'), {
    question: Q_UNDERSTANDING,
  })).result.reply;
  const skeletons = [ASK_CHANGE, ASK_RELATION, ASK_UNDERSTANDING];
  const leaks: [string, string][] = [
    ['第一次', '第一次'], ['一直', '一直'], ['慢慢', '慢慢'], ['真正', '真正'],
    ['其实', '其实'], ['后来才', '后来才'], ['因为', '因为'], ['从那以后', '从那以后'],
  ];
  for (const [label, token] of leaks) {
    expect(`A5-${label} 骨架不偷带「${label}」`, !skeletons.some((t) => t.includes(token)));
  }
  expect('A13 骨架不含时间顺序臆造（先/再/然后）', !skeletons.some((t) => /(先|再|然后)/.test(t)));
  expect('A14 骨架不含因果臆造（所以/导致）', !skeletons.some((t) => /(所以|导致)/.test(t)));
  expect(
    'A16 三个方向的 ASK 都逐字引用用户原话锚点',
    [ch, re, un].every((r) => /^(关于|再说回)「/.test(r.trim())) &&
      ch.includes('我不再去那个地方了') &&
      re.includes('我们之间一直很别扭') &&
      un.includes('家里就安静了'),
  );
}
{
  // A15：grounding 对「LLM 复述式 clue」过于敏感（仍未解决）
  const out = await scenario('我妈当时什么都没说。', clue('turning_point', '我妈什么也没说', '我妈什么也没说'));
  console.log(`  A15 raw「我妈当时什么都没说。」clue「我妈什么也没说」→ ASK：${out.result.reply}`);
  expect('A15 复述式 clue 被 grounding 拒绝', !isAsk(out.result.reply) && askOf(out)?.allowed === false);
  expect('A15 拒绝原因是「无法回溯到用户原话」', (askOf(out)?.reason ?? '').includes('无法回溯'));
  record('P2', 'A15 grounding 对「LLM 复述式 clue」过于敏感', '公共子串 < 3 字即判「无法回溯」→ 同义复述会造成召回损失（方向安全）。');
}

/* ═══════════ Audit B · Direction ═══════════ */
console.log('\n[Audit B] Direction 判定');
{
  const cases: { id: string; kind: string; text: string; hist: string; expectDir: string | null; note: string; question?: string }[] = [
    { id: 'B-A 事件主线+人物', kind: 'turning_point', text: '他当众说我的那一下', hist: '他当众说我的那一下。', expectDir: null, note: '出现人物 ≠ 谈关系，且无变化证据' },
    { id: 'B-B 关系主线', kind: 'turning_point', text: '我们就不怎么联系了', hist: '后来我们就不怎么联系了。', expectDir: 'RELATIONSHIP', note: '明确关系变化 → 正确', question: Q_RELATION },
    { id: 'B-C 自我理解+人物', kind: 'turning_point', text: '我一直在躲着他', hist: '我一直在躲着他。', expectDir: null, note: '人物只是对象，不是关系主线' },
    { id: 'B-D open_thread+关系', kind: 'open_thread', text: '没跟他说过', hist: '我一直没跟他说过。', expectDir: 'RELATIONSHIP', note: '未闭合的关系互动 → 正确', question: Q_RELATION },
    { id: 'B-E meaning+人物', kind: 'meaning', text: '她其实是为我好', hist: '我后来才明白，她其实是为我好。', expectDir: 'UNDERSTANDING', note: 'meaning 优先 → 正确', question: Q_UNDERSTANDING },
    { id: 'B-F turning_point 无人物', kind: 'turning_point', text: '我不再去那个地方了', hist: '后来我不再去那个地方了。', expectDir: 'CHANGE', note: '变化证据成立 → CHANGE' },
    { id: 'B-G 关系变化', kind: 'turning_point', text: '我们之间变得很疏远', hist: '后来我们之间变得很疏远。', expectDir: 'RELATIONSHIP', note: '关系状态成立', question: Q_RELATION },
    { id: 'B-H 闹掰', kind: 'turning_point', text: '他后来和我彻底闹掰了', hist: '他后来和我彻底闹掰了。', expectDir: 'RELATIONSHIP', note: '明确关系破裂', question: Q_RELATION },
  ];
  for (const c of cases) {
    const out = await scenario(c.hist, clue(c.kind, c.text, c.text), c.question ? { question: c.question } : {});
    const actual = dirOf(out);
    console.log(`  ${c.id} → direction=${actual}  ASK：${out.result.reply}`);
    expect(`${c.id} direction=${c.expectDir ?? 'null'} 符合 H1 契约`, actual === c.expectDir);
    // H2.3.1：已陈述关系变化 / 已表达意义的 material，direction 仍正确但候选会被 Question Progression 拦下，
    // 因此「执行放行」应与候选放行状态一致，而非与 direction 非空直接挂钩。
    expect(`${c.id}b ASK 执行与候选放行状态一致`, execOf(out)?.allowed === (askOf(out)?.allowed ?? false));
    if (actual !== c.expectDir) record('P1', `B Direction 误判：${c.id}`, `实际 ${actual}，预期 ${c.expectDir}（${c.note}）`);
  }
  resolved('B-A/B-C 事件或自我理解场景因出现「他/她」被误判 RELATIONSHIP', 'H1 后改为「关系语义证据」驱动，二者均返回 null（不执行 ASK）');
  resolved('Direction 漏判「我们」不识别为关系指代', 'H1 后「我们/咱们 + 关系状态/互动」→ RELATIONSHIP（实测「后来我们就不怎么联系了。」正确）');
  // B-G：meaning + 明确 self realization → userOwned 拦截
  const g = await turn('后来我才明白，我一直是在讨好她。', {
    clues: [clue('meaning', '我一直是在讨好她', '我一直是在讨好她')],
    Q: [cand('我一直是在讨好她', 5, '这对你来说意味着什么？')],
  });
  expect('B-I meaning+self realization → 不执行 ASK（发现权归用户）', !isAsk(g.result.reply) && askOf(g)?.allowed === false);
  expect('B-J 纯 person clue 无方向', classifyAskDirection({ kind: 'person', text: '我妈', evidence: '我妈当时什么都没说' }) === null);
  expect('B-K event clue 无方向', classifyAskDirection({ kind: 'event', text: '那天' }) === null);
  expect('B-L detail clue 无方向', classifyAskDirection({ kind: 'detail', text: '门轻轻关上' }) === null);
  expect('B-M 「我们之间一直很别扭」→ RELATIONSHIP', classifyAskDirection({ kind: 'turning_point', text: '我们之间一直很别扭' }) === 'RELATIONSHIP');
  // 「你们」单独出现不是关系证据（precision > recall，召回损失记录在案）
  expect('B-N 「你们后来没再说」不判 RELATIONSHIP（保守）', classifyAskDirection({ kind: 'turning_point', text: '你们后来没再说' }) === null);
  record('P3', 'B-N 「你们 / 他们 + 关系语义缺失」未被识别为关系', 'RELATION_WE_RE 只覆盖「我们 / 咱们」，因此「你们后来没再说」这类表达会漏判（precision 优先的已知召回损失）。');
}

/* ═══════════ Audit C · Naturalness（15 个真实链路场景） ═══════════ */
console.log('\n[Audit C] Naturalness');
{
  const table: { hist: string; kind: string; text: string; q?: string }[] = [
    { hist: '后来我对他的看法变了。', kind: 'turning_point', text: '我对他的看法变了' },
    { hist: '后来我们就不怎么联系了。', kind: 'turning_point', text: '我们就不怎么联系了', q: Q_RELATION },
    { hist: '后来我不再去那个地方了。', kind: 'turning_point', text: '我不再去那个地方了' },
    { hist: '后来我们之间变得很疏远。', kind: 'turning_point', text: '我们之间变得很疏远', q: Q_RELATION },
    { hist: '那年夏天，家里就安静了。', kind: 'meaning', text: '家里就安静了', q: Q_UNDERSTANDING },
    { hist: '我一直没跟他说过。', kind: 'open_thread', text: '没跟他说过', q: Q_RELATION },
    { hist: '我们后来就不怎么说话了。', kind: 'turning_point', text: '我们后来就不怎么说话了', q: Q_RELATION },
    { hist: '那年夏天我就不再住在家里了。', kind: 'turning_point', text: '不再住在家里了' },
    { hist: '那是我第一次觉得自己长大了。', kind: 'meaning', text: '觉得自己长大了', q: Q_UNDERSTANDING },
    { hist: '毕业之后我就再也没见过他们。', kind: 'turning_point', text: '再也没见过他们' },
    { hist: '我一直没跟老师说过这件事。', kind: 'open_thread', text: '没跟老师说过', q: Q_RELATION },
    // H2.3.1 契约变化：clue 文本若已含「之后」等起点证据 → 正确地不 ASK，
    // 因此本行改用「未给起点」的关系材料，仍用于检验 RELATIONSHIP 骨架的自然度。
    { hist: '后来我们就没怎么来往了。', kind: 'open_thread', text: '我们后来就不怎么来往了', q: Q_RELATION },
    { hist: '我到现在也没跟他说过这件事。', kind: 'open_thread', text: '没跟他说过', q: Q_RELATION },
    { hist: '那天之后我就不再去公司了。', kind: 'turning_point', text: '不再去公司了' },
    { hist: '我后来才明白，她其实是为我好。', kind: 'meaning', text: '她其实是为我好', q: Q_UNDERSTANDING },
  ];
  const emitted: { dir: string | null; reply: string; hist: string }[] = [];
  for (const [i, t] of table.entries()) {
    const out = await scenario(t.hist, clue(t.kind, t.text, t.text), { question: t.q });
    const reply = out.result.reply;
    emitted.push({ dir: dirOf(out), reply, hist: t.hist });
    console.log(`  C${String(i + 1).padStart(2, '0')} raw「${t.hist}」→ [${dirOf(out)}] ${reply}`);
    // H2.3.1：已陈述关系变化的 material 会被 Question Progression 拦截（回落非 ASK），
    // 此时只校验「未执行 ASK」；只有真正交付的 ASK 才校验「恰好一个问题 / 以问号结尾」。
    if (isAsk(reply)) {
      expect(`C${i + 1} 恰好一个问题`, (reply.match(/[？?]/g) ?? []).length === 1);
      expect(`C${i + 1} 问题后无追加分析（以问号结尾）`, /[？?]$/.test(reply.trim()));
    } else {
      expect(`C${i + 1} 被 Question Progression 拦截 / 不执行（回落非 ASK）`, !isAsk(reply) && reply.trim().length > 0);
    }
    expect(`C${i + 1} 不含诊断/人格/AI 因果`, !/(是不是因为|你其实|你本质上|说明你|为什么|讨好型|你有点|作为 AI|我注意到)/.test(reply));
  }
  const chUsed = emitted.filter((e) => e.dir === 'CHANGE').length;
  const relUsed = emitted.filter((e) => e.dir === 'RELATIONSHIP').length;
  const undUsed = emitted.filter((e) => e.dir === 'UNDERSTANDING').length;
  console.log(`  分布：CHANGE=${chUsed} RELATIONSHIP=${relUsed} UNDERSTANDING=${undUsed}`);
  expect('C 分布不再被 RELATIONSHIP 独占（CHANGE 亦可达）', chUsed > 0 && relUsed > 0 && undUsed > 0);
  resolved('Direction 分布严重偏向 RELATIONSHIP', `H1 后分布为 CHANGE=${chUsed} / RELATIONSHIP=${relUsed} / UNDERSTANDING=${undUsed}`);
  // P0 回归验证：材料中无他人时不再凭空出现「你们」
  const p0a = await scenario('我一直没想明白，那到底算什么。', clue('open_thread', '那到底算什么', '那到底算什么'));
  const p0b = await scenario('我把那张照片一直留着。', clue('open_thread', '留着那张照片', '留着那张照片'));
  expect('C-P0a 「那到底算什么」不再产出关系 ASK', !isAsk(p0a.result.reply) && dirOf(p0a) === null);
  expect('C-P0b 「我把那张照片一直留着」不再产出关系 ASK', !isAsk(p0b.result.reply) && dirOf(p0b) === null);
  resolved('ASK 凭空引入用户材料中不存在的关系（P0）', 'H1 后 open_thread 无关系证据 → direction=null → 不执行 ASK，绝不 fallback 到 RELATIONSHIP');
  resolved(
    'UNDERSTANDING 模板「你后来发现的那个是什么？」指代不清 / 模板前缀「这件事之后」指代不明',
    'H2.3：模板改为「关于『<用户原话锚点>』，<骨架>」，泛指示代词被用户原话锚点替换（锚点只从 targetClueText 删除式摘取，不改写事实）。',
  );
}

/* ═══════════ Audit D · Question Value ═══════════ */
console.log('\n[Audit D] Question Value');
{
  // H2.1 修复验证：提问器问题语义(CHANGE) 与将执行方向(RELATIONSHIP) 不一致 → 拦截
  const d1 = await scenario('后来我们就不怎么联系了。', clue('turning_point', '我们就不怎么联系了', '后来我们就不怎么联系了。'), {
    question: '你后来想过变化这件事吗？',
  });
  console.log(`  D1 direction=${askOf(d1)?.direction} intent=${askOf(d1)?.questionIntent} allowed=${askOf(d1)?.allowed}\n     reply：${d1.result.reply}`);
  expect('D1 价值证明对象与执行方向不一致 → NO_ASK', askOf(d1)?.allowed === false && askOf(d1)?.aligned === false);
  expect('D1b 不产出任何 ASK', !isAsk(d1.result.reply));
  expect('D1c 拒绝理由指向 alignment', (askOf(d1)?.reason ?? '').includes('alignment'));
  resolved('D1 Question Value 的判定对象 ≠ 实际执行的问题（语义漂移）', 'H2.1：Candidate 保存 questionIntent 并与 direction 对齐校验；Execution 只消费 Candidate 的 direction，漂移一律拦截。');
  // H2.1 新发现：三个固定模板文本自身都过不了 MAINLINE 价值词表
  const cl = clue('turning_point', '我们就不怎么联系了', '后来我们就不怎么联系了。') as never;
  const self = [ASK_CHANGE, ASK_RELATION, ASK_UNDERSTANDING].map(
    (t) => classifyQuestionValue({ question: t, targetClue: '我们就不怎么联系了', clues: [cl] as never, questionerValue: 5 }),
  );
  console.log(`  模板自评价值（H2.2-A 后）：${self.join(' / ')}`);
  expect('D1d 三个模板文本自身现在均能为 HIGH（价值判定认得执行词汇）', self.every((v) => v === 'HIGH'));
  resolved(
    'D1 新发现：Question Value 的价值词表与 Execution 模板词汇不一致',
    'H2.2-A：mainline 判定改用与 Execution 同源的 Question Intent → Value Dimension 映射，' +
      '三句执行模板现在都能被价值判定正确评价（且 HIGH 仍需 strongTarget + story_value≥4 两道独立门槛）。',
  );
}
{
  // H2.2-B 修复验证：用户已经自己说出的意义 → 不再生成 UNDERSTANDING ASK
  const d2 = await scenario('我说过，那对我来说是一种告别。', clue('meaning', '那是一种告别', '我说过，那对我来说是一种告别。'), {
    question: Q_UNDERSTANDING,
  });
  console.log(`  D2 user 已说过：那是一种告别\n     reply：${d2.result.reply}`);
  expect('D2 用户已说出的意义 → NO_ASK', askOf(d2)?.allowed === false && !isAsk(d2.result.reply));
  expect('D2b 拒绝理由指向「已经自己说出」', (askOf(d2)?.reason ?? '').includes('已经自己说出'));
  resolved('D2 用户已经说出的意义，被 ASK 再次要求解释', 'H2.2-B：新增「已表达意义」确定性门（只看 clue.text + clue.evidence），命中即 NO_ASK，回落 WAIT/接住。');
}
{
  const d3 = await turn(PAUSE, {
    clues: [clue('meaning', '那是一种告别', '那是一种告别')],
    Q: [cand('那是一种告别', 5, '这件事对你来说意味着什么？')],
    messages: [
      { role: 'user', text: '我说过，那对我来说是一种告别。' },
      { role: 'assistant', text: '这件事对你来说意味着什么？' },
      { role: 'user', text: '就是对一段时间的告别。' },
      { role: 'assistant', text: '嗯，我记下了。' },
    ],
  });
  console.log(`  D3 reply：${d3.result.reply}`);
  expect('D3 用户已明确解释过该意义 → NO_ASK', askOf(d3)?.allowed === false && !isAsk(d3.result.reply));
  resolved('D3 上一轮 AI 已经问过同类问题，本轮仍会再问', 'H2.2-B/C：已表达意义被拦；同方向 + 同线索 + 无新增材料的重复 ASK 亦被拦（详见 askRedundancyHardening.test.ts）。');
  resolved(
    'H2.2 新发现：固定模板下「有新材料的同方向重问」在表现层无法兑现',
    'H2.3：① 同一 direction + 同一 target 的重问改用「再说回『anchor』」措辞（文本不再逐字重复）；' +
      '② avoidRepeat 对合法 ASK 不再静默降级；③ 并以 askExecution.delivered 作为唯一事实来源。',
  );
}
{
  const d4 = await scenario('我一直没跟他说过。', clue('open_thread', '没跟他说过', '没跟他说过'), { question: Q_RELATION });
  console.log(`  D4 raw「我一直没跟他说过。」\n     ASK：${d4.result.reply}`);
  expect('D4 高价值场景可执行 ASK', isAsk(d4.result.reply));
  expect('D4b Timing Value = HIGH', askOf(d4)?.timingValue === 'HIGH');
  const d5 = await scenario('那天下午三点我在食堂吃饭。', clue('event', '三点在食堂', '三点在食堂'), {
    Q: [cand('三点在食堂', 5, '你几点去的？')],
  });
  expect('D5 事实型目标 → 不执行 ASK', !isAsk(d5.result.reply));
  expect('D5b askCandidate 未 allowed', askOf(d5)?.allowed === false);
  const d6 = await scenario('后来我不再去那个地方了。', clue('turning_point', '我不再去那个地方了', '我不再去那个地方了'), {
    Q: [cand('我不再去那个地方了', 2, '你后来还去过吗？')],
  });
  expect('D6 提问器 value 低 → NO_ASK', askOf(d6)?.allowed === false && !isAsk(d6.result.reply));
  const d7 = await scenario('后来我不再去那个地方了。', clue('turning_point', '我不再去那个地方了', '我不再去那个地方了', 2));
  expect('D7 目标重要度不足 → NO_ASK', askOf(d7)?.allowed === false && !isAsk(d7.result.reply));
  const d8 = await scenario('后来我不再去那个地方了。', clue('turning_point', '我不再去那个地方了', '我不再去那个地方了'), {
    Q: [cand('我不再去那个地方了', 5, '你后来去哪儿了？')],
  });
  expect('D8 事实型问题文本 → NO_ASK', askOf(d8)?.allowed === false && !isAsk(d8.result.reply));
}

/* ═══════════ Audit E · User Control ═══════════ */
console.log('\n[Audit E] User Control');
{
  const samples = [
    await scenario('后来我不再去那个地方了。', clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。')),
    await scenario('后来我们就不怎么联系了。', clue('turning_point', '我们就不怎么联系了', '后来我们就不怎么联系了。'), { question: Q_RELATION }),
    await scenario('那年夏天，家里就安静了。', clue('meaning', '家里就安静了', '家里就安静了'), {
      question: Q_UNDERSTANDING,
    }),
  ];
  for (const [i, s] of samples.entries()) {
    const r = s.result.reply;
    // H2.3.1：E2（已陈述关系变化）会被 Question Progression 拦截 → 回落非 ASK；
    // 其余（CHANGE / UNDERSTANDING）仍交付 ASK，校验 8 类控制权。
    if (isAsk(r)) {
      expect(`E${i + 1}-a 无答案暗示（不是/其实/说明）`, !/(不是|其实|说明)/.test(r));
      expect(`E${i + 1}-b 无心理判断（在意/害怕/缺爱/讨好）`, !/(在意|害怕|缺爱|讨好|孤独|敏感)/.test(r));
      expect(`E${i + 1}-c 无价值判断（重要/珍贵/有意义）`, !/(重要|珍贵|有意义|了不起)/.test(r));
      expect(`E${i + 1}-d 无替用户总结（所以你/也就是说）`, !/(所以你|也就是说|这说明|可见)/.test(r));
      expect(`E${i + 1}-e 只有一个问题、无第二问`, (r.match(/[？?]/g) ?? []).length === 1);
      expect(`E${i + 1}-f 不解释「为什么这么问」`, !/(我这样问|之所以问|想问的是因为)/.test(r));
      expect(`E${i + 1}-g 问题后不追加 AI 分析`, /[？?]$/.test(r.trim()));
      expect(`E${i + 1}-h 无身份说明`, !/(作为 AI|我是一个|我是 AI)/.test(r));
    } else {
      expect(`E${i + 1} 被 Question Progression 拦截 / 回落非 ASK`, !isAsk(r) && r.trim().length > 0);
    }
  }
  resolved(
    'E 审计：模板合规，但「这件事 / 那个」让用户无法确认 AI 指的是哪件事',
    'H2.3：每句 ASK 现在都以「关于『<用户原话锚点>』」开头，用户能直接确认指向哪一处材料；8 类控制权检查仍全部通过。',
  );
}

/* ═══════════ Audit F · Intervention Priority ═══════════ */
console.log('\n[Audit F] Intervention Priority');
{
  const base = { clues: [clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。')], Q: [cand('我不再去那个地方了', 5)] };
  const hist = HIST('后来我不再去那个地方了。');
  const f1 = await turn('帮我整理成故事吧。', { ...base, messages: hist });
  console.log(`  F1 reply=${f1.result.reply}\n     askCandidate.allowed=${askOf(f1)?.allowed} askExecution.allowed=${execOf(f1)?.allowed}`);
  expect('F1 explicit intent（story_request）→ 回复层不 ASK', !isAsk(f1.result.reply));
  if (askOf(f1)?.allowed === true) {
    record('P2', 'F1 决策层不知道 explicit user intent（askCandidate 仍判 allowed）', 'evaluateAskCandidate 只接收 correction / refusal；当前无行为泄漏，但 trace 会误导，且 ASK 分支前移即泄漏。');
  }
  expect('F2 拒绝话题 → 不 ASK', !isAsk((await turn('我不想聊这个了。', { ...base, messages: hist })).result.reply));
  expect('F3 correction → 不 ASK', !isAsk((await turn('不是这样的，我没这么说过。', { ...base, messages: hist })).result.reply));
  expect('F4 active expression → 不 ASK', !isAsk((await turn('反正那天挺乱的，而且那时候我还……', { ...base, messages: hist })).result.reply));
  expect('F5 fresh narrative → 不 ASK', !isAsk((await turn('我们就一起回去了。', { ...base, messages: hist })).result.reply));
  expect('F6 user-owned discovery → 不 ASK', !isAsk((await turn('我突然发现我其实一直在躲着他。', { ...base, messages: hist })).result.reply));
  const t1 = await turn('那天我特别开心，但是一路上都装得很淡定。', { Q: [cand('x', 2, '可以再讲讲吗？')] });
  const f7 = await runTurn({
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: [clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。')] as never[], highValueClues: [],
    messages: HIST('那天我特别开心，但是一路上都装得很淡定。'), userText: PAUSE, focus: t1.focus,
  } as RunTurnInput);
  runTurnCount += 1;
  expect('F7 recent REFLECT → 不 ASK', !isAsk(f7.result.reply) && askOf(f7)?.allowed === false);
  const t2 = await turn('对。', {
    Q: [cand('x', 2, '可以再讲讲吗？')],
    messages: [...HIST('那天我特别开心，但是一路上都装得很淡定。').slice(0, 1), { role: 'assistant', text: t1.result.reply }],
  });
  const f8 = await runTurn({
    topicId: 't', topicLabel: '一段经历', state: 'EXPLORING' as InterviewState, scriptStep: 1,
    memory: { ...createEmptyMemory(), turning_points: [{ before: '以前', after: '后来', trigger: '那天' }] },
    clues: [clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。')] as never[], highValueClues: [],
    messages: [
      { role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' },
      { role: 'assistant', text: t1.result.reply },
      { role: 'user', text: '对。' }, { role: 'assistant', text: t2.result.reply },
    ],
    userText: PAUSE, focus: t2.focus,
  } as RunTurnInput);
  runTurnCount += 1;
  expect('F8 recent GENTLE_PUSH → 不 ASK', !isAsk(f8.result.reply) && askOf(f8)?.allowed === false);
  expect('F9 高情绪 → 不 ASK', !isAsk((await turn(PAUSE, {
    ...base, messages: hist,
    U: und({ signals: { wantsToStop: false, sensitive: false, confused: false, offTopic: false, uncertainFact: false, emotionalIntensity: 0.9 } }),
  })).result.reply));
  record('P3', 'F 审计：优先级链全部成立，但 ASK 排在 readinessReply / switchEntry / rhythmHold / abstractOnly 之后', '高价值 ASK 在这些状态下会被通用问句静默吞掉、不可观察。');
}

/* ═══════════ Audit G · State Tracking ═══════════ */
console.log('\n[Audit G] State Tracking');
{
  const t1 = await scenario('后来我不再去那个地方了。', clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。'));
  const trace = t1.result.observer.decisionTrace;
  console.log(`  G1 trace.askExecution=${JSON.stringify(trace?.askExecution)}`);
  expect('G1 trace.askExecution 与实际回复一致', trace?.askExecution?.text === t1.result.reply && trace?.askExecution?.allowed === true);
  expect('G2 direction 被记录', Boolean(trace?.askExecution?.direction));
  expect('G3 reason 被记录', Boolean(trace?.askExecution?.reason));
  expect('G4 lastIntervention 记为 ASK_CANDIDATE（不是 REFLECT）', t1.focus.lastIntervention?.candidate === 'ASK_CANDIDATE');
  expect('G5 不是 GENTLE_PUSH（gentlePush 未 allowed）', trace?.gentlePush?.allowed !== true);
  expect('G6 未新增 ASK Reception 字段', !Object.prototype.hasOwnProperty.call(t1.focus, 'askReception'));
  expect('G7 reflectionReception 未把 ASK 当成 REFLECT', t1.focus.reflectionReception === 'NONE');
  const t2 = await turn('嗯。', {
    clues: [clue('turning_point', '我不再去那个地方了', '后来我不再去那个地方了。')], Q: [cand('我不再去那个地方了', 5)],
    messages: [{ role: 'user', text: PAUSE }, { role: 'assistant', text: t1.result.reply }], focus: t1.focus,
  });
  expect('G8 下一轮不会立即再次 ASK', askOf(t2)?.allowed === false && !isAsk(t2.result.reply));
  record(
    'P2',
    'G 审计：ASK 的跨轮状态已补（H2.2-C），但「用户如何回应」仍未接入回复链',
    'lastIntervention 现已记录 direction / targetClueText / questionIntent，并单独计算 ASK 专属 reception 用于同方向去重；' +
      '但按 B.1 约定，ASK Reception 仍不产生任何用户可见行为（收灯 / 交还控制权等留待 B.2）。',
  );
}

/* ═══════════ Audit H · 三个结构张力 ═══════════ */
console.log('\n[Audit H] 已知结构张力');
{
  const h1 = await turn('后来我才发现，我不是讨厌老师，我是讨厌他当众说我。', {
    clues: [clue('meaning', '我是讨厌他当众说我', '我是讨厌他当众说我')],
    Q: [cand('我是讨厌他当众说我', 5, '这对你来说意味着什么？')],
  });
  expect('H1 SELF_REALIZATION → 不执行 ASK（设计行为）', !isAsk(h1.result.reply) && askOf(h1)?.allowed === false);
  expect('H2 trace 明确记录 userOwnedDiscovery / 被拦原因', (h1.result.observer.decisionTrace?.userOwnedDiscovery ?? false) === true && Boolean(askOf(h1)?.reason));
  expect('H3 person clue → 不允许 ASK（时序拒绝）', askOf(await scenario('我妈当时什么都没说。', clue('person', '我妈什么都没说', '我妈当时什么都没说')))?.allowed === false);
  expect('H4 person clue 不产生方向', classifyAskDirection({ kind: 'person', text: '我妈', evidence: '我妈' }) === null);
  const h5 = await turn('我后来才明白，我一直很在意她的看法。', {
    clues: [clue('meaning', '一直很在意她的看法', '一直很在意她的看法')],
    Q: [cand('一直很在意她的看法', 5, '这对你来说意味着什么？')],
  });
  expect('H5 用户已完成 self-discovery → 不抢发现（不 ASK）', !isAsk(h5.result.reply) && askOf(h5)?.allowed === false);
  expect('H6 UNDERSTANDING 只在非 user-owned 的 meaning 场景生效', classifyAskDirection({ kind: 'meaning', text: '那是一种告别' }) === 'UNDERSTANDING');
  record('P2', 'H 审计：三个结构张力都按设计生效，但边界比产品直觉更窄', '只要出现「后来才发现 / 我其实」，ASK 通道整体关闭 → UNDERSTANDING 方向在真实语料中较难触发。');
}

/* ═══════════ 汇总 ═══════════ */
console.log('\n================ Audit 汇总 ================');
console.log(`Audit assertions：${assertions}`);
console.log(`failures：${failed}`);
console.log(`real runTurn scenarios：${runTurnCount}`);
console.log(`已由 H1 修复：${resolvedList.length}`);
for (const r of resolvedList) console.log(`  ✓ ${r}`);
const byLevel = (l: string) => findings.filter((f) => f.level === l);
for (const l of ['P0', 'P1', 'P2', 'P3']) {
  console.log(`\n${l}（${byLevel(l).length}）`);
  for (const f of byLevel(l)) console.log(`  - ${f.title}`);
}
if (failed > 0) {
  console.log(`\n✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('\n✓ Audit 执行完成（断言全部通过；剩余产品语义风险见上方 ⚠ 记录）。');
