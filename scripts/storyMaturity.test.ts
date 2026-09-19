/**
 * Phase 1 · 故事成熟度决策的确定性单测（不依赖模型，直接喂 memory + messages）。
 *
 * 用法（复用工程里已装好的 tsx）：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/storyMaturity.test.ts
 *
 * 验收标准（来自产品说明，不可为了让测试通过而放宽）：
 *   Case1/2/5 → seed；Case3 → fragment；Case4 → full；
 *   LLM 自评不能单独把结论推到 full；多主题分属不同 thread。
 */
import type {
  InterviewState,
  StoryEmotion,
  StoryEvent,
  StoryDetail,
  StoryMemory,
  StoryPerson,
  StoryTurningPoint,
} from '../src/types/interview';
import { createEmptyMemory } from '../src/types/interview';
import {
  classifyMemory,
  decideOutput,
  deriveConversationStatus,
  isWorthSaving,
  MATURITY_CONFIG,
  scoreMaturity,
  type MessageLike,
} from '../src/machines/interviewMachine';
import { collectThreadHints, resolveThread } from '../src/services/threadService';

let failed = 0;
function expect(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function mem(partial: Partial<StoryMemory>): StoryMemory {
  return { ...createEmptyMemory(), ...partial };
}

const person = (name: string, relationship = ''): StoryPerson => ({ name, relationship, importance: 3 });
const ev = (description: string, time = '', place = ''): StoryEvent => ({ description, time, place, importance: 3 });
const detail = (text: string): StoryDetail => ({ detail: text, importance: 3 });
const emo = (emotion: string): StoryEmotion => ({ emotion, evidence: '', confidence: 0.6 });
const turn = (before: string, after: string, trigger = ''): StoryTurningPoint => ({ before, after, trigger });
const u = (text: string): MessageLike => ({ role: 'user', text });

/* ---------------- Case 1：只有一句话 ---------------- */
const CASE1_TEXT = '高中那几年其实挺压抑的。';
const case1Memory = mem({ user_quotes: [CASE1_TEXT] });
const case1Messages: MessageLike[] = [u(CASE1_TEXT)];

/* ---------------- Case 2：只有一个事实 ---------------- */
const CASE2_TEXT = '大学第一年我参加了支教。';
const case2Memory = mem({ events: [ev('大学第一年参加支教')] });
const case2Messages: MessageLike[] = [u(CASE2_TEXT)];

/* ---------------- Case 3：50~100 字，真实片段 ---------------- */
const CASE3_TEXT =
  '我奶奶以前经常接我放学。小时候没觉得有什么，后来才知道她每天其实要走很远。现在想起来觉得挺触动的。';
const case3Memory = mem({
  people: [person('奶奶')],
  events: [ev('奶奶接我放学'), ev('她每天要走很远')],
  details: [detail('小时候没觉得有什么')],
  turning_points: [turn('小时候没觉得有什么', '后来才知道她每天要走很远')],
  emotions: [emo('触动')],
  user_quotes: [CASE3_TEXT],
});
const case3Messages: MessageLike[] = [u(CASE3_TEXT)];

/* ---------------- Case 4：完整支教经历 ---------------- */
const case4Memory = mem({
  people: [person('队长'), person('队友')],
  events: [
    ev('我们一行十个人去山里支教', '那年暑假', '山里的小学'),
    ev('因为任务安排，我和队友吵了起来', '第三天', '教室'),
    ev('我躲到一边哭了'),
    ev('队长过来支持我把担心说出来'),
  ],
  details: [
    detail('我们彼此都不太熟'),
    detail('我带的是四年级的课'),
    detail('那天晚上我在操场坐了很久'),
    detail('第二天我主动去找他说话'),
  ],
  turning_points: [
    turn('我当时觉得合作只要大家都努力就行', '后来我明白，努力也不一定换来完美的结果', '那次冲突'),
    turn('我一开始什么都没说', '后来我把对任务执行的担心说了出来', '队长的支持'),
  ],
  emotions: [emo('难受'), emo('愧疚'), emo('松了一口气')],
  user_quotes: [
    '我作为副组长，那天真的没忍住',
    '有需要帮助的时候，他在',
    '我后来才知道，合作不是只要努力就行',
  ],
});
const case4Messages: MessageLike[] = [
  u('那年暑假我们去山里支教，一行十个人，彼此都不太熟。'),
  u('我带的是四年级的课，白天上课，晚上还要一起开会排第二天的任务。'),
  u('第三天因为任务安排，我和队友吵了起来，话说得都不好听。'),
  u('后来我躲到一边哭了，觉得特别难受，也觉得自己作为副组长做得不好。'),
  u('队长过来跟我说了很多，支持我把对任务执行的担心说出来。'),
  u('第二天我主动去找那个队友说话，把担心都说清楚了。'),
  u('我后来才知道，合作不是只要努力就一定有完美的结果。这就是整件事了。'),
];

/* ---------------- Case 5：只有情绪 ---------------- */
const CASE5_TEXT = '那段时间我真的很难过。';
const case5Memory = mem({ emotions: [emo('难过')] });
const case5Messages: MessageLike[] = [u(CASE5_TEXT)];

console.log('\n================ 故事成熟度决策单测 ================\n');

console.log('[Acceptance] Case 1/2/3/4/5');
expect(
  'Case1（一句话）→ seed',
  decideOutput({ memory: case1Memory, messages: case1Messages }) === 'seed',
  decideOutput({ memory: case1Memory, messages: case1Messages }),
);
expect(
  'Case2（一个事实）→ seed',
  decideOutput({ memory: case2Memory, messages: case2Messages }) === 'seed',
  decideOutput({ memory: case2Memory, messages: case2Messages }),
);
expect(
  'Case3（50~100字真实片段）→ fragment',
  decideOutput({ memory: case3Memory, messages: case3Messages }) === 'fragment',
  `got ${decideOutput({ memory: case3Memory, messages: case3Messages })}, rawInfo=${scoreMaturity({ memory: case3Memory, messages: case3Messages }).rawInfo}`,
);
expect(
  'Case4（完整支教经历）→ full',
  decideOutput({ memory: case4Memory, messages: case4Messages, userRequestsOrganize: true }) === 'full',
  `got ${decideOutput({ memory: case4Memory, messages: case4Messages, userRequestsOrganize: true })}, score=${scoreMaturity({ memory: case4Memory, messages: case4Messages, userRequestsOrganize: true }).score}`,
);
expect(
  'Case5（只有情绪）→ seed',
  decideOutput({ memory: case5Memory, messages: case5Messages }) === 'seed',
  decideOutput({ memory: case5Memory, messages: case5Messages }),
);

console.log('\n[Guardrail] 修正4：LLM 自评不能单独把结论推到 full');
expect(
  'LLM 说 complete=1，但内容极少 → 仍然是 seed',
  decideOutput({ memory: case1Memory, messages: case1Messages, llmCompleteness: 1 }) === 'seed',
  decideOutput({ memory: case1Memory, messages: case1Messages, llmCompleteness: 1 }),
);
{
  const withLlm = scoreMaturity({ memory: case1Memory, messages: case1Messages, llmCompleteness: 1 }).score;
  const withoutLlm = scoreMaturity({ memory: case1Memory, messages: case1Messages, llmCompleteness: 0 }).score;
  const delta = Number((withLlm - withoutLlm).toFixed(4));
  const llmCap = Number((MATURITY_CONFIG.WEIGHTS.llm * MATURITY_CONFIG.LLM_COMPLETENESS_CAP).toFixed(4));
  expect('LLM 自评对综合分的边际贡献被封顶', delta <= llmCap + 1e-6, `delta=${delta}, cap=${llmCap}`);
}

console.log('\n[Guardrail] 用户主权：明确要求整理也不许把极少内容变成完整故事');
expect(
  '极少内容 + 明确要求整理 → 仍为 seed（会落成记忆入口，而不是编故事）',
  decideOutput({ memory: case1Memory, messages: case1Messages, userRequestsOrganize: true }) === 'seed',
  decideOutput({ memory: case1Memory, messages: case1Messages, userRequestsOrganize: true }),
);

console.log('\n[classifyMemory] 采访中自动留存：seed / note');
expect(
  'Case3 材料 → note',
  classifyMemory({ memory: case3Memory, messages: case3Messages }) === 'note',
  classifyMemory({ memory: case3Memory, messages: case3Messages }),
);
expect(
  'Case1 材料 → seed',
  classifyMemory({ memory: case1Memory, messages: case1Messages }) === 'seed',
  classifyMemory({ memory: case1Memory, messages: case1Messages }),
);

console.log('\n[isWorthSaving] 修正5：只留值得回看的记忆，纯情绪不自动留存');
expect('纯情绪（今天好累）→ 不值得自动留存', isWorthSaving(mem({ emotions: [emo('累')] })) === false);
expect('有具体人物（奶奶）→ 值得留存', isWorthSaving(mem({ people: [person('奶奶')] })) === true);
expect('有用户自己的理解 → 值得留存', isWorthSaving(mem({ turning_points: [turn('以为', '后来明白')] })) === true);

console.log('\n[Thread] 修正2/3：多主题分属不同 thread；LLM 候选必须经代码校验');
{
  // LLM 编了一个不存在的线程 id → 必须被拒绝并新建
  const ghost = resolveThread({ continuesThreadId: 't_ghost', knownThreadIds: [], topicThreadId: null });
  expect('不存在的 LLM 候选线程被拒绝', ghost.created === true && ghost.threadId !== 't_ghost', JSON.stringify(ghost));
  expect('被拒绝的候选被记录下来', ghost.rejectedCandidate === 't_ghost');

  // 候选命中当前用户已知线程 → 采纳
  const reuse = resolveThread({
    continuesThreadId: 'th_a',
    knownThreadIds: ['th_a', 'th_b'],
    topicThreadId: 'th_b',
  });
  expect('候选命中已知线程 → 复用该线程', reuse.threadId === 'th_a' && reuse.created === false, JSON.stringify(reuse));

  // 没有候选但同话题有旧线程 → 复用它（续聊同一故事）
  const topicReuse = resolveThread({ continuesThreadId: null, knownThreadIds: ['th_a'], topicThreadId: 'th_a' });
  expect('同话题旧线程 → 复用', topicReuse.threadId === 'th_a' && topicReuse.created === false);

  // 换一个话题 → 新线程（Case8：不要合成一个「我的大学与成长」）
  const otherTopic = resolveThread({ continuesThreadId: null, knownThreadIds: ['th_a'], topicThreadId: 'th_b' });
  expect('另一个话题 → 新建独立线程', otherTopic.created === true && otherTopic.threadId !== 'th_a');
}

console.log('\n[Thread hints] 从已有产物收集已知线程与话题线程');
{
  const hints = collectThreadHints([
    { threadId: 'th_high', topicId: 'high_school' },
    { threadId: 'th_college', topicId: 'college' },
    { threadId: 'th_college', topicId: 'college' },
  ]);
  expect('已知线程去重', hints.knownThreadIds.length === 2, JSON.stringify(hints.knownThreadIds));
  expect('话题映射到对应线程', hints.threadByTopic.get('high_school') === 'th_high');
  expect(
    '同一话题的多次讲述指向同一线程',
    hints.threadByTopic.get('college') === 'th_college',
  );
}

console.log('\n[Conversation vs Story] 修正3：两者正交，ended + fragment 合法');
{
  expect('对话结束 → ended', deriveConversationStatus('COMPLETING', true) === 'ended');
  expect('已保存 → ended', deriveConversationStatus('SAVED', false) === 'ended');
  expect('进行中 → active', deriveConversationStatus('EXPLORING', false) === 'active');

  const conversation = deriveConversationStatus('COMPLETING' as InterviewState, true);
  const story = decideOutput({ memory: case3Memory, messages: case3Messages });
  expect('conversation=ended 且 story=fragment 是合法组合', conversation === 'ended' && story === 'fragment', `${conversation}/${story}`);
}

console.log('\n================ 结论 ================');
if (failed === 0) {
  console.log('✓ Phase 1 成熟度决策与线程校验全部符合验收标准。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败。`);
  process.exit(1);
}
