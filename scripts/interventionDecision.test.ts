/**
 * Phase 3.1 / 3.1.1 · Discovery Detection + Intervention Decision 确定性回归测试。
 *
 * 不依赖线上模型：Detection 以确定性（正则+结构）为主通道，decideIntervention 是纯函数。
 *
 * 用法（复用工程里已装好的 tsx）：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/interventionDecision.test.ts
 */

import {
  detectDiscoverySignals,
  decideIntervention,
  computeDiscoveryValue,
  computeStructuralDiscoveryValue,
  computeSelfDiscoveryValue,
  runInterventionAnalysis,
  updateActiveExpression,
  refineInterruptionCost,
  resolveUserResponseToIntervention,
  isMinimalResponse,
} from '../src/services/interventionDecision';
import type {
  DiscoverySignal,
  DiscoveryType,
  InterventionCandidate,
  InterventionDecisionTrace,
  ActiveExpressionState,
  LastInterventionState,
  UserResponseToIntervention,
} from '../src/types/intervention';
import type {
  Understanding,
  StoryMemory,
  UserWillingnessState,
  InterruptionCostLevel,
  StoryMaterialLevel,
} from '../src/types/interview';

let failed = 0;
let observed = 0;
function expect(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}
function observe(name: string, cond: boolean, note: string): void {
  observed += 1;
  console.log(`  ⚠ ${name} → ${cond ? '仍存在问题' : '已符合预期'}：${note}`);
}

/* ---------------- 构造工具 ---------------- */

function mkUnderstanding(partial: Partial<Understanding> = {}): Understanding {
  return {
    newClues: [],
    signals: {
      wantsToStop: false,
      sensitive: false,
      confused: false,
      offTopic: false,
      uncertainFact: false,
      emotionalIntensity: 0,
    },
    memoryPatch: null,
    completeness: 0.3,
    focus: '',
    ...partial,
  } as Understanding;
}

function emptyMemory(): StoryMemory {
  return {
    person: { name: '', age: null },
    story_id: '',
    story_title: '',
    story_type: '',
    people: [],
    events: [],
    emotions: [],
    turning_points: [],
    details: [],
    meaning: [],
    user_quotes: [],
    open_threads: [],
    story_status: 'developing',
  } as StoryMemory;
}

function mkUserState(partial: Partial<UserWillingnessState> = {}): UserWillingnessState {
  return {
    expressionWillingness: 'MEDIUM',
    answeringWillingness: 'MEDIUM',
    storyCompletionExpectation: 'LOW',
    initiative: 'MEDIUM',
    ...partial,
  };
}

interface AnalyzeOpts {
  interruptionCost?: InterruptionCostLevel;
  expressionWillingness?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  answeringWillingness?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  initiative?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  storyMaterial?: StoryMaterialLevel;
  hasMeaning?: boolean;
  highValueQuestion?: boolean;
  priorInterventionCandidate?: InterventionCandidate | null;
  userResponseToPrevious?: UserResponseToIntervention;
  activeExpression?: ActiveExpressionState;
}

/** 直接驱动「检测 + 决策」（不经过跨轮修正）——原 15 CASE 用这个 */
function analyze(userText: string, opts: AnalyzeOpts = {}): InterventionDecisionTrace {
  const signals = detectDiscoverySignals({ userText });
  return decideIntervention({
    userText,
    discoverySignals: signals,
    interruptionCost: opts.interruptionCost ?? 'LOW',
    expressionWillingness: opts.expressionWillingness,
    answeringWillingness: opts.answeringWillingness,
    initiative: opts.initiative,
    storyMaterial: opts.storyMaterial,
    hasMeaning: opts.hasMeaning,
    highValueQuestion: opts.highValueQuestion,
    priorInterventionCandidate: opts.priorInterventionCandidate,
    userResponseToPrevious: opts.userResponseToPrevious,
    activeExpression: opts.activeExpression,
  });
}

/** 模拟 runTurn：先更新跨轮 active-expression，再走完整分析（含打断成本修正 + 上一轮回应判定） */
function sim(prevActive: ActiveExpressionState | undefined, userText: string, opts: AnalyzeOpts & { prior?: LastInterventionState | null } = {}) {
  const active = updateActiveExpression(prevActive, {
    userText,
    initiative: opts.initiative,
    expressionWillingness: opts.expressionWillingness,
  });
  const us: Partial<UserWillingnessState> = {};
  if (opts.expressionWillingness) us.expressionWillingness = opts.expressionWillingness;
  if (opts.answeringWillingness) us.answeringWillingness = opts.answeringWillingness;
  if (opts.initiative) us.initiative = opts.initiative;
  const trace = runInterventionAnalysis({
    userText,
    understanding: mkUnderstanding({ userState: mkUserState(us) }),
    memory: emptyMemory(),
    interruptionCost: opts.interruptionCost ?? 'LOW',
    activeExpression: active,
    priorIntervention: opts.prior ?? null,
    highValueQuestion: opts.highValueQuestion,
    storyMaterial: opts.storyMaterial,
    hasMeaning: opts.hasMeaning,
    storyReadinessAction: 'CONTINUE',
  });
  return { active, trace };
}

function hasType(signals: DiscoverySignal[], t: DiscoveryType): boolean {
  return signals.some((s) => s.detected && s.type === t);
}
const detectedCount = (signals: DiscoverySignal[]): number => signals.filter((s) => s.detected).length;

console.log('\n================ Phase 3.1 / 3.1.1 · Discovery + Intervention Decision ================\n');

/* ==================== 一、原 15 CASE（必须全部继续通过） ==================== */
console.log('\n[原 CASE 01-15]');

/* CASE 01 */
{
  const text = '高三冬天，我坐在后座，手冻得通红。后来才知道她其实一直很爱我。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE01 signals=${JSON.stringify(signals.map((s) => s.type))} structural=${trace.structuralDiscoveryValue} self=${trace.selfDiscoveryValue} candidate=${trace.interventionCandidate}`);
  expect('CASE01 没有产生 ASK_CANDIDATE', trace.interventionCandidate !== 'ASK_CANDIDATE');
  expect('CASE01 没有产生 REFLECT_CANDIDATE', trace.interventionCandidate !== 'REFLECT_CANDIDATE');
  expect('CASE01 候选是 WAIT / ACKNOWLEDGE / OFFER 之一', ['WAIT', 'ACKNOWLEDGE', 'OFFER'].includes(trace.interventionCandidate));
}
/* CASE 02 */
{
  const text = '我特别开心，但一路上又装得很淡定。我爸妈特别兴奋，我反而一直说也就这样吧。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE02 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE02 检测到 CONTRAST', hasType(signals, 'CONTRAST'));
  expect('CASE02 structural = HIGH', trace.structuralDiscoveryValue === 'HIGH');
  expect('CASE02 非 user-owned', trace.userOwnedDiscovery === false);
  expect('CASE02 候选 REFLECT_CANDIDATE', trace.interventionCandidate === 'REFLECT_CANDIDATE');
  expect('CASE02 ASK 被拦下', trace.blockedActions.some((b) => b.includes('ASK_CANDIDATE')));
}
/* CASE 03 */
{
  const text = '我也不记得那天具体发生了什么。反正挺普通的。后来想想，好像也就是很普通的一天。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE03 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE03 检测到 REPETITION', hasType(signals, 'REPETITION'));
  expect('CASE03 候选 REFLECT_CANDIDATE（不立即问为什么普通）', trace.interventionCandidate === 'REFLECT_CANDIDATE');
  expect('CASE03 不 ASK', trace.interventionCandidate !== 'ASK_CANDIDATE');
}
/* CASE 04 */
{
  const text = '毕业那天大家都在拍照、拥抱，我也觉得挺开心的。后来我一个人走回宿舍，突然觉得特别安静。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE04 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE04 检测到 CONTRAST', hasType(signals, 'CONTRAST'));
  expect('CASE04 候选 REFLECT_CANDIDATE', trace.interventionCandidate === 'REFLECT_CANDIDATE');
  expect('CASE04 不产出「孤独」式解释', !trace.reasons.join('|').includes('孤独') && !trace.blockedActions.join('|').includes('孤独'));
}
/* CASE 05 */
{
  const text = '那天早上八点多到学校，先去了宿舍，然后拿东西，之后去食堂吃饭，中午又回宿舍，下午去图书馆，晚上和室友出去。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text, { storyMaterial: 'HIGH', hasMeaning: false });
  console.log(`  CASE05 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE05 无明显发现信号', detectedCount(signals) === 0);
  expect('CASE05 候选 GENTLE_PUSH_CANDIDATE', trace.interventionCandidate === 'GENTLE_PUSH_CANDIDATE');
  expect('CASE05 不 ASK（无高价值问题时）', trace.interventionCandidate !== 'ASK_CANDIDATE');
}
/* CASE 06 */
{
  const text = '那天去了很多地方，吃饭、拍照、逛校园。其实我记得最清楚的是他们走以后，我一个人回宿舍。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE06 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE06 检测到 SELF_NAMED_CORE', hasType(signals, 'SELF_NAMED_CORE'));
  expect('CASE06 user-owned', trace.userOwnedDiscovery === true);
  expect('CASE06 候选 ACKNOWLEDGE / WAIT', ['ACKNOWLEDGE', 'WAIT'].includes(trace.interventionCandidate));
  expect('CASE06 不再误判 CONTRAST（收紧后）', !hasType(signals, 'CONTRAST'));
}
/* CASE 07 */
{
  const text = '反正就是这么回事，我也不知道有什么意义。';
  const trace = analyze(text, { answeringWillingness: 'LOW' });
  console.log(`  CASE07 candidate=${trace.interventionCandidate}`);
  expect('CASE07 不 ASK', trace.interventionCandidate !== 'ASK_CANDIDATE');
  expect('CASE07 候选 ACKNOWLEDGE / WAIT', ['ACKNOWLEDGE', 'WAIT'].includes(trace.interventionCandidate));
}
/* CASE 08 */
{
  const text = '对了，我突然想起来，我爸当时还说了一句话。';
  const trace = analyze(text, { interruptionCost: 'HIGH' });
  console.log(`  CASE08 candidate=${trace.interventionCandidate}`);
  expect('CASE08 打断成本 HIGH', trace.interruptionCost === 'HIGH');
  expect('CASE08 候选 WAIT', trace.interventionCandidate === 'WAIT');
  expect('CASE08 REFLECT 被拦', trace.blockedActions.some((b) => b.includes('REFLECT_CANDIDATE')));
}
/* CASE 09 */
{
  const text = '我后来才发现，我其实不是讨厌那个老师，我是讨厌他当众说我。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE09 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE09 检测到 SELF_REALIZATION（user-owned）', hasType(signals, 'SELF_REALIZATION') && trace.userOwnedDiscovery === true);
  expect('CASE09 候选 ACKNOWLEDGE / WAIT', ['ACKNOWLEDGE', 'WAIT'].includes(trace.interventionCandidate));
  expect('CASE09 不重新解释为心理结论', trace.blockedActions.some((b) => b.includes('心理结论')));
  expect('CASE09 不 ASK', trace.interventionCandidate !== 'ASK_CANDIDATE');
}
/* CASE 10 */
{
  const text = '以前我一直觉得我不喜欢大学。后来发现，我真正不喜欢的是那种每天不知道自己在干什么的感觉。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE10 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE10 检测到 BEFORE_AFTER', hasType(signals, 'BEFORE_AFTER'));
  expect('CASE10 user-owned', trace.userOwnedDiscovery === true);
  expect('CASE10 候选 ACKNOWLEDGE / WAIT', ['ACKNOWLEDGE', 'WAIT'].includes(trace.interventionCandidate));
  expect('CASE10 不 ASK', trace.interventionCandidate !== 'ASK_CANDIDATE');
}
/* CASE 11 */
{
  const text = '然后特别兴奋……真的特别兴奋……我跟他们说我一点都不紧张……其实我手一直在抖……';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text, { interruptionCost: 'HIGH', initiative: 'HIGH' });
  console.log(`  CASE11 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE11 检测到 CONTRAST（高价值）', hasType(signals, 'CONTRAST') && trace.structuralDiscoveryValue === 'HIGH');
  expect('CASE11 打断成本 HIGH', trace.interruptionCost === 'HIGH');
  expect('CASE11 候选 WAIT（即使 Discovery HIGH）', trace.interventionCandidate === 'WAIT');
  expect('CASE11 ASK/REFLECT 均被拦', trace.blockedActions.some((b) => b.includes('打断用户')));
}
/* CASE 12 */
{
  const text = '然后特别兴奋……我跟他们说我一点都不紧张……其实我手一直在抖。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text, { interruptionCost: 'LOW' });
  console.log(`  CASE12 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE12 检测到 CONTRAST（高价值）', hasType(signals, 'CONTRAST') && trace.structuralDiscoveryValue === 'HIGH');
  expect('CASE12 候选 REFLECT_CANDIDATE', trace.interventionCandidate === 'REFLECT_CANDIDATE');
}
/* CASE 13 */
{
  const text = '对，因为我特别怕别人发现我其实很在意这件事。';
  const trace = analyze(text, { interruptionCost: 'HIGH', initiative: 'HIGH' });
  console.log(`  CASE13 candidate=${trace.interventionCandidate}`);
  expect('CASE13 打断成本 HIGH → WAIT', trace.interventionCandidate === 'WAIT');
  expect('CASE13 不再次 ASK', trace.interventionCandidate !== 'ASK_CANDIDATE');
}
/* CASE 14 */
{
  const trace = analyze('嗯', { priorInterventionCandidate: 'REFLECT_CANDIDATE', interruptionCost: 'LOW' });
  console.log(`  CASE14 candidate=${trace.interventionCandidate} futureHint=${trace.futureDecisionHint}`);
  expect('CASE14 是最小回应', isMinimalResponse('嗯') === true);
  expect('CASE14 futureDecisionHint = STOP', trace.futureDecisionHint === 'STOP');
  expect('CASE14 候选 WAIT', trace.interventionCandidate === 'WAIT');
  expect('CASE14 记录不得连续追问', trace.blockedActions.some((b) => b.includes('连续追问')));
}
/* CASE 15 */
{
  const text = '我自己其实挺累的，但我还是先给我妈买了药，然后又去接弟弟，最后才回宿舍。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  CASE15 signals=${JSON.stringify(signals.map((s) => s.type))} candidate=${trace.interventionCandidate}`);
  expect('CASE15 检测到 BEHAVIOR_SEQUENCE', hasType(signals, 'BEHAVIOR_SEQUENCE'));
  expect('CASE15 候选 REFLECT_CANDIDATE', trace.interventionCandidate === 'REFLECT_CANDIDATE');
  expect('CASE15 红线：禁止转人格标签', trace.blockedActions.some((b) => b.includes('讨好型人格') || b.includes('很懂事')));
  expect('CASE15 不 ASK', trace.interventionCandidate !== 'ASK_CANDIDATE');
}

/* 原补充 CASE19/20 + 组合冒烟 */
console.log('\n[原补充 CASE19/20 + 组合冒烟]');
{
  const t19 = analyze('你听完这段以后，你觉得这里面有什么我自己可能没注意到的吗？');
  expect('CASE19 显式授权发现', t19.explicitDiscoveryRequest === true);
  const t20 = analyze('听完这个故事，你觉得我是一个什么样的人？');
  expect('CASE20 显式授权发现', t20.explicitDiscoveryRequest === true);
  expect('CASE20 红线：不得给人格定论', t20.blockedActions.some((b) => b.includes('人格定论')));
}
{
  const trace = runInterventionAnalysis({
    userText: '我特别开心，但一路上又装得很淡定。',
    understanding: mkUnderstanding(),
    memory: emptyMemory(),
    interruptionCost: 'LOW',
    storyMaterial: 'MEDIUM',
    storyFocus: 'HIGH',
    hasMeaning: false,
    storyReadinessAction: 'CONTINUE',
  });
  console.log(`  组合 candidate=${trace.interventionCandidate}`);
  expect('组合入口产出 REFLECT_CANDIDATE', trace.interventionCandidate === 'REFLECT_CANDIDATE');
  expect('组合入口写回 storyReadinessAction', trace.storyReadinessAction === 'CONTINUE');
}

/* ==================== 二、A1-A4：跨轮 active expression ==================== */
console.log('\n[A1-A4] 跨轮 active-expression（CASE A/B/C/D）');

/* A1 = CASE A：句中「因为……」未说完 → 不允许 REFLECT */
{
  const text = '我那天特别开心，但是一路上都装得很淡定，因为……';
  const { active, trace } = sim(undefined, text);
  console.log(`  A1 active=${active.active} conf=${active.confidence} cost=${trace.interruptionCost} candidate=${trace.interventionCandidate}`);
  expect('A1 判定为连续表达中', active.active === true);
  expect('A1 未说完 → confidence HIGH', active.confidence === 'HIGH');
  expect('A1 修正后打断成本 HIGH', trace.interruptionCost === 'HIGH');
  expect('A1 不允许 REFLECT', trace.interventionCandidate !== 'REFLECT_CANDIDATE');
  expect('A1 候选 WAIT', trace.interventionCandidate === 'WAIT');
}
/* A2 = CASE B：完整句 → 允许 REFLECT */
{
  const text = '我那天特别开心，但是一路上都装得很淡定。';
  const { active, trace } = sim(undefined, text);
  console.log(`  A2 active=${active.active} stop=${active.lastNaturalStop} cost=${trace.interruptionCost} candidate=${trace.interventionCandidate}`);
  expect('A2 判定为已停下（非连续表达）', active.active === false);
  expect('A2 有自然停顿', active.lastNaturalStop === true);
  expect('A2 修正后打断成本 LOW', trace.interruptionCost === 'LOW');
  expect('A2 允许 REFLECT', trace.interventionCandidate === 'REFLECT_CANDIDATE');
}
/* A3 = CASE C：跨轮仍在讲同一件事 → 不允许 REFLECT */
{
  const t1 = '我那天特别开心。';
  const s1 = updateActiveExpression(undefined, { userText: t1 });
  const t2 = '但是其实一路上都装得很淡定。';
  const s2 = updateActiveExpression(s1, { userText: t2 });
  const trace = runInterventionAnalysis({
    userText: t2,
    understanding: mkUnderstanding(),
    memory: emptyMemory(),
    interruptionCost: 'LOW',
    activeExpression: s2,
    storyReadinessAction: 'CONTINUE',
  });
  console.log(`  A3 turn1Active=${s1.active} turn2Active=${s2.active} candidate=${trace.interventionCandidate}`);
  expect('A3 第一轮结束（自然停顿）', s1.active === false && s1.lastNaturalStop === true);
  expect('A3 第二轮句首连接词 → 仍算连续表达', s2.active === true);
  expect('A3 不允许 REFLECT', trace.interventionCandidate !== 'REFLECT_CANDIDATE');
  expect('A3 候选 WAIT', trace.interventionCandidate === 'WAIT');
}
/* A4 = CASE D：完整句 + 用户停住 → 允许 REFLECT */
{
  const t1 = '我那天特别开心，但是一路上都装得很淡定。';
  const s1 = updateActiveExpression(undefined, { userText: t1 });
  const { trace } = sim(s1, t1, { prior: null });
  console.log(`  A4 state.active=${s1.active} cost=${trace.interruptionCost} candidate=${trace.interventionCandidate}`);
  expect('A4 完整句后状态为停下', s1.active === false);
  expect('A4 允许 REFLECT', trace.interventionCandidate === 'REFLECT_CANDIDATE');
}

/* ==================== 三、B1-B3：previousIntervention 跨轮 ==================== */
console.log('\n[B1-B3] previousIntervention 跨轮状态');
const priorReflect: LastInterventionState = { candidate: 'REFLECT_CANDIDATE', discoveryType: 'CONTRAST', turn: 1 };

/* B1：上一轮 REFLECT，用户只回「嗯」→ 不再 REFLECT */
{
  const resp = resolveUserResponseToIntervention(priorReflect, '嗯');
  const { trace } = sim(undefined, '嗯', { prior: priorReflect });
  console.log(`  B1 resp=${resp} candidate=${trace.interventionCandidate} futureHint=${trace.futureDecisionHint}`);
  expect('B1 判定为没接住', resp === 'NOT_PICKED_UP');
  expect('B1 trace 记录 NOT_PICKED_UP', trace.userResponseToPrevious === 'NOT_PICKED_UP');
  expect('B1 不再 REFLECT', trace.interventionCandidate !== 'REFLECT_CANDIDATE');
  expect('B1 futureDecisionHint = STOP', trace.futureDecisionHint === 'STOP');
}
/* B2：上一轮 REFLECT，用户接住并展开 / 自己接着展开 → 交回控制权 */
{
  const text = '对，因为那时候我其实特别怕别人看出来。';
  const resp = resolveUserResponseToIntervention(priorReflect, text);
  const { trace } = sim(undefined, text, { prior: priorReflect });
  console.log(`  B2 resp=${resp} candidate=${trace.interventionCandidate}`);
  expect('B2 接住并展开 → PICKED_UP', resp === 'PICKED_UP');
  expect('B2 候选 WAIT（交回控制权）', trace.interventionCandidate === 'WAIT');
  expect('B2 不再 REFLECT', trace.interventionCandidate !== 'REFLECT_CANDIDATE');

  // 没有承认词、只有「因为…」→ 用户自己接着展开
  const selfText = '因为那时候我其实特别怕别人看出来。';
  const selfResp = resolveUserResponseToIntervention(priorReflect, selfText);
  console.log(`  B2' resp=${selfResp}`);
  expect('B2 无承认词只有展开 → SELF_EXPANDED', selfResp === 'SELF_EXPANDED');
}
/* B3：上一轮 REFLECT，用户明确否定 → 交给 Correction Recovery */
{
  const resp = resolveUserResponseToIntervention(priorReflect, '不是这样的。');
  const { trace } = sim(undefined, '不是这样的。', { prior: priorReflect });
  console.log(`  B3 resp=${resp} candidate=${trace.interventionCandidate}`);
  expect('B3 判定为明确否定', resp === 'REJECTED');
  expect('B3 候选 WAIT', trace.interventionCandidate === 'WAIT');
  expect('B3 不再 REFLECT', trace.interventionCandidate !== 'REFLECT_CANDIDATE');
}

/* ==================== 四、C1-C5：Discovery 误判回归 ==================== */
console.log('\n[C1-C5] Discovery false-positive 回归（宁可漏，不可造）');
{
  const cases: { id: string; text: string }[] = [
    { id: 'C1', text: '那天拍了很多照片，其中一张只有我一个人。' },
    { id: 'C2', text: '我突然想起来那天其实下过雨。' },
    { id: 'C3', text: '后来一个人走回宿舍。' },
    { id: 'C4', text: '我一个人坐在那里，但是其实也没觉得怎么样。' },
    { id: 'C5', text: '那天我们先去了操场，操场旁边有个小卖部，我在小卖部买了瓶水，后来又回了操场。' },
  ];
  for (const c of cases) {
    const signals = detectDiscoverySignals({ userText: c.text });
    const trace = analyze(c.text);
    console.log(`  ${c.id} signals=${JSON.stringify(signals.map((s) => s.type))} structural=${trace.structuralDiscoveryValue} candidate=${trace.interventionCandidate}`);
    expect(`${c.id} 不产生 CONTRAST`, !hasType(signals, 'CONTRAST'));
    expect(`${c.id} 不产生 REPETITION`, !hasType(signals, 'REPETITION'));
    expect(`${c.id} structural 不为 HIGH`, trace.structuralDiscoveryValue !== 'HIGH');
    expect(`${c.id} 不 REFLECT`, trace.interventionCandidate !== 'REFLECT_CANDIDATE');
  }
}

/* ==================== 五、D1-D3：SELF vs RELATIONAL realization ==================== */
console.log('\n[D1-D3] SELF_REALIZATION ≠ RELATIONAL_REALIZATION');
{
  const text = '后来我才发现，我其实一直很在意她怎么看我。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  D1 signals=${JSON.stringify(signals.map((s) => s.type))} self=${trace.selfDiscoveryValue} candidate=${trace.interventionCandidate}`);
  expect('D1 关于自己的发现 = SELF_REALIZATION', hasType(signals, 'SELF_REALIZATION'));
  expect('D1 selfDiscoveryValue = HIGH', trace.selfDiscoveryValue === 'HIGH');
  expect('D1 不误判为 RELATIONAL', !hasType(signals, 'RELATIONAL_REALIZATION'));
  expect('D1 候选 ACKNOWLEDGE / WAIT', ['ACKNOWLEDGE', 'WAIT'].includes(trace.interventionCandidate));
}
{
  const text = '后来才知道她一直很爱我。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  D2 signals=${JSON.stringify(signals.map((s) => s.type))} self=${trace.selfDiscoveryValue} structural=${trace.structuralDiscoveryValue} candidate=${trace.interventionCandidate}`);
  expect('D2 关于他人 = RELATIONAL_REALIZATION', hasType(signals, 'RELATIONAL_REALIZATION'));
  expect('D2 不是 SELF_REALIZATION', !hasType(signals, 'SELF_REALIZATION'));
  expect('D2 selfDiscoveryValue 不为 HIGH（关于他人）', trace.selfDiscoveryValue !== 'HIGH');
  expect('D2 user-owned', trace.userOwnedDiscovery === true);
  expect('D2 不 REFLECT / 不 ASK', trace.interventionCandidate !== 'REFLECT_CANDIDATE' && trace.interventionCandidate !== 'ASK_CANDIDATE');
}
{
  const text = '以前我一直觉得我不喜欢大学。后来发现，我真正不喜欢的是那种每天不知道自己在干什么的感觉。';
  const signals = detectDiscoverySignals({ userText: text });
  const trace = analyze(text);
  console.log(`  D3 signals=${JSON.stringify(signals.map((s) => s.type))} self=${trace.selfDiscoveryValue}`);
  expect('D3 关于自己 = SELF_REALIZATION', hasType(signals, 'SELF_REALIZATION'));
  expect('D3 selfDiscoveryValue = HIGH', trace.selfDiscoveryValue === 'HIGH');
  expect('D3 候选 ACKNOWLEDGE / WAIT', ['ACKNOWLEDGE', 'WAIT'].includes(trace.interventionCandidate));
}

/* ==================== 六、E1-E2：ASK_CANDIDATE 真实存在 ==================== */
console.log('\n[E1-E2] ASK_CANDIDATE（只验证 decision trace，不改 reply）');
{
  const text = '那天我们在操场拍了照，然后一起去食堂吃饭，最后各自回宿舍了。';
  const trace = analyze(text, { storyMaterial: 'HIGH', hasMeaning: false, highValueQuestion: true });
  console.log(`  E1 candidate=${trace.interventionCandidate} structural=${trace.structuralDiscoveryValue}`);
  expect('E1 产生 ASK_CANDIDATE', trace.interventionCandidate === 'ASK_CANDIDATE');
  expect('E1 记录「本阶段只记录、不真正发问」', trace.blockedActions.some((b) => b.includes('只记录')));
}
{
  const text = '那天我们在操场拍了照，然后一起去食堂吃饭，最后各自回宿舍了。';
  // 「同样高价值问题」，但用户仍处于连续表达状态（跨轮 active-expression）
  const active: ActiveExpressionState = {
    active: true,
    streak: 2,
    lastUserExpanded: true,
    lastNaturalStop: false,
    confidence: 'HIGH',
  };
  const trace = runInterventionAnalysis({
    userText: text,
    understanding: mkUnderstanding({ userState: mkUserState({ initiative: 'HIGH' }) }),
    memory: emptyMemory(),
    interruptionCost: 'HIGH',
    activeExpression: active,
    highValueQuestion: true,
    storyMaterial: 'HIGH',
    hasMeaning: false,
    storyReadinessAction: 'CONTINUE',
  });
  console.log(`  E2 candidate=${trace.interventionCandidate} cost=${trace.interruptionCost} active=${trace.activeExpression?.active}`);
  expect('E2 高价值 ASK 被 interruption 阻断', trace.interventionCandidate === 'WAIT');
  expect('E2 ASK_CANDIDATE 被拦下', trace.blockedActions.some((b) => b.includes('ASK_CANDIDATE')));
}

/* ==================== 七、F1-F3：AUTHORIZED_DISCOVERY 同义表达 ==================== */
console.log('\n[F1-F3] AUTHORIZED_DISCOVERY 同义表达');
{
  const f1 = analyze('你听完之后，能不能告诉我这里面有什么我自己没注意到的？');
  const f2 = analyze('你觉得这个故事里有没有什么我自己没有意识到的？');
  const f3 = analyze('如果你从旁边看，会不会发现一些我自己没发现的东西？');
  console.log(`  F1=${f1.explicitDiscoveryRequest} F2=${f2.explicitDiscoveryRequest} F3=${f3.explicitDiscoveryRequest}`);
  expect('F1 识别为显式授权发现', f1.explicitDiscoveryRequest === true);
  expect('F2 识别为显式授权发现', f2.explicitDiscoveryRequest === true);
  expect('F3 识别为显式授权发现', f3.explicitDiscoveryRequest === true);

  const f4 = analyze('你觉得我这个人怎么样？');
  console.log(`  F4 authorized=${f4.explicitDiscoveryRequest}`);
  expect('F4 仍识别为请求（但不给人格定论）', f4.explicitDiscoveryRequest === true);
  expect('F4 红线：不得给人格定论', f4.blockedActions.some((b) => b.includes('人格定论')));
}

/* ==================== 八、structural vs self value 直接校验 ==================== */
console.log('\n[补充] structuralDiscoveryValue ≠ selfDiscoveryValue');
{
  const selfOnly = detectDiscoverySignals({ userText: '后来我才发现，我其实一直很在意她怎么看我。' });
  expect('仅自己发现时 structural = LOW', computeStructuralDiscoveryValue(selfOnly) === 'LOW');
  expect('仅自己发现时 self = HIGH', computeSelfDiscoveryValue(selfOnly) === 'HIGH');

  const structural = detectDiscoverySignals({ userText: '我特别开心，但一路上又装得很淡定。' });
  expect('仅结构对照时 structural = HIGH', computeStructuralDiscoveryValue(structural) === 'HIGH');
  expect('仅结构对照时 self = LOW', computeSelfDiscoveryValue(structural) === 'LOW');
  expect('兼容入口 computeDiscoveryValue = structural', computeDiscoveryValue(structural) === 'HIGH');
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}；已记录残留问题：${observed}（不阻断）`);
if (failed === 0) {
  console.log('✓ Phase 3.1 / 3.1.1 Discovery Detection + Intervention Decision 确定性回归全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败。`);
  process.exit(1);
}
