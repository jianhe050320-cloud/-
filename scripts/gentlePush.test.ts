/**
 * Phase 3.2.3 · GENTLE PUSH（轻轻把注意力交还给用户）。
 *
 * 全部走真实 runTurn（受控 LLM stub）+ 决策层单元校验。
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/gentlePush.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState } from '../src/types/interview';
import { evaluateGentlePush } from '../src/services/interventionDecision';

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

function defaultUnderstanding(extra: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...extra,
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
  options: {
    focus?: ConversationFocus;
    messages?: { role: 'user' | 'assistant'; text: string }[];
    understanding?: Record<string, unknown>;
  } = {},
): Promise<RunTurnOutput> {
  understandingRaw = options.understanding ?? defaultUnderstanding();
  const input: RunTurnInput = {
    topicId: 'topic_gentle_test',
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

const PUSH_MARKER = '刚才那个地方';
const HANDOFF = '你接着讲';
const STOP_TEXT = '不打扰你';
const ACK_TEXT = '我记下了';
const CONTRAST_USER = '那天我特别开心，但是一路上都装得很淡定。';
const REFLECT_MARKERS = ['放在一起', '提到了', '这个变化我注意到了', '这个顺序我注意到了'];
/** GENTLE PUSH 语言红线 */
const FORBIDDEN = [
  '为什么', '是不是', '你觉得', '你认为', '你当时是什么感受', '能不能说说', '能不能讲讲',
  '愿不愿意', '说明你', '看来你', '你其实', '你是一个', '你本质上', '这反映出你', '因为', '所以',
];
function cleanPush(reply: string): { ok: boolean; why: string } {
  if (/[？?]/.test(reply)) return { ok: false, why: '出现问号' };
  for (const w of FORBIDDEN) if (reply.includes(w)) return { ok: false, why: `出现红线词「${w}」` };
  return { ok: true, why: '' };
}

async function startWithReflect(): Promise<{
  a1: string;
  focus: ConversationFocus;
  messages: { role: 'user' | 'assistant'; text: string }[];
}> {
  const t = await turn(CONTRAST_USER);
  return {
    a1: t.result.reply,
    focus: t.focus,
    messages: [
      { role: 'user', text: CONTRAST_USER },
      { role: 'assistant', text: t.result.reply },
    ],
  };
}
const gentleOf = (out: RunTurnOutput) => out.result.observer.decisionTrace?.gentlePush;

console.log('\n================ Phase 3.2.3 · GENTLE PUSH ================\n');

/* ==================== 一、允许推动 ==================== */
console.log('\n[一] 可以 GENTLE PUSH（建立在上一轮 REFLECT 之上）');

/* 1. PICKED_UP → GENTLE_PUSH */
{
  const base = await startWithReflect();
  const out = await turn('对，因为我其实很在意。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：对，因为我其实很在意。\n  AI：${reply}`);
  expect('#1 PICKED_UP → GENTLE PUSH', reply.includes(PUSH_MARKER) && gentleOf(out)?.allowed === true);
  expect('#1 GENTLE PUSH 无问号、无红线', cleanPush(reply).ok, cleanPush(reply).why);
  expect('#1 不再是旧收尾话术（拿到的是轻推）', reply.includes(PUSH_MARKER));
}
/* 2. PICKED_UP_NOT_EXPANDED → GENTLE_PUSH */
{
  const base = await startWithReflect();
  const out = await turn('对。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：对。\n  AI：${reply}`);
  expect('#2 PICKED_UP_NOT_EXPANDED → GENTLE PUSH', out.result.observer.decisionTrace?.reflectionReception === 'PICKED_UP_NOT_EXPANDED');
  expect('#2 轻推且无问号', reply.includes(PUSH_MARKER) && cleanPush(reply).ok, cleanPush(reply).why);
}
/* 3. CASE D：对观察表示兴趣（无主动表达）→ GENTLE_PUSH */
{
  const base = await startWithReflect();
  const out = await turn('这个还挺有意思的。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：这个还挺有意思的。\n  AI：${reply}`);
  expect('#3 兴趣也算接住 → GENTLE PUSH', reply.includes(PUSH_MARKER));
  expect('#3 不解释用户', cleanPush(reply).ok, cleanPush(reply).why);
}

/* ==================== 二、不得推动 ==================== */
console.log('\n[二] 不得 GENTLE PUSH');

/* 4. NOT_PICKED_UP → 收灯 */
{
  const base = await startWithReflect();
  const out = await turn('嗯。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：嗯。\n  AI：${reply}`);
  expect('#4 NOT_PICKED_UP → 收灯，不 PUSH', reply.includes(STOP_TEXT) && !reply.includes(PUSH_MARKER));
  expect('#4 gentlePush.allowed=false', gentleOf(out)?.allowed === false);
}
/* 5. AMBIGUOUS → 不 PUSH */
{
  const base = await startWithReflect();
  const out = await turn('可能吧。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：可能吧。\n  AI：${reply}`);
  expect('#5 AMBIGUOUS → 不 PUSH', !reply.includes(PUSH_MARKER) && reply.includes(STOP_TEXT));
}
/* 6. SELF_EXPANDED → WAIT */
{
  const base = await startWithReflect();
  const out = await turn('因为那时候我其实很怕。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：因为那时候我其实很怕。\n  AI：${reply}`);
  expect('#6 SELF_EXPANDED → WAIT，不 PUSH', reply.includes(HANDOFF) && !reply.includes(PUSH_MARKER));
}
/* 7. CONTINUED → WAIT */
{
  const base = await startWithReflect();
  const out = await turn('后来我们就一起回去了。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：后来我们就一起回去了。\n  AI：${reply}`);
  expect('#7 CONTINUED → WAIT，不 PUSH', reply.includes(HANDOFF) && !reply.includes(PUSH_MARKER));
}
/* 8. USER_OWNED_DISCOVERY → ACK，不 PUSH */
{
  const base = await startWithReflect();
  const out = await turn('对……我突然发现，我好像每次都这样。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：对……我突然发现，我好像每次都这样。\n  AI：${reply}`);
  expect('#8 USER_OWNED → 只确认，不 PUSH', reply.includes(ACK_TEXT) && !reply.includes(PUSH_MARKER));
}
/* 9. EXPLICIT_USER_DISCOVERY → 不替用户解释 */
{
  const base = await startWithReflect();
  const out = await turn('你刚才说的这个，我还挺想知道的。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：你刚才说的这个，我还挺想知道的。\n  AI：${reply}`);
  expect('#9 EXPLICIT_USER_DISCOVERY 不替用户解释', cleanPush(reply).ok, cleanPush(reply).why);
  expect('#9 不 ASK', !/[？?]/.test(reply));
}
/* 10. REJECTED → Correction Recovery */
{
  const base = await startWithReflect();
  const out = await turn('不是这样的。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：不是这样的。\n  AI：${reply}`);
  expect('#10 REJECTED → Correction Recovery，不 PUSH', reply.includes('理解错') && !reply.includes(PUSH_MARKER));
}
/* 11. activeExpression → WAIT（即使 reception = PICKED_UP） */
{
  const base = await startWithReflect();
  const out = await turn('对，因为我其实很在意，而且那时候我还……', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  用户：对，因为我其实很在意，而且那时候我还……\n  AI：${reply}`);
  expect('#11 接住但用户仍在连续表达 → WAIT', reply.includes(HANDOFF) && !reply.includes(PUSH_MARKER));
  expect('#11 gentlePush.allowed=false（active 优先）', gentleOf(out)?.allowed === false);
}

/* ==================== 三、优先级 ==================== */
console.log('\n[三] 优先级');

/* 12. 显式意图优先：要求整理 */
{
  const base = await startWithReflect();
  const out = await turn('好，那你现在帮我整理成故事吧。', { focus: base.focus, messages: base.messages });
  const reply = out.result.reply;
  console.log(`  AI：${reply}`);
  expect('#12 要求整理 → 不走 GENTLE PUSH', !reply.includes(PUSH_MARKER) && (reply.includes('整理') || reply.includes('故事')));
}
/* 13. session end */
{
  const base = await startWithReflect();
  const out = await turn('今天就聊到这儿。', { focus: base.focus, messages: base.messages });
  expect('#13 session end 优先，不 PUSH', out.result.reply.includes('停在这儿') && !out.result.reply.includes(PUSH_MARKER));
}
/* 14. refusal */
{
  const base = await startWithReflect();
  const out = await turn('这个先不说了。', { focus: base.focus, messages: base.messages });
  expect('#14 refusal 优先，不 PUSH', out.result.reply.includes('先不追问') && !out.result.reply.includes(PUSH_MARKER));
}
/* 15. 没有 previous REFLECT → 不得 PUSH */
{
  const out = await turn('对，因为我其实很在意。');
  const reply = out.result.reply;
  console.log(`  用户（无上一轮 REFLECT）：对，因为我其实很在意。\n  AI：${reply}`);
  expect('#15 没有上一轮 REFLECT → 不 PUSH', !reply.includes(PUSH_MARKER) && gentleOf(out)?.allowed === false);
}
/* 16. previous intervention 不是 REFLECT → 不得 PUSH */
{
  const focus: ConversationFocus = {
    currentTopic: '', currentThread: '', currentEmotion: '', emotionIntensity: 'low',
    currentLifeStage: '', threadBoundary: 'uncertain', recentExploration: [], parkedThreads: [],
    lastIntervention: { candidate: 'WAIT', discoveryType: null, turn: 1 },
  } as ConversationFocus;
  const out = await turn('对，因为我其实很在意。', { focus });
  const reply = out.result.reply;
  console.log(`  AI：${reply}`);
  expect('#16 上一轮不是 REFLECT → 不 PUSH', !reply.includes(PUSH_MARKER) && gentleOf(out)?.allowed === false);
}
/* 17. discovery 重复 → 不得重复推动 */
{
  const base = await startWithReflect();
  const t2 = await turn('对。', { focus: base.focus, messages: base.messages });
  const a2 = t2.result.reply;
  const t3 = await turn('对。', {
    focus: t2.focus,
    messages: [...base.messages, { role: 'user', text: '对。' }, { role: 'assistant', text: a2 }],
  });
  const reply = t3.result.reply;
  console.log(`  第二轮：${a2}\n  第三轮（再说「对」）：${reply}`);
  expect('#17 第一轮已 PUSH', a2.includes(PUSH_MARKER));
  expect('#17 同一 discovery 不再重复推动', !reply.includes(PUSH_MARKER));
}
/* 18. emotion intensity 高 → 不得推动 */
{
  const base = await startWithReflect();
  const out = await turn('对。', {
    focus: base.focus,
    messages: base.messages,
    understanding: defaultUnderstanding({
      signals: {
        wantsToStop: false, sensitive: false, confused: false, offTopic: false,
        uncertainFact: false, emotionalIntensity: 0.9,
      },
    }),
  });
  const reply = out.result.reply;
  console.log(`  AI：${reply}`);
  expect('#18 情绪强度高 → 不 PUSH', !reply.includes(PUSH_MARKER));
  expect('#18 决策理由指向情绪', (gentleOf(out)?.reason ?? '').includes('情绪'));
}

/* ==================== 四、语言红线 ==================== */
console.log('\n[四] GENTLE PUSH 语言红线');
{
  const inputs = ['对。', '对，因为我其实很在意。', '这个还挺有意思的。', '嗯，我懂了。'];
  for (const text of inputs) {
    const base = await startWithReflect();
    const out = await turn(text, { focus: base.focus, messages: base.messages });
    const reply = out.result.reply;
    if (!reply.includes(PUSH_MARKER)) {
      // 未推动时也必须是无问号的安全回复
      expect(`红线「${text}」未推动时也无问号`, !/[？?]/.test(reply));
      continue;
    }
    const clean = cleanPush(reply);
    console.log(`  红线「${text}」→ ${reply}`);
    expect(`红线「${text}」无提问 / 无诊断 / 无人格 / 无因果`, clean.ok, clean.why);
  }
  // 直接校验话术模板
  const d1 = evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: 'PICKED_UP', interruptionCost: 'LOW' });
  const d2 = evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: 'PICKED_UP_NOT_EXPANDED', interruptionCost: 'LOW' });
  expect('模板 1 可用且干净', d1.allowed && cleanPush(d1.text ?? '').ok);
  expect('模板 2 可用且干净', d2.allowed && cleanPush(d2.text ?? '').ok);
}

/* ==================== 五、决策层单元校验 ==================== */
console.log('\n[五] evaluateGentlePush 单元校验');
{
  const ok = evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: 'PICKED_UP', interruptionCost: 'LOW' });
  expect('U1 REFLECT + PICKED_UP + LOW → allowed', ok.allowed === true);

  expect('U2 非 REFLECT 前置 → 拒绝', evaluateGentlePush({ priorCandidate: 'WAIT', reception: 'PICKED_UP', interruptionCost: 'LOW' }).allowed === false);
  expect('U3 无前置（null）→ 拒绝', evaluateGentlePush({ priorCandidate: null, reception: 'PICKED_UP', interruptionCost: 'LOW' }).allowed === false);
  expect('U4 已 PUSH 过 → 不重复', evaluateGentlePush({ priorCandidate: 'GENTLE_PUSH_CANDIDATE', reception: 'PICKED_UP', interruptionCost: 'LOW' }).allowed === false);
  for (const r of ['NOT_PICKED_UP', 'AMBIGUOUS', 'SELF_EXPANDED', 'CONTINUED', 'REJECTED', 'USER_OWNED_DISCOVERY', 'NONE'] as const) {
    expect(`U5 reception=${r} → 拒绝`, evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: r, interruptionCost: 'LOW' }).allowed === false);
  }
  expect('U6 interruptionCost HIGH → 拒绝', evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: 'PICKED_UP', interruptionCost: 'HIGH' }).allowed === false);
  expect('U7 active → 拒绝', evaluateGentlePush({
    priorCandidate: 'REFLECT_CANDIDATE', reception: 'PICKED_UP', interruptionCost: 'LOW',
    activeExpression: { active: true, streak: 1, lastUserExpanded: true, lastNaturalStop: false, confidence: 'HIGH' },
  }).allowed === false);
  expect('U8 情绪高 → 拒绝', evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: 'PICKED_UP', interruptionCost: 'LOW', emotionIntensity: 0.9 }).allowed === false);
  expect('U9 主动性高 → 拒绝', evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: 'PICKED_UP', interruptionCost: 'LOW', userInitiative: 'HIGH' }).allowed === false);
  expect('U10 EXPLICIT_USER_DISCOVERY → 允许', evaluateGentlePush({ priorCandidate: 'REFLECT_CANDIDATE', reception: 'EXPLICIT_USER_DISCOVERY', interruptionCost: 'LOW' }).allowed === true);
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.3 GENTLE PUSH 测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
