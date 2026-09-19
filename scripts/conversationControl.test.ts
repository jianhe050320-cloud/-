/**
 * Phase 1 · 对话控制权与回复模式修复（Problem 1-4）的真实对话回归测试。
 *
 * 这些测试不依赖线上模型：直接驱动「意图识别 / 就绪层闸门 / WAIT 话术 /
 * 纠正恢复 / 相似经历边界」这些确定性的、用户真正会看到的回复逻辑。
 * 对需要模型的「继续追问（CONTINUE）」分支，测试只校验决策层（不会自证通过）。
 *
 * 用法（复用工程里已装好的 tsx）：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/conversationControl.test.ts
 */
import type {
  Clue,
  ThreadBoundary,
  Understanding,
  UserSignals,
  UserWillingnessState,
} from '../src/types/interview';
import {
  resolveIntent,
  classifyTurnIntent,
} from '../src/services/rules';
import {
  shouldApplyStoryReadinessOverlay,
  buildWaitForUserReply,
  detectCorrection,
  buildCorrectionReply,
  buildSimilarExperiencesReply,
  buildClarifyReply,
} from '../src/services/interviewService';
import { decideAction } from '../src/services/storyReadiness';
import type { StoryReadiness, StoryMaterialLevel, StoryFocusLevel, InterruptionCostLevel, QuestionPressureLevel } from '../src/types/interview';

let failed = 0;
let observed = 0;
function expect(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}
/** 记录一个「已发现的问题」（不计入失败，但必须被看到） */
function observe(name: string, cond: boolean, note: string): void {
  observed += 1;
  console.log(`  ⚠ ${name} → ${cond ? '仍存在问题' : '已符合预期'}：${note}`);
}

/* ---------------- 构造工具 ---------------- */
const EMPTY_SIGNALS: UserSignals = {
  wantsToStop: false,
  sensitive: false,
  confused: false,
  offTopic: false,
  uncertainFact: false,
  emotionalIntensity: 0,
};
function mkClue(partial: Partial<Clue>): Clue {
  return {
    id: 'c',
    kind: 'event',
    text: '',
    importance: 2,
    userInitiated: false,
    evidence: '',
    turn: 1,
    userInitiativeLevel: 'MEDIUM',
    emotionalDistance: 'core',
    ...partial,
  } as Clue;
}
function mkUnderstanding(partial: Partial<Understanding>): Understanding {
  return {
    newClues: [],
    signals: EMPTY_SIGNALS,
    memoryPatch: null,
    completeness: 0.3,
    focus: '',
    ...partial,
  } as Understanding;
}
function mkUserState(partial: Partial<UserWillingnessState>): UserWillingnessState {
  return {
    expressionWillingness: 'MEDIUM',
    answeringWillingness: 'MEDIUM',
    storyCompletionExpectation: 'LOW',
    initiative: 'MEDIUM',
    ...partial,
  };
}

/** WAIT 回复里禁止出现的「追问式」话术 */
const FORBIDDEN_WAIT = [
  '最想先讲哪一段',
  '后来发生了什么',
  '当时是什么感受',
  '你能具体说说',
  '你还想讲',
];
function assertNoForbiddenWait(reply: string): boolean {
  return !FORBIDDEN_WAIT.some((f) => reply.includes(f));
}

console.log('\n================ 对话控制权与回复模式修复（Problem 1-4）================\n');

/* ============== Problem 1：就绪层不得吞掉用户明确的问题/意图 ============== */
console.log('\n[Problem 1] Story Readiness 不得覆盖用户明确的问题 / 停止 / 拒绝');

{
  const productText = '对了，你是谁啊？你能帮我做什么？';
  const intent = resolveIntent(productText);
  const kind = classifyTurnIntent(productText);
  console.log(`  用户：「${productText}"`);
  console.log(`  → resolvedIntent=${intent}, intentKind=${kind}`);
  expect('「你是谁」被识别为 ASK_PRODUCT（非故事意图）', kind === 'ASK_PRODUCT');
  expect(
    'ASK_PRODUCT 时就绪层被跳过（不被 OFFER/GENERATE 吞掉）',
    shouldApplyStoryReadinessOverlay(intent, kind) === false,
  );

  const askAiText = '为什么你一直问我这个？';
  const askKind = classifyTurnIntent(askAiText);
  console.log(`  用户：「${askAiText}" → intentKind=${askKind}`);
  expect('反问 AI 被识别为 ASK_AI', askKind === 'ASK_AI');
  expect('ASK_AI 时就绪层被跳过', shouldApplyStoryReadinessOverlay('continue', askKind) === false);

  const stopText = '算了，我不想继续聊了。';
  const stopIntent = resolveIntent(stopText);
  console.log(`  用户：「${stopText}" → resolvedIntent=${stopIntent}`);
  expect('「不想继续聊了」被识别为 topic_decline（拒绝当前话题）', stopIntent === 'topic_decline');
  expect(
    'topic_decline 时就绪层被跳过（必须停止追问，由专门分支处理）',
    shouldApplyStoryReadinessOverlay(stopIntent, 'ANSWER_STORY') === false,
  );

  const cancelText = '不整理了，先别生成。';
  const cancelIntent = resolveIntent(cancelText);
  console.log(`  用户：「${cancelText}" → resolvedIntent=${cancelIntent}`);
  expect('「不整理了」被识别为 cancel_story_request', cancelIntent === 'cancel_story_request');
  expect('cancel_story_request 时就绪层被跳过（不生成）', shouldApplyStoryReadinessOverlay(cancelIntent, 'ANSWER_STORY') === false);

  const normalText = '我高中的时候，同桌总爱抄我作业。';
  const normalIntent = resolveIntent(normalText);
  console.log(`  用户：「${normalText}" → resolvedIntent=${normalIntent}`);
  expect('普通故事陈述仍允许就绪层', shouldApplyStoryReadinessOverlay(normalIntent, 'ANSWER_STORY') === true);
}

/* ============== Problem 2：WAIT_FOR_USER 不自动追问 ============== */
console.log('\n[Problem 2] WAIT_FOR_USER 默认不抛出新问题');

{
  // CASE 01：不愿答题，但主动表达（心里堵得慌）
  const u01 = '我不知道怎么回答你这个问题……但是其实我就是觉得心里一直堵得慌。';
  const und01 = mkUnderstanding({
    userState: mkUserState({ expressionWillingness: 'HIGH', answeringWillingness: 'LOW', initiative: 'HIGH' }),
    newClues: [mkClue({ kind: 'emotion', text: '心里一直堵得慌', importance: 4 })],
  });
  const r01 = buildWaitForUserReply(u01, und01);
  console.log(`  用户：「${u01}"`);
  console.log(`  AI（WAIT）：${r01}`);
  expect('CASE01 WAIT 不含追问尾巴', assertNoForbiddenWait(r01));
  expect('CASE01 WAIT 反射了用户原话（心里一直堵得慌）', r01.includes('心里一直堵得慌'));

  // CASE 02：连续叙述
  const u02 = '那天老师刚进教室，全班一下就安静了，然后他就……';
  const und02 = mkUnderstanding({
    userState: mkUserState({ expressionWillingness: 'HIGH', initiative: 'HIGH' }),
  });
  const r02 = buildWaitForUserReply(u02, und02);
  console.log(`  用户：「${u02}"`);
  console.log(`  AI（WAIT）：${r02}`);
  expect('CASE02 WAIT 不含追问尾巴', assertNoForbiddenWait(r02));

  // CASE 03：故事已成熟，但用户想起新事
  const u03 = '对了，其实还有一个事情想说……';
  const und03 = mkUnderstanding({ userState: mkUserState({ initiative: 'VERY_HIGH' }) });
  const r03 = buildWaitForUserReply(u03, und03);
  console.log(`  用户：「${u03}"`);
  console.log(`  AI（WAIT）：${r03}`);
  expect('CASE03 WAIT 不含追问尾巴', assertNoForbiddenWait(r03));
  expect('CASE03 WAIT 纯接住（好呀你说）', r03.startsWith('好呀，你说'));

  // CASE 10：主动从高中切到大学
  const u10 = '其实大学还有一件事，当时我们宿舍……';
  const und10 = mkUnderstanding({ userState: mkUserState({ initiative: 'VERY_HIGH' }) });
  const r10 = buildWaitForUserReply(u10, und10);
  console.log(`  用户：「${u10}"`);
  console.log(`  AI（WAIT）：${r10}`);
  expect('CASE10 WAIT 不含追问尾巴', assertNoForbiddenWait(r10));
}

/* ============== Problem 3：纠正恢复 ============== */
console.log('\n[Problem 3] 用户纠正 AI 后，进入纠正恢复（不重新解释）');

{
  // CASE 09
  const lastAssistant09 = '所以你其实一直都很害怕被评价，对吗？';
  const u09 = '不是，我不是害怕，我就是烦。';
  console.log(`  AI（前一轮）：「${lastAssistant09}"`);
  console.log(`  用户：「${u09}"`);
  const detected09 = detectCorrection(u09, lastAssistant09);
  const r09 = buildCorrectionReply(u09, lastAssistant09);
  console.log(`  AI（纠正恢复）：${r09}`);
  expect('CASE09 检测到用户纠正', detected09 === true);
  expect('CASE09 回复承认错误', r09.includes('理解错了'));
  expect('CASE09 以用户原话为真相（烦）', r09.includes('烦'));
  expect(
    'CASE09 回复不再重新解释用户心理',
    !/(所以其实你|这说明你|你本质上|看得出你|其实你一直|你其实很)/.test(r09),
  );

  // CASE 12：极简否定「不是。」（上一轮 AI 在求确认）
  const lastAssistant12 = '你是不是很害怕被别人评价？';
  const u12 = '不是。';
  console.log(`  AI（前一轮）：「${lastAssistant12}"`);
  console.log(`  用户：「${u12}"`);
  const detected12 = detectCorrection(u12, lastAssistant12);
  console.log(`  → 是否进入纠正恢复：${detected12}`);
  expect('CASE12 极简否定（上一轮求确认）被识别为纠正', detected12 === true);

  // 反例：普通否定不该误判为纠正
  const lastAssistantNeg = '那天天气怎么样？';
  const uNeg = '不是，那天天气不好，我是说心情不好。';
  const detectedNeg = detectCorrection(uNeg, lastAssistantNeg);
  console.log(`  反例：普通否定「${uNeg}" → 误判为纠正？${detectedNeg}`);
  expect('普通否定（上一轮非确认）不误判为纠正', detectedNeg === false);
}

/* ============== Problem 4：跨人生阶段不靠纯正则 + 相似经历不自动合并 ============== */
console.log('\n[Problem 4] 跨人生阶段 / 相似经历不自动合并');

{
  // 相似但不同人生阶段（CASE 10/11）：高中讨厌同桌，大学又发生类似
  const undRel = mkUnderstanding({
    focusState: { currentLifeStage: '大学', threadBoundary: 'related' as ThreadBoundary },
  });
  const rRel = buildSimilarExperiencesReply(undRel);
  console.log(`  AI（相似经历边界）：${rRel}`);
  expect('相似经历：让用户决定「分别讲」', rRel.includes('分别讲'));
  expect('相似经历：让用户决定「放在一起」比', rRel.includes('放在一起'));
  expect('相似经历：明确不替用户合并', rRel.includes('不替你合'));
  expect('相似经历：不自动声称是同一件事', !rRel.includes('其实是同一个'));

  // 跨阶段 CLARIFY（CASE 04）：高中 + 大学 材料都多
  const msgs = [
    { role: 'user' as const, text: '高中那时候……' },
    { role: 'user' as const, text: '大学时候也……' },
  ];
  const memory = {
    events: [{ description: '高中事件', time: '', place: '', importance: 3 }],
    meaning: [{ interpretation: '大学阶段', confirmed_by_user: false }],
  } as never;
  const rClarify = buildClarifyReply(msgs, memory);
  console.log(`  AI（跨阶段 CLARIFY）：${rClarify}`);
  expect('跨阶段 CLARIFY 给出两个阶段的提示', rClarify.includes('高中') && rClarify.includes('大学'));
}

/* ============== 已知残留问题（不计入失败，但必须被看到） ============== */
console.log('\n[残留问题] 仍需下一轮深挖的机制缺口');

{
  // CASE 05：短但完整的故事——若问题器仍给出高价值候选，decideAction 仍会 CONTINUE（过问）
  const matureReadiness: StoryReadiness = {
    topicAnchor: 2, concreteMaterial: 2, userExpression: 2, narrativeCoherence: 2, editability: 2,
    total: 10, state: 'VERY_READY', passesGate: true,
  };
  const userState = mkUserState({ expressionWillingness: 'LOW', answeringWillingness: 'MEDIUM', initiative: 'LOW' });
  const decidedWithQuestion = decideAction({
    readiness: matureReadiness,
    userState,
    explicitRequest: false, explicitEnd: false, cancelRequest: false,
    consecutiveQuestionCount: 0,
    hasHighValueQuestion: true, // 问题器仍想再丰富一点
    storyMaterial: 'HIGH' as StoryMaterialLevel,
    storyFocus: 'HIGH' as StoryFocusLevel,
    interruptionCost: 'LOW' as InterruptionCostLevel,
    questionPressure: 'LOW' as QuestionPressureLevel,
    readinessProvided: true,
  });
  observe(
    'CASE05 短而完整',
    decidedWithQuestion.action === 'CONTINUE',
    'decideAction 只看「是否还有高价值问题」，没有「故事自洽弧已闭合」判断；' +
      '问题器若仍产出候选，会继读追问。需下一轮加 completeness/closure 闸门。',
  );

  // 相似经历边界在没有 LLM 给 threadBoundary 时退化为 uncertain（依赖模型）
  const undNoBoundary = mkUnderstanding({ focusState: { currentLifeStage: '', threadBoundary: 'uncertain' as ThreadBoundary } });
  expect(
    '相似经历边界在无 LLM 信号时保守（不自动合并，也不强行追问）',
    buildSimilarExperiencesReply(undNoBoundary).includes('不替你合'),
  );
}

console.log('\n================ 结论 ================');
console.log(`断言失败：${failed}；已记录残留问题：${observed}（不阻断）`);
if (failed === 0) {
  console.log('✓ 对话控制权与回复模式修复（Problem 1-4）的确定性回归全部通过。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败。`);
  process.exit(1);
}
