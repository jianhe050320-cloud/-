/**
 * Phase 5 · 采访行为与意图边界回归。
 *
 * 本轮只修三个问题，测试也只针对这三条边界 + 两条行为原则：
 *   A. 拒绝当前话题 ≠ 结束整场
 *   B. 结束整场 ≠ 请求整理故事
 *   C. 产品能力咨询 ≠ 立即执行整理
 *   D. 明确「现在就整理」= 执行（进入 Organizer）
 *   E. 追问锚定用户刚说出的具体内容（不用万能问题，不追「不记得」的时间）
 *   F. 不制造用户没说的叙事（no narrative injection）
 *
 * 全部基于确定性代码（意图解析 / 规则层 / 降级提问器），不联网。
 *
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/intentBoundary.test.ts
 */
import {
  applyHardRules,
  buildForcedReply,
  detectEndIntent,
  detectProductQuestion,
  resolveIntent,
} from '../src/services/rules';
import { heuristicUnderstand } from '../src/services/understander';
import { heuristicCandidates } from '../src/services/questioner';
import type { QuestionInput } from '../src/services/questioner';
import { createEmptyMemory } from '../src/types/interview';
import type { UserSignals } from '../src/types/interview';

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

const emptySignals = (): UserSignals => ({
  wantsToStop: false,
  sensitive: false,
  confused: false,
  offTopic: false,
  uncertainFact: false,
  emotionalIntensity: 0,
});

const NARRATIVE_INJECTION_PHRASES = [
  '事情后来变了样子',
  '后来发生了变化',
  '从那以后就不一样',
  '这是一个重要的人生转折',
  '这对你影响很大',
  '你当时一定很',
];

/** 用降级理解器 + 降级提问器，模拟无模型环境下的一轮追问。 */
function questionOf(userText: string): string {
  const understanding = heuristicUnderstand({
    messages: [{ role: 'user', text: userText }],
    memory: createEmptyMemory(),
    userTurn: 1,
    userText,
  });
  const input: QuestionInput = {
    memory: createEmptyMemory(),
    clues: understanding.newClues,
    signals: understanding.signals,
    state: 'OPENING',
    userText,
    askingAlready: [],
    transcript: `用户：${userText}`,
    missing: [],
    resumed: false,
    recentAcks: [],
    vagueNote: '',
    keepGoing: false,
    anchorWords: [],
  };
  return heuristicCandidates(input)[0]?.question ?? '';
}

/* ------------------ A · 拒绝话题 ≠ 结束整场 ------------------ */
function testTopicDecline(): void {
  console.log('\n========== A · 拒绝话题（≠ 结束整场） ==========');
  assert(resolveIntent('算了，这个我不太想说。') === 'topic_decline', '「算了，这个我不太想说」→ topic_decline');
  assert(detectEndIntent('算了，这个我不太想说。') === 'topic_decline', 'detectEndIntent 同判为 topic_decline');

  const forced = buildForcedReply(emptySignals(), '算了，这个我不太想说。', {});
  assert(forced !== null && forced.reason.includes('拒绝'), '理由标记为「拒绝该话题」');
  assert(forced !== null && !forced.text.includes('整理'), '拒绝话题 → 绝不出现「整理」动作');
  assert(forced !== null && !forced.text.includes('今天先到这里'), '拒绝话题 → 不等于结束整场');

  // 与「真正结束整场」做对照，防止两者再次混淆
  assert(resolveIntent('算了，我今天先不聊了') === 'session_end', '「算了，我今天先不聊了」→ session_end');
  assert(
    resolveIntent('这个先不说，今天先到这里') === 'session_end',
    '「先不说 + 今天先到这里」→ session_end（结束优先于拒绝）',
  );
  assert(
    resolveIntent('我不太想讲这个，不过另外一件事我倒是想说') === 'topic_decline',
    '拒绝该话题但愿意换入口 → topic_decline（不结束整场）',
  );
  // 防止把「算了」当独立结束信号带来的误判
  assert(resolveIntent('我算了算，大概是九几年') === 'continue', '「我算了算」不是拒绝话题，也不算结束');
}

/* ------------------ B · 结束整场 ≠ 请求整理 ------------------ */
function testSessionEnd(): void {
  console.log('\n========== B · 结束整场（≠ 请求整理） ==========');
  assert(resolveIntent('今天先到这里吧。') === 'session_end', '「今天先到这里吧」→ session_end');
  assert(resolveIntent('今天先到这里吧。') !== 'story_request', '结束整场不被当成 story_request');
  assert(detectEndIntent('今天就到这里') === 'end', '「今天就到这里」→ end');

  const forced = buildForcedReply({ ...emptySignals(), wantsToStop: true }, '今天先到这里吧。', {});
  assert(forced !== null && forced.reason.includes('结束'), '结束整场 → 理由含「结束」');
  assert(forced !== null && !forced.text.includes('整理出来'), '结束整场 → 不自动承诺「整理出来」');
}

/* ------------------ C/D · 产品咨询 ≠ 立即执行 ------------------ */
function testProductVsStory(): void {
  console.log('\n========== C/D · 产品咨询（≠ 立即执行） ==========');
  const inquiry = '我什么时候可以让你帮我整理成故事？';
  assert(resolveIntent(inquiry) === 'product_question', '「什么时候可以整理」→ product_question');
  assert(detectProductQuestion(inquiry) !== null, '被识别为产品提问（只回答能力，不执行）');
  assert(resolveIntent(inquiry) !== 'story_request', '能力咨询绝不进入 story_request');
  assert(buildForcedReply(emptySignals(), inquiry, {}) === null, '能力咨询 → 不触发强制产出故事');

  const execute = '那现在就帮我整理一下吧。';
  assert(resolveIntent(execute) === 'story_request', '「现在就帮我整理」→ story_request');
  const forced = buildForcedReply(emptySignals(), execute, {});
  assert(forced !== null && forced.text.includes('整理'), '明确「现在整理」→ 触发整理');
  assert(resolveIntent('把刚才这段整理成故事') === 'story_request', '「把这段整理成故事」→ story_request');
  assert(resolveIntent('帮我存下来吧') === 'story_request', '「帮我存下来」→ story_request');
  // 咨询式问法不能被当成执行
  assert(resolveIntent('以后可以帮我整理吗？') === 'product_question', '「以后可以帮我整理吗」→ 能力咨询');
}

/* ------------------ E · 锚定用户刚说的具体内容 ------------------ */
function testSceneAnchoring(): void {
  console.log('\n========== E · 锚定用户刚说的具体内容 ==========');
  const text = '我记得有一次下雨，我就在校门口站了挺久的……具体多久我也不记得了。';
  const question = questionOf(text);
  assert(
    ['下雨', '校门口', '站了挺久', '站'].some((word) => question.includes(word)),
    `追问锚定用户刚说出的画面（实际：「${question}」）`,
  );
  assert(!question.includes('身边还有谁'), '不再默认问「当时您身边还有谁？」');
  assert((question.match(/[？?]/g) ?? []).length <= 1, '一轮最多一个核心问题');
  assert(
    !NARRATIVE_INJECTION_PHRASES.some((phrase) => question.includes(phrase)),
    '追问不制造用户没说的叙事',
  );
  assert(!/多久|多长时间|几点/.test(question), '不追问用户已说「不记得」的准确时间');
}

/* ------------------ F · 不制造用户没说的叙事 ------------------ */
function testNoNarrativeInjection(): void {
  console.log('\n========== F · 不制造叙事（no injection） ==========');
  const text = '我突然想起来一个事。';

  const understanding = heuristicUnderstand({
    messages: [{ role: 'user', text }],
    memory: createEmptyMemory(),
    userTurn: 1,
    userText: text,
  });
  assert(
    (understanding.memoryPatch?.turning_points ?? []).length === 0,
    '「我突然想起来一个事」不被误判为转折（无 turning_point）',
  );

  const candidates = heuristicCandidates({
    memory: createEmptyMemory(),
    clues: understanding.newClues,
    signals: understanding.signals,
    state: 'OPENING',
    userText: text,
    askingAlready: [],
    transcript: `用户：${text}`,
    missing: [],
    resumed: false,
    recentAcks: [],
    vagueNote: '',
    keepGoing: false,
    anchorWords: [],
  });
  assert(
    candidates.every(
      (candidate) => !NARRATIVE_INJECTION_PHRASES.some((phrase) => candidate.question.includes(phrase)),
    ),
    '候选问题里不出现「事情后来变了样子」等叙事注入',
  );

  // 规则层兜底：即便候选被注入，也会被拦下
  const outcome = applyHardRules(
    [
      {
        ack: '嗯，我记下了。',
        question: '事情后来变了样子。在那之前和之后，最大的不一样是什么？',
        ask: true,
        target_clue: '一个事',
        story_value: 5,
        user_initiative: 3,
        emotional_signal: 3,
        information_gain: 3,
        willingness: 3,
        disturbance_cost: 2,
        sensitivity_risk: 1,
      },
    ],
    { signals: emptySignals(), memory: createEmptyMemory(), userText: text, askedQuestions: [] },
  );
  assert(outcome.kept.length === 0, '规则层拦下「事情后来变了样子」这类叙事注入');
}

function main(): void {
  testTopicDecline();
  testSessionEnd();
  testProductVsStory();
  testSceneAnchoring();
  testNoNarrativeInjection();

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
