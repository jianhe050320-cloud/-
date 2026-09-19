/**
 * Phase 3.2.1 · REFLECT 真实接入测试。
 *
 * 关键：本测试检查的是**真实 runTurn 的最终 reply**，不是「candidate 应该可以」。
 * 做法：把 settings 设为「有 key」让引擎判定为 llm，再 stub globalThis.fetch，
 * 让 LLM1（理解）返回受控 JSON、LLM2（候选）返回一个安静候选。
 * REFLECT 文本本身完全由确定性 builder 生成，不依赖模型。
 *
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/reflectIntegration.test.ts
 */

import { runTurn } from '../src/services/interviewService';
import type { RunTurnInput, RunTurnOutput } from '../src/services/interviewService';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { createEmptyMemory } from '../src/types/interview';
import type { ConversationFocus, InterviewState } from '../src/types/interview';
import {
  detectDiscoverySignals,
  decideIntervention,
  buildReflectReply,
  selectReflectSignal,
  buildReflectText,
} from '../src/services/interventionDecision';
import type { DiscoverySignal, LastInterventionState } from '../src/types/intervention';

let failed = 0;
let observed = 0;
const failures: string[] = [];
function expect(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}
function observe(name: string, cond: boolean, note: string): void {
  observed += 1;
  console.log(`  ⚠ ${name} → ${cond ? '仍存在问题' : '已符合预期'}：${note}`);
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
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}) as unknown as typeof fetch;

/* ==================== runTurn 驱动 ==================== */

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
    topicId: 'topic_reflect_test',
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

/* ==================== 语言红线工具 ==================== */

const FORBIDDEN_IN_REFLECT = [
  '这说明你', '其实你是', '你本质上', '这反映出你', '你属于', '你应该是因为',
  '是不是因为', '我觉得你', '你看起来是一个', '你有点', '你比较', '你害怕', '你缺爱',
  '讨好型', '所以你其实', '看来你', '可见你', '你很懂事', '孤独',
];
/** 抽取所有「…」引用片段 */
function fragments(reply: string): string[] {
  const out: string[] = [];
  const re = /「([^」]*)」/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) out.push(m[1]);
  return out;
}
function isCleanReflect(reply: string, userText: string): { ok: boolean; why: string } {
  if (/[？?]/.test(reply)) return { ok: false, why: '出现问句（REFLECT 不得追问）' };
  for (const bad of FORBIDDEN_IN_REFLECT) {
    if (reply.includes(bad)) return { ok: false, why: `出现红线词「${bad}」` };
  }
  for (const causal of ['因为', '所以', '这说明', '意味着']) {
    if (reply.includes(causal)) return { ok: false, why: `出现因果/解释词「${causal}」` };
  }
  for (const f of fragments(reply)) {
    if (!userText.includes(f)) return { ok: false, why: `引用了用户没说过的话「${f}」` };
  }
  return { ok: true, why: '' };
}

const REFLECT_MARKERS = ['放在一起', '提到了', '这个变化我注意到了', '这个顺序我注意到了'];
/** Phase 3.2.3：接住后可能得到 GENTLE PUSH（轻轻交还），不再是纯收尾 */
const GENTLE_PUSH_MARKER = '刚才那个地方';

console.log('\n================ Phase 3.2.1 · REFLECT 真实接入 ================\n');

/* ==================== 一、REFLECT 正常触发（runTurn 真实 reply） ==================== */
console.log('\n[一] REFLECT 正常触发（真实 reply）');

/* 1. CONTRAST → REFLECT */
{
  const text = '那天我特别开心，但是一路上都装得很淡定。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#1 CONTRAST 真实触发 REFLECT', reply.includes('放在一起'));
  expect('#1 REFLECT 是干净的（无问句/无解释/有据可依）', isCleanReflect(reply, text).ok, isCleanReflect(reply, text).why);
  expect('#1 跨轮状态记录为 REFLECT', out.focus.lastIntervention?.candidate === 'REFLECT_CANDIDATE');
  expect('#1 discoveryType 记录为 CONTRAST', out.focus.lastIntervention?.discoveryType === 'CONTRAST');
}
/* 2. REPETITION → REFLECT（注意避开既有「很普通/很平常」自我贬低规则） */
{
  const text = '我妈妈特别辛苦，真的很辛苦，我一直记着。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#2 REPETITION 真实触发 REFLECT', reply.includes('提到了'));
  expect('#2 REFLECT 干净', isCleanReflect(reply, text).ok, isCleanReflect(reply, text).why);
}
/* 3. BEFORE_AFTER → REFLECT */
{
  const text = '以前我总觉得住平房没什么不好。后来才明白，楼房也有楼房的好处。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#3 BEFORE_AFTER 真实触发 REFLECT', reply.includes('这个变化我注意到了'));
  expect('#3 REFLECT 干净', isCleanReflect(reply, text).ok, isCleanReflect(reply, text).why);
}
/* 4. BEHAVIOR_SEQUENCE → REFLECT */
{
  const text = '我自己其实挺累的，但我还是先给我妈买了药，然后又去接弟弟，最后才回宿舍。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#4 BEHAVIOR_SEQUENCE 真实触发 REFLECT', reply.includes('这个顺序我注意到了'));
  expect('#4 REFLECT 干净（不得转人格）', isCleanReflect(reply, text).ok, isCleanReflect(reply, text).why);
  expect('#4 不出现「懂事 / 讨好」', !reply.includes('懂事') && !reply.includes('讨好'));
}

/* ==================== 二、不应该 REFLECT ==================== */
console.log('\n[二] 不应该 REFLECT');

/* 5. active expression → WAIT */
{
  const text = '那天我特别开心，但是一路上都装得很淡定，因为我其实……';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#5 正在连续表达 → 不 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
  expect('#5 是 WAIT 式接住（无新问题）', !reply.includes('为什么') && !reply.includes('是不是因为'));
}
/* 6. userOwned（用户已停止表达）→ ACK/WAIT */
{
  const text = '我突然发现，我其实一直很在意她怎么看我。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#6 user-owned → 不 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
  expect('#6 只确认不确定（无问句）', !/[？?]/.test(reply));
  expect('#6 不重新解释心理', !reply.includes('所以') && !reply.includes('说明'));
}
/* 7. correction → Correction Recovery */
{
  const prevReflect = '你刚才一边说「那天我特别开心」，一边又说「但是一路上都装得很淡定」。这两个地方放在一起，还挺有意思的。';
  const out = await turn('不是这样的。', {
    focus: {
      currentTopic: '', currentThread: '', currentEmotion: '', emotionIntensity: 'low',
      currentLifeStage: '', threadBoundary: 'uncertain', recentExploration: [], parkedThreads: [],
      lastIntervention: { candidate: 'REFLECT_CANDIDATE', discoveryType: 'CONTRAST', turn: 1 },
    } as ConversationFocus,
    messages: [
      { role: 'user', text: '那天我特别开心，但是一路上都装得很淡定。' },
      { role: 'assistant', text: prevReflect },
    ],
  });
  const reply = out.result.reply;
  console.log(`  用户：不是这样的。\n  AI：${reply}`);
  expect('#7 用户否定 → Correction Recovery（承认理解错）', reply.includes('理解错'));
  expect('#7 不为 REFLECT 辩护', !reply.includes('有意思') && !reply.includes('为什么'));
}
/* 8. session end → end */
{
  const out = await turn('今天先到这里吧。');
  console.log(`  AI：${out.result.reply}`);
  expect('#8 session end → 结束语', out.result.reply.includes('停在这儿'));
  expect('#8 不 REFLECT', !REFLECT_MARKERS.some((m) => out.result.reply.includes(m)));
}
/* 9. refusal → REFUSE */
{
  const out = await turn('这个先不说了。');
  console.log(`  AI：${out.result.reply}`);
  expect('#9 refusal → 停止追问', out.result.reply.includes('先不追问'));
  expect('#9 不 REFLECT', !REFLECT_MARKERS.some((m) => out.result.reply.includes(m)));
}
/* 10. no safe evidence → WAIT（builder 级） */
{
  const ungrounded: DiscoverySignal = {
    type: 'CONTRAST', detected: true, confidence: 'HIGH', userOwned: false,
    evidence: ['用户从没说过的话', '另一句也没有'],
  };
  const trace = decideIntervention({
    userText: '完全不同的用户文本。',
    discoverySignals: [ungrounded],
    interruptionCost: 'LOW',
  });
  const r = buildReflectReply(trace, '完全不同的用户文本。');
  expect('#10 证据不落地 → 不硬生成 REFLECT', r === null);
  expect('#10 selectReflectSignal 返回 null', selectReflectSignal([ungrounded], '完全不同的用户文本。') === null);
}
/* 11. SPECIFIC_DETAIL only → 不强行 REFLECT */
{
  const text = '她走的时候没有说再见，只是把门轻轻关上。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#11 只有 SPECIFIC_DETAIL → 不强行 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
  expect('#11 trace 不为 REFLECT_CANDIDATE', out.result.observer.decisionTrace?.interventionCandidate !== 'REFLECT_CANDIDATE');
}
/* 12. RELATIONAL_REALIZATION only → 不强行 REFLECT */
{
  const text = '后来才知道她一直很爱我。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  expect('#12 关系发现 → 不强行 REFLECT', !REFLECT_MARKERS.some((m) => reply.includes(m)));
}

/* ==================== 三、REFLECT 之后 ==================== */
console.log('\n[三] REFLECT 之后（跨轮）');

const d1User = '那天我特别开心，但是一路上都装得很淡定。';
const d1 = await turn(d1User);
const d1Reflect = d1.result.reply;
const d1Messages = [
  { role: 'user' as const, text: d1User },
  { role: 'assistant' as const, text: d1Reflect },
];

/* 13. 用户接住 → WAIT */
{
  const out = await turn('对，是这样。', { focus: d1.focus, messages: d1Messages });
  const reply = out.result.reply;
  console.log(`  用户：对，是这样。\n  AI：${reply}`);
  expect('#13 接住 → 交回控制权（WAIT / GENTLE PUSH）', reply.includes('你接着讲') || reply.includes(GENTLE_PUSH_MARKER));
  expect('#13 不再 REFLECT / 不追问', !REFLECT_MARKERS.some((m) => reply.includes(m)) && !/[？?]/.test(reply));
}
/* 14. 用户自主扩展 → WAIT */
{
  const out = await turn('对，因为我其实特别怕别人看出来。', { focus: d1.focus, messages: d1Messages });
  const reply = out.result.reply;
  console.log(`  用户：对，因为我其实特别怕别人看出来。\n  AI：${reply}`);
  expect('#14 用户自主扩展 → WAIT（交回控制权 / GENTLE PUSH）', reply.includes('你接着讲') || reply.includes(GENTLE_PUSH_MARKER));
  expect('#14 不再分析', !reply.includes('怕') && !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* 15. 用户说「嗯」→ STOP/DEESCALATE */
{
  const out = await turn('嗯。', { focus: d1.focus, messages: d1Messages });
  const reply = out.result.reply;
  console.log(`  用户：嗯。\n  AI：${reply}`);
  expect('#15 没接住 → 收灯（不连问）', reply.includes('不打扰你'));
  expect('#15 不再 REFLECT / 不追问', !REFLECT_MARKERS.some((m) => reply.includes(m)) && !/[？?]/.test(reply));
}
/* 16. 用户否定 → Correction Recovery（已在 #7 覆盖，这里再确认「嗯」与「否定」不同） */
{
  const out = await turn('不是这样的。', { focus: d1.focus, messages: d1Messages });
  console.log(`  AI：${out.result.reply}`);
  expect('#16 否定 → Correction Recovery', out.result.reply.includes('理解错'));
}
/* 17. 用户继续讲 → WAIT（不插入新 REFLECT） */
{
  const out = await turn('然后我一个人走回了宿舍，路上特别安静。', { focus: d1.focus, messages: d1Messages });
  const reply = out.result.reply;
  console.log(`  用户：然后我一个人走回了宿舍，路上特别安静。\n  AI：${reply}`);
  expect('#17 用户继续讲 → WAIT（不插 REFLECT）', !REFLECT_MARKERS.some((m) => reply.includes(m)));
}
/* 18. 同一个 discovery 不连续重复 REFLECT（builder 级） */
{
  const text = '那天我特别开心，但是一路上都装得很淡定。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = decideIntervention({ userText: text, discoverySignals: signals, interruptionCost: 'LOW' });
  const prev: LastInterventionState = { candidate: 'REFLECT_CANDIDATE', discoveryType: 'CONTRAST', turn: 1 };
  const r = buildReflectReply(trace, text, { priorIntervention: prev });
  expect('#18 同一 discovery 连续两轮 → 不再 REFLECT', r === null);
}
/* 19. 一轮多个 discovery → 只 REFLECT 一个 */
{
  const text = '那天我特别开心，但是一路上都装得很淡定。后来我心里挺累的，但我还是先给我妈买了药，最后才回宿舍。';
  const out = await turn(text);
  const reply = out.result.reply;
  console.log(`  用户：${text}\n  AI：${reply}`);
  const quoteCount = fragments(reply).length;
  expect('#19 只 REFLECT 一个发现', quoteCount === 2 && REFLECT_MARKERS.filter((m) => reply.includes(m)).length === 1);
  expect('#19 只选一个（CONTRAST 优先于行为顺序）', reply.includes('放在一起'));
}
/* 20. REFLECT 不产生任何 ASK */
{
  const text = '那天我特别开心，但是一路上都装得很淡定。';
  const out = await turn(text);
  expect('#20 REFLECT 回复不含任何问句', !/[？?]/.test(out.result.reply));
}

/* ==================== 四、语言红线（5） ==================== */
console.log('\n[四] 语言红线');

const redLines: { id: string; text: string; forbid?: string[] }[] = [
  { id: 'LR1', text: '我特别开心，但是一路上都装得很淡定。' },
  { id: 'LR2', text: '我很累，但最后还是先给妈妈买了药，再去接弟弟。', forbid: ['懂事', '讨好', '总是把别人'] },
  { id: 'LR3', text: '我特别开心，但一路上装得很平静，其实我一点都不高兴。' },
  { id: 'LR4', text: '大家在一起拍照，后来我一个人走回宿舍，突然特别安静。', forbid: ['孤独'] },
  { id: 'LR5', text: '我特别开心，但是一路上都装得很淡定，我知道这是因为我不想让别人担心。' },
];
for (const rl of redLines) {
  const out = await turn(rl.text);
  const reply = out.result.reply;
  console.log(`  ${rl.id} 用户：${rl.text}\n  ${rl.id} AI：${reply}`);
  const clean = isCleanReflect(reply, rl.text);
  expect(`${rl.id} 无问句/无解释/引用有据`, clean.ok, clean.why);
  const hitReflect = REFLECT_MARKERS.some((m) => reply.includes(m));
  if (rl.forbid) {
    for (const w of rl.forbid) expect(`${rl.id} 不含「${w}」`, !reply.includes(w));
  }
  observe(`${rl.id} 是否 REFLECT`, false, hitReflect ? '本轮产生了 REFLECT' : '本轮未产生 REFLECT（也是安全行为）');
}

/* ==================== 五、Dialogue 1 / 2 / 3（完整） ==================== */
console.log('\n[五] 三个完整对话');

/* Dialogue 1 */
{
  const u1 = '那天我特别开心，但是一路上都装得很淡定。';
  const t1 = await turn(u1);
  const a1 = t1.result.reply;
  const u2 = '对，因为我其实特别怕别人看出来。';
  const t2 = await turn(u2, { focus: t1.focus, messages: [{ role: 'user', text: u1 }, { role: 'assistant', text: a1 }] });
  const a2 = t2.result.reply;
  console.log(`  === Dialogue 1 ===\n  用户：${u1}\n  AI：${a1}\n  用户：${u2}\n  AI：${a2}`);
  expect('D1 第一轮 REFLECT', a1.includes('放在一起'));
  expect('D1 第二轮 WAIT（不再分析）', (a2.includes('你接着讲') || a2.includes(GENTLE_PUSH_MARKER)) && !REFLECT_MARKERS.some((m) => a2.includes(m)));
}
/* Dialogue 2 */
{
  const u1 = '那天我特别开心，但是一路上都装得很淡定，因为我其实……';
  const t1 = await turn(u1);
  console.log(`  === Dialogue 2 ===\n  用户：${u1}\n  AI：${t1.result.reply}`);
  expect('D2 用户正在表达 → 不 REFLECT', !REFLECT_MARKERS.some((m) => t1.result.reply.includes(m)));
}
/* Dialogue 3 */
{
  const u1 = '那天我特别开心，但是一路上都装得很淡定。';
  const t1 = await turn(u1);
  const a1 = t1.result.reply;
  const t2 = await turn('嗯。', { focus: t1.focus, messages: [{ role: 'user', text: u1 }, { role: 'assistant', text: a1 }] });
  const a2 = t2.result.reply;
  console.log(`  === Dialogue 3 ===\n  用户：${u1}\n  AI：${a1}\n  用户：嗯。\n  AI：${a2}`);
  expect('D3 第一轮 REFLECT', a1.includes('放在一起'));
  expect('D3 用户没接住 → 收灯，不再 REFLECT、不追问', a2.includes('不打扰你') && !REFLECT_MARKERS.some((m) => a2.includes(m)) && !/[？?]/.test(a2));
}

/* ==================== 六、builder 级补充 ==================== */
console.log('\n[六] builder 级补充');
{
  const text = '我特别开心，但一路上都装得很淡定。';
  const signals = detectDiscoverySignals({ userText: text });
  const signal = selectReflectSignal(signals, text);
  expect('B-1 selectReflectSignal 选出 CONTRAST', signal?.type === 'CONTRAST');
  const built = signal ? buildReflectText(signal, text) : null;
  expect('B-2 buildReflectText 产出单句且无问句', Boolean(built) && !/[？?]/.test(built as string));
  const trace = decideIntervention({ userText: text, discoverySignals: signals, interruptionCost: 'LOW' });
  const ok = buildReflectReply(trace, text, { activeExpression: { active: true, streak: 1, lastUserExpanded: true, lastNaturalStop: false, confidence: 'HIGH' } });
  expect('B-3 activeExpression.active → 门控直接阻断', ok === null);
  const blockedHigh = decideIntervention({ userText: text, discoverySignals: signals, interruptionCost: 'HIGH' });
  expect('B-4 interruptionCost HIGH → 门控阻断', buildReflectReply(blockedHigh, text) === null);
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}；已记录观察：${observed}`);
if (failed === 0) {
  console.log('✓ Phase 3.2.1 REFLECT 真实接入测试全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
