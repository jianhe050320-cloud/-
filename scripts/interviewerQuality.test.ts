/**
 * Phase 2~4 验收：Interviewer / Organizer 质检 fixture。
 *
 * 这批测试不依赖联网模型，而是验证「支撑 Prompt 行为的确定性代码 + Prompt 文本本身」：
 *   - 行为类：规则层（rules / maturity / thread / memory 合并）对 13 个真实场景的反应；
 *   - 契约类：Interviewer / Organizer / Outline 提示词确实写进了对应的纪律（接住、一次一问、
 *     不强行升华、continuesThreadId 只是候选、worthSaving 只是信号、不编造、事实地图、隔离）。
 *
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/interviewerQuality.test.ts
 */
import {
  INTERVIEWER_SYSTEM_PROMPT,
  STORY_SYSTEM_PROMPT,
  OUTLINE_SYSTEM_PROMPT,
} from '../src/data/prompts';
import {
  detectEndIntent,
  buildForcedReply,
  hasVagueMemory,
  looksAbstract,
  applyHardRules,
  detectProductQuestion,
  strengthenSignals,
} from '../src/services/rules';
import { decideOutput, classifyMemory, isWorthSaving } from '../src/machines/interviewMachine';
import { resolveThread } from '../src/services/threadService';
import { mergeMemory } from '../src/services/memoryService';
import { createEmptyMemory } from '../src/types/interview';
import type { CandidateQuestion, StoryMemory, UserSignals } from '../src/types/interview';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    fail += 1;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function assertPrompt(name: string, prompt: string, sub: string): void {
  assert(prompt.includes(sub), `Prompt[${name}] 应包含「${sub}」`);
}

const emptySignals = (): UserSignals => ({
  wantsToStop: false,
  sensitive: false,
  confused: false,
  offTopic: false,
  uncertainFact: false,
  emotionalIntensity: 0,
});

function buildMemory(): StoryMemory {
  const memory = createEmptyMemory();
  memory.people = [
    { name: '妈妈', relationship: '母亲', importance: 5 },
    { name: '村里老王', relationship: '邻居', importance: 3 },
    { name: '工友小陈', relationship: '同事', importance: 3 },
  ];
  memory.events = [
    { description: '第一次外出打工，二十岁出头跟着村里人一起出去', time: '二十岁出头', place: '老家村口', importance: 5 },
    { description: '到了外地先在建筑队干活', time: '第一年', place: '城里', importance: 4 },
    { description: '晚上饿了拿出妈妈煮的鸡蛋', time: '到外地第一晚', place: '出租屋', importance: 4 },
    { description: '后来攒钱给家里寄回第一笔工资', time: '半年后', place: '', importance: 4 },
  ];
  memory.details = [
    { detail: '走之前妈妈煮了几个鸡蛋，偷偷放进包里', importance: 5 },
    { detail: '包里还塞了一双新鞋', importance: 4 },
    { detail: '工地上中午就着咸菜吃冷馒头', importance: 4 },
    { detail: '第一次领工资手都在抖', importance: 4 },
  ];
  memory.turning_points = [
    { before: '觉得外面肯定比家里好', after: '到了晚上突然就想家了', trigger: '独自在外' },
    { before: '不敢跟家里说累', after: '第一次寄钱回家觉得长大了', trigger: '寄工资' },
  ];
  memory.emotions = [
    { emotion: '想家', evidence: '到了晚上突然就想家了', confidence: 0.9 },
    { emotion: '激动', evidence: '第一次领工资手都在抖', confidence: 0.8 },
    { emotion: '自豪', evidence: '给家里寄回第一笔工资', confidence: 0.8 },
  ];
  memory.user_quotes = [
    '外面的世界肯定比家里好',
    '到了晚上突然就想家了',
    '第一次领工资手都在抖',
  ];
  return memory;
}

const LONG_TRANSCRIPT = Array.from({ length: 12 })
  .map(
    (_, index) =>
      `用户：第${index + 1}天，我还是会想起妈妈煮的鸡蛋，还有村口送别的那些人，工地上中午就着咸菜吃冷馒头，第一次领工资手都在抖，给家里寄回第一笔工资的时候觉得自己真的长大了。`,
  )
  .join('\n');

/* ============ Phase 3 · Interviewer ============ */

function testInterviewerPrompts(): void {
  console.log('\n========== Phase 3 · Interviewer 提示词契约 ==========');
  assertPrompt('interviewer', INTERVIEWER_SYSTEM_PROMPT, '每次最多提出一个核心问题');
  assertPrompt('interviewer', INTERVIEWER_SYSTEM_PROMPT, '理解用户刚刚说了什么');
  assertPrompt('interviewer', INTERVIEWER_SYSTEM_PROMPT, '不强行升华');
  assertPrompt('interviewer', INTERVIEWER_SYSTEM_PROMPT, 'continuesThreadId');
  assertPrompt('interviewer', INTERVIEWER_SYSTEM_PROMPT, '候选');
  assertPrompt('interviewer', INTERVIEWER_SYSTEM_PROMPT, 'worthSaving');
  assertPrompt('interviewer', INTERVIEWER_SYSTEM_PROMPT, '信号');
}

function testInterviewerBehavior(): void {
  console.log('\n========== Phase 3 · Interviewer 行为 ==========');

  // 用户只说一句非常短的话 → 不升级为完整故事
  assert(
    decideOutput({ memory: createEmptyMemory(), messages: [{ role: 'user', text: '嗯。' }] }) === 'seed',
    '只说一句很短的话 → seed（不勉强成故事）',
  );

  // 用户突然说"不记得了" → 同一句给了别的细节时不接管、不追问
  assert(hasVagueMemory('那段路我不记得了'), '「不记得了」被正确识别为记不清');
  assert(
    buildForcedReply(emptySignals(), '那段路我不记得了，但奶奶用小推车把我从幼儿园推回老家', {
      hasSubstance: true,
    }) === null,
    '同一句里有别的细节 → 不接管整轮（不打断）',
  );
  assert(
    strengthenSignals({ ...emptySignals(), confused: true }, '那个路口我不太记得了').confused === false,
    '只是某处记不清 → 不算「说不出来」，不触发劝退',
  );

  // 用户不想说这件事 → 立即换入口，且不是结束整场
  assert(detectEndIntent('这个我不想说') === 'topic_decline', '「这个我不想说」= 拒绝该话题');
  const refuse = buildForcedReply(emptySignals(), '我不聊这个了', {});
  assert(refuse !== null && refuse.reason.includes('拒绝'), '拒绝话题 → 给换入口（不结束整场）');

  // 用户从具体事件突然转向抽象感受 → 不问"为什么"，要往具体压
  assert(looksAbstract('我大学过得很迷茫') === true, '「过得很迷茫」被判为抽象表达');
  const blocked = applyHardRules(
    [
      {
        ack: '听起来那段时间你挺空的。',
        question: '为什么你会觉得迷茫？',
        ask: true,
        target_clue: '迷茫',
        story_value: 3,
        user_initiative: 2,
        emotional_signal: 4,
        information_gain: 2,
        willingness: 3,
        disturbance_cost: 2,
        sensitivity_risk: 1,
      },
    ],
    { signals: emptySignals(), memory: createEmptyMemory(), userText: '我大学过得很迷茫', abstractOnly: true, askedQuestions: [] },
  );
  assert(
    blocked.kept.length === 0 && blocked.blocked.some((candidate) => (candidate.blockedReason ?? '').includes('为什么')),
    '抽象表达 + 问「为什么」→ 被规则拦下',
  );

  // 用户从采访突然问产品功能 → 直接回答，不拉回采访（产品提问被识别并切过去）
  assert(detectProductQuestion('你们会记住多久') !== null, '问「你们会记住多久」被识别为产品提问');
  // 修正后的意图边界：问「什么时候可以整理」是能力咨询，不是「现在就执行」。
  assert(detectProductQuestion('你什么时候帮我整理故事') !== null, '问「什么时候能整理」= 产品能力咨询（不立即执行）');
  assert(detectEndIntent('你什么时候帮我整理故事') === null, '能力咨询不进入 story_request / end');
  assert(detectEndIntent('现在帮我整理一下吧') === 'story_request', '明确要求「现在整理」= 立即执行');

  // 用户主动要求保存 → 立即进入保存（意图识别）
  assert(detectEndIntent('把这个保存下来') === 'story_request', '「把这个保存下来」= 主动要求保存');
  assert(detectEndIntent('帮我存下来吧') === 'story_request', '「帮我存下来」= 主动要求保存');

  // 用户说"今天就到这里" → 结束且不追问
  assert(detectEndIntent('今天就到这里') === 'end', '「今天就到这里」= 结束');
  const stop = buildForcedReply({ ...emptySignals(), wantsToStop: true }, '今天就到这里', {});
  assert(stop !== null && stop.reason.includes('结束'), '结束意图 → 不再追问并交故事');

  // 重复讲过的人 → 不重复记
  const base = mergeMemory(createEmptyMemory(), { people: [{ name: '妈妈', relationship: '母亲', importance: 5 }] });
  const merged = mergeMemory(base, { people: [{ name: '妈妈', relationship: '母亲', importance: 5 }] });
  assert(merged.people.length === 1, '同一个被反复提到的人 → 只记一条（去重）');

  // 值得保存的闸门：纯情绪宣泄不自动留存（但用户主动要求仍会保存，由上层绕过）
  const venting = createEmptyMemory();
  venting.emotions = [{ emotion: '累', evidence: '今天好累', confidence: 0.8 }];
  assert(isWorthSaving(venting) === false, '纯情绪宣泄（无具体人/事）→ 不自动留存');
}

/* ============ Phase 4 · Organizer ============ */

function testOrganizerPrompts(): void {
  console.log('\n========== Phase 4 · Organizer 提示词契约 ==========');
  assertPrompt('story', STORY_SYSTEM_PROMPT, '不编造');
  assertPrompt('story', STORY_SYSTEM_PROMPT, '事实地图');
  assertPrompt('story', STORY_SYSTEM_PROMPT, '当成事实');
  assertPrompt('story', STORY_SYSTEM_PROMPT, 'seed');
  assertPrompt('story', STORY_SYSTEM_PROMPT, '生成假装完整的故事');
  assertPrompt('story', STORY_SYSTEM_PROMPT, '起承转合');
  assertPrompt('story', STORY_SYSTEM_PROMPT, '自己升成 full');
  assertPrompt('outline', OUTLINE_SYSTEM_PROMPT, '事实地图');
  assertPrompt('outline', OUTLINE_SYSTEM_PROMPT, '不写');
}

function testOrganizerBehavior(): void {
  console.log('\n========== Phase 4 · Organizer 行为 ==========');

  // seed / fragment / full 分流
  assert(
    decideOutput({ memory: createEmptyMemory(), messages: [{ role: 'user', text: '就是那天挺难过的。' }] }) === 'seed',
    '材料极少 → seed',
  );
  const rich = buildMemory();
  const fragmentDecision = decideOutput({ memory: rich, messages: [{ role: 'user', text: LONG_TRANSCRIPT }] });
  assert(fragmentDecision !== 'seed', '材料丰富 → 不会误判成 seed（fragment / full）');
  assert(
    classifyMemory({ memory: createEmptyMemory(), messages: [{ role: 'user', text: '嗯。' }] }) === 'seed',
    '采访中自动留存：一句 → seed',
  );
  assert(
    classifyMemory({ memory: rich, messages: [{ role: 'user', text: LONG_TRANSCRIPT }] }) === 'note',
    '采访中自动留存：有料 → note（不是 seed）',
  );

  // full 不能由 LLM 自评单独触发（修正4：LLM 只是被封顶的输入）
  const thin = createEmptyMemory();
  thin.events = [{ description: '有件事', time: '', place: '', importance: 3 }];
  assert(
    decideOutput({ memory: thin, messages: [{ role: 'user', text: '有件事想说。' }], llmCompleteness: 1 }) !== 'full',
    'LLM 自评=1 但材料很薄 → 绝不升级为 full',
  );

  // 用户明确要求整理、但材料很薄 → 诚实：不编造成 full，落为记忆入口（seed）
  assert(
    decideOutput({
      memory: createEmptyMemory(),
      messages: [{ role: 'user', text: '帮我整理一下吧。' }],
      userRequestsOrganize: true,
    }) === 'seed',
    '用户要求整理但材料薄 → 诚实 seed（不编造成 full，仍以记忆入口保存）',
  );

  // 材料足够丰富 + 用户说讲完了 → 才到 full
  assert(
    decideOutput({ memory: rich, messages: [{ role: 'user', text: LONG_TRANSCRIPT }], userSaysComplete: true }) ===
      'full',
    '材料丰富 + 用户说讲完 → full',
  );
}

/* ============ Phase 4 · Thread 续接 ============ */

function testThread(): void {
  console.log('\n========== Phase 4 · Thread 续接 ==========');
  const known = 'th_known_001';
  const other = 'th_other_002';

  // 同一主题、已知线程 → 优先复用
  const reuse = resolveThread({ continuesThreadId: known, knownThreadIds: [known, other], topicThreadId: other });
  assert(reuse.threadId === known && reuse.created === false, 'LLM 候选命中已知线程 → 复用（不新建）');

  // LLM 给不存在的 threadId → 代码校验后丢弃，绝不采用，回落到同话题已有线程
  const bad = resolveThread({ continuesThreadId: 'th_fake_999', knownThreadIds: [known], topicThreadId: known });
  assert(
    bad.rejectedCandidate === 'th_fake_999' && bad.threadId !== 'th_fake_999' && bad.created === false,
    'LLM 自造的不存在 threadId → 丢弃并回落已有线程（绝不采用）',
  );

  // 隔一段时间回来继续同一主题 → 复用 topic 线程
  const resume = resolveThread({ continuesThreadId: null, knownThreadIds: [known], topicThreadId: known });
  assert(resume.threadId === known && resume.created === false, '无候选但同话题有线程 → 复用续聊');
}

function main(): void {
  testInterviewerPrompts();
  testInterviewerBehavior();
  testOrganizerPrompts();
  testOrganizerBehavior();
  testThread();

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
