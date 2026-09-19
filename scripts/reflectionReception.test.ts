/**
 * Phase 3.2.2 · Reflection Reception（接住 / 不接住判断）。
 *
 * 全部走真实 runTurn（受控 LLM stub）：验证「REFLECT → 用户回应 → 下一步回复」。
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/reflectionReception.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState } from '../src/types/interview';
import { classifyReflectionReception } from '../src/services/interventionDecision';
import type { LastInterventionState, UserResponseToIntervention } from '../src/types/intervention';

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

function defaultUnderstanding(): Record<string, unknown> {
  return {
    newClues: [{ kind: 'event', text: '那天的事', importance: 4, userInitiated: true, evidence: '那天' }],
    signals: {
      wantsToStop: false,
      sensitive: false,
      confused: false,
      offTopic: false,
      uncertainFact: false,
      emotionalIntensity: 0.3,
    },
    memoryPatch: null,
    completeness: 0.4,
    focus: '那天',
    intent: 'ANSWER_STORY',
  };
}
let understandingRaw: Record<string, unknown> = defaultUnderstanding();

const QUESTION_CANDIDATE = {
  ack: '嗯，我听到了。',
  question: '可以再讲讲吗？',
  ask: false,
  target_clue: 'x',
  story_value: 2,
  user_initiative: 2,
  emotional_signal: 2,
  information_gain: 2,
  willingness: 3,
  disturbance_cost: 2,
  sensitivity_risk: 1,
};

(globalThis as { fetch: unknown }).fetch = (async (_url: unknown, init: { body?: string }) => {
  let content = '{}';
  try {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content?: string }[] };
    const last = String(body?.messages?.[body.messages.length - 1]?.content ?? '');
    if (last.includes('只输出一个 JSON 对象')) content = JSON.stringify(understandingRaw);
    else if (last.includes('候选回应的 JSON 数组')) content = JSON.stringify([QUESTION_CANDIDATE]);
    else content = JSON.stringify({ ack: '嗯。', question: '', ask: false, reply: '嗯。' });
  } catch {
    /* ignore */
  }
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}) as unknown as typeof fetch;

/* ==================== 驱动 ==================== */
async function turn(
  userText: string,
  options: { focus?: ConversationFocus; messages?: { role: 'user' | 'assistant'; text: string }[] } = {},
): Promise<RunTurnOutput> {
  understandingRaw = defaultUnderstanding();
  const input: RunTurnInput = {
    topicId: 'topic_reception_test',
    topicLabel: '一段经历',
    state: 'EXPLORING' as InterviewState,
    scriptStep: 1,
    memory: createEmptyMemory(),
    clues: [],
    highValueClues: [],
    messages: options.messages ?? [],
    userText,
    focus: options.focus,
  };
  return runTurn(input);
}

const REFLECT_MARKERS = ['放在一起', '提到了', '这个变化我注意到了', '这个顺序我注意到了'];
const HANDOFF = '你接着讲';
/** Phase 3.2.3：接住后可能得到 GENTLE PUSH（轻轻交还） */
const GENTLE_PUSH_MARKER = '刚才那个地方';
const STOP_TEXT = '不打扰你';
const ACK_TEXT = '我记下了';
const CONTRAST_USER = '那天我特别开心，但是一路上都装得很淡定。';

/** 先制造一次真实 REFLECT，再返回它的 focus 与消息，用于第二轮 */
async function startWithReflect(): Promise<{
  a1: string;
  focus: ConversationFocus;
  messages: { role: 'user' | 'assistant'; text: string }[];
}> {
  const t = await turn(CONTRAST_USER);
  const a1 = t.result.reply;
  return {
    a1,
    focus: t.focus,
    messages: [
      { role: 'user', text: CONTRAST_USER },
      { role: 'assistant', text: a1 },
    ],
  };
}
function receptionOf(out: RunTurnOutput): UserResponseToIntervention | undefined {
  return out.result.observer.decisionTrace?.reflectionReception;
}
const FORBIDDEN = ['这说明你', '看来你', '你就是', '其实你是', '你本质上', '你有点', '你比较', '讨好型', '你害怕', '你缺爱'];
function cleanOfExplanation(reply: string): boolean {
  return !FORBIDDEN.some((f) => reply.includes(f));
}

console.log('\n================ Phase 3.2.2 · Reflection Reception ================\n');

/* ==================== 一、CASE 1-7 ==================== */
console.log('\n[一] 七种用户回应（真实 runTurn）');

/* CASE 1：接住并展开 → WAIT */
{
  const base = await startWithReflect();
  const out = await turn('对，因为我其实特别怕别人看出来……', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 1（接住并展开）===\n  AI：${base.a1}\n  用户：对，因为我其实特别怕别人看出来……\n  AI：${reply}`);
  expect('C1 识别为 PICKED_UP', receptionOf(out) === 'PICKED_UP');
  expect('C1 WAIT（交回控制权）', reply.includes(HANDOFF));
  expect('C1 不再 REFLECT / 不 ASK', !REFLECT_MARKERS.some((m) => reply.includes(m)) && !/[？?]/.test(reply));
  expect('C1 不心理解释', cleanOfExplanation(reply));
}
/* CASE 2：接住但不展开 → ACK/WAIT */
{
  const base = await startWithReflect();
  const out = await turn('对。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 2（接住但不展开）===\n  AI：${reply}`);
  expect('C2 识别为 PICKED_UP_NOT_EXPANDED', receptionOf(out) === 'PICKED_UP_NOT_EXPANDED');
  expect('C2 接住 → 交还（WAIT / GENTLE PUSH，不 ASK）', (reply.includes(HANDOFF) || reply.includes(GENTLE_PUSH_MARKER)) && !/[？?]/.test(reply));
}
/* CASE 3：不接住 → STOP */
{
  const base = await startWithReflect();
  const out = await turn('嗯。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 3（不接住）===\n  AI：${reply}`);
  expect('C3 识别为 NOT_PICKED_UP', receptionOf(out) === 'NOT_PICKED_UP');
  expect('C3 收灯（不连问）', reply.includes(STOP_TEXT) && !/[？?]/.test(reply));
  expect('C3 不再 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* CASE 4：拒绝 → Correction Recovery */
{
  const base = await startWithReflect();
  const out = await turn('不是这样的。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 4（拒绝）===\n  AI：${reply}`);
  expect('C4 识别为 REJECTED', receptionOf(out) === 'REJECTED');
  expect('C4 进入 Correction Recovery', reply.includes('理解错'));
  expect('C4 不为 REFLECT 辩护 / 不解释为什么', !reply.includes('有意思') && !reply.includes('因为'));
}
/* CASE 5：继续讲原故事 → WAIT */
{
  const base = await startWithReflect();
  const out = await turn('后来我们就一起回去了。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 5（继续讲原故事）===\n  AI：${reply}`);
  expect('C5 识别为 CONTINUED', receptionOf(out) === 'CONTINUED');
  expect('C5 WAIT（不强迫回应 REFLECT）', reply.includes(HANDOFF));
  expect('C5 不再 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* CASE 6：用户自己形成发现 → 最高保护 */
{
  const base = await startWithReflect();
  const out = await turn('对……我突然发现，我好像很多时候都是这样。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 6（用户自己发现）===\n  AI：${reply}`);
  expect('C6 识别为 USER_OWNED_DISCOVERY', receptionOf(out) === 'USER_OWNED_DISCOVERY');
  expect('C6 只确认（不重新解释）', reply.includes(ACK_TEXT));
  expect('C6 不出现「你就是 / 看来你 / 这说明你」', cleanOfExplanation(reply));
  expect('C6 不 ASK', !/[？?]/.test(reply));
}
/* CASE 7：显式要求继续看 → AUTHORIZED_DISCOVERY（仍不做心理诊断） */
{
  const base = await startWithReflect();
  const out = await turn('你刚才说的这个，我还挺想知道的。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 7（显式要求继续看）===\n  AI：${reply}`);
  expect('C7 识别为 EXPLICIT_USER_DISCOVERY', receptionOf(out) === 'EXPLICIT_USER_DISCOVERY');
  expect('C7 不出现人格 / 心理诊断', cleanOfExplanation(reply));
  expect('C7 不 ASK', !/[？?]/.test(reply));
}

/* ==================== 二、CASE 8-20 ==================== */
console.log('\n[二] 优先级与边界');

/* CASE 8：active + userOwned（新优先级：WAIT，不 ACK） */
{
  const text = '后来我才发现我其实一直很在意她怎么看我，而且那时候我还……';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  === CASE 8（active + userOwned）===\n  用户：${text}\n  AI：${reply}`);
  expect('C8 候选 WAIT（active 优先于 userOwned）', out.result.observer.decisionTrace?.interventionCandidate === 'WAIT');
  expect('C8 不 ACK（不抢解释权）', !reply.includes(ACK_TEXT));
  expect('C8 不 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* CASE 9：active + picked up（接住后仍在表达）→ WAIT */
{
  const base = await startWithReflect();
  const out = await turn('对，因为我其实特别怕别人看出来，而且那时候我还……', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 9（active + picked up）===\n  AI：${reply}`);
  expect('C9 识别为 PICKED_UP', receptionOf(out) === 'PICKED_UP');
  expect('C9 WAIT', reply.includes(HANDOFF));
  expect('C9 不再次 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* CASE 10：previous reflect +「嗯」→ 记录 NOT_PICKED_UP 到 focus */
{
  const base = await startWithReflect();
  const out = await turn('嗯。', { focus: base.focus, messages: base.messages });
  expect('C10 focus.reflectionReception 记录为 NOT_PICKED_UP', out.focus.reflectionReception === 'NOT_PICKED_UP');
}
/* CASE 11：previous reflect +「对」→ PICKED_UP_NOT_EXPANDED */
{
  const base = await startWithReflect();
  const out = await turn('对。', { focus: base.focus, messages: base.messages });
  expect('C11 focus 记录 PICKED_UP_NOT_EXPANDED', out.focus.reflectionReception === 'PICKED_UP_NOT_EXPANDED');
}
/* CASE 12：previous reflect +「因为……」→ SELF_EXPANDED */
{
  const base = await startWithReflect();
  const out = await turn('因为那时候我其实特别怕别人看出来。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 12（只展开）===\n  AI：${reply}`);
  expect('C12 识别为 SELF_EXPANDED', receptionOf(out) === 'SELF_EXPANDED');
  expect('C12 WAIT', reply.includes(HANDOFF));
}
/* CASE 13：previous reflect + 新故事 → CONTINUED */
{
  const base = await startWithReflect();
  const out = await turn('我们就一起回去了，一路上谁都没说话。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 13（新故事）===\n  AI：${reply}`);
  expect('C13 识别为 CONTINUED', receptionOf(out) === 'CONTINUED');
  expect('C13 WAIT，不强迫回应 REFLECT', reply.includes(HANDOFF) && !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* CASE 14：previous reflect + correction（不辩护、不重解释） */
{
  const base = await startWithReflect();
  const out = await turn('你说的不对，我不是这个意思。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 14（纠正）===\n  AI：${reply}`);
  expect('C14 进入 Correction Recovery', reply.includes('理解错') || reply.includes('偏'));
  expect('C14 不重新解释自己为什么那样说', !reply.includes('因为') && !reply.includes('有意思'));
}
/* CASE 15：repeated reflection（不连续两轮 REFLECT） */
{
  const base = await startWithReflect();
  const out = await turn(CONTRAST_USER, { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 15（同一 discovery 再来一次）===\n  AI：${reply}`);
  expect('C15 不连续重复 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
  expect('C15 不 ASK', !/[？?]/.test(reply));
}
/* CASE 16：reflection + 用户换话题 */
{
  const base = await startWithReflect();
  const out = await turn('对了，我想说另外一件事，我小时候养过一只猫。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 16（换话题）===\n  AI：${reply}`);
  expect('C16 WAIT，不插入新 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)) && reply.includes(HANDOFF));
}
/* CASE 17：reflection + 用户要求整理故事（显式意图优先） */
{
  const base = await startWithReflect();
  const out = await turn('好，那你现在帮我整理成故事吧。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 17（要求整理）===\n  AI：${reply}`);
  expect('C17 显式意图优先 → 整理 / 生成，不被收尾吞掉', reply.includes('整理') || reply.includes('故事'));
  expect('C17 不是收尾话术', !reply.includes(HANDOFF) && !reply.includes(STOP_TEXT));
}
/* CASE 18：reflection + session end */
{
  const base = await startWithReflect();
  const out = await turn('今天就聊到这儿。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 18（结束整场）===\n  AI：${reply}`);
  expect('C18 结束整场优先', reply.includes('停在这儿'));
}
/* CASE 19：reflection + 情绪升级 → 不 ASK、不 REFLECT */
{
  const base = await startWithReflect();
  const out = await turn('我真的很崩溃，我现在特别难受。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 19（情绪升级）===\n  AI：${reply}`);
  expect('C19 不 ASK / 不 REFLECT（降级）', !/[？?]/.test(reply) && !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* CASE 20：含糊短回应 → AMBIGUOUS → 保守降级 */
{
  const base = await startWithReflect();
  const out = await turn('可能吧。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  === CASE 20（含糊）===\n  AI：${reply}`);
  expect('C20 识别为 AMBIGUOUS', receptionOf(out) === 'AMBIGUOUS');
  expect('C20 保守降级（不 ASK / 不 REFLECT）', reply.includes(STOP_TEXT) && !/[？?]/.test(reply));
}

/* ==================== 三、分类器单元校验 ==================== */
console.log('\n[三] 分类器单元校验');
{
  const prev: LastInterventionState = { candidate: 'REFLECT_CANDIDATE', discoveryType: 'CONTRAST', turn: 1 };
  const cases: { text: string; want: UserResponseToIntervention; why: string }[] = [
    { text: '嗯。', want: 'NOT_PICKED_UP', why: '纯最小回应' },
    { text: '对。', want: 'PICKED_UP_NOT_EXPANDED', why: '承认但不展开' },
    { text: '对，因为我在意。', want: 'PICKED_UP', why: '承认并展开' },
    { text: '因为那时候我其实很怕。', want: 'SELF_EXPANDED', why: '只展开无承认' },
    { text: '后来我们就一起回去了。', want: 'CONTINUED', why: '继续讲原故事' },
    { text: '我突然发现，我好像一直这样。', want: 'USER_OWNED_DISCOVERY', why: '用户自己发现' },
    { text: '你刚才说的这个，我还挺想知道的。', want: 'EXPLICIT_USER_DISCOVERY', why: '显式要求继续看' },
    { text: '不是这样的。', want: 'REJECTED', why: '明确否定' },
    { text: '可能吧。', want: 'AMBIGUOUS', why: '无法确定' },
  ];
  for (const c of cases) {
    const got = classifyReflectionReception(prev, c.text);
    expect(`分类器「${c.text}」→ ${c.want}（${c.why}）`, got === c.want, `实际=${got}`);
  }
  expect('分类器：无上一轮干预 → NONE', classifyReflectionReception(null, '对。') === 'NONE');
  expect('分类器：「嗯」不因长度被唯一决定（承认词优先）', classifyReflectionReception(prev, '嗯，对。') === 'PICKED_UP_NOT_EXPANDED');
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.2 Reflection Reception 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
