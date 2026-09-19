/**
 * Phase 6 · 第一轮体验发现后的最小修复回归（F1 / F2）。
 *
 * F1：弱结束表达（不说了/不聊了）不得被误判为「结束整场」；
 *     真正结束整场仍照旧；拒绝话题时若同句给了新入口，直接承接。
 * F2：用户明确说「记不清 / 不确定」的某类事实（时间/人物/地点），后续不得再追问。
 *
 * 不联网，全部走确定性代码。用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/f1f2ExperienceRegression.test.ts
 */
import {
  applyHardRules,
  buildForcedReply,
  detectEndIntent,
  detectUnknownFacts,
  questionSeeksCategories,
  resolveIntent,
} from '../src/services/rules';
import { usableLadder } from '../src/services/interviewService';
import { ENTRY_LADDER } from '../src/data/ladders';
import { beginsNewSessionAfterEnd, deriveConversationStatus } from '../src/machines/interviewMachine';
import { createEmptyMemory } from '../src/types/interview';
import type { CandidateQuestion, UserSignals } from '../src/types/interview';

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

function candidate(question: string, ack = '嗯，我记下了。'): CandidateQuestion {
  return {
    id: 'q',
    ack,
    question,
    ask: true,
    target_clue: 'x',
    story_value: 3,
    user_initiative: 3,
    emotional_signal: 2,
    information_gain: 3,
    willingness: 3,
    disturbance_cost: 2,
    sensitivity_risk: 1,
  };
}

function blocked(question: string, unknownFacts: ('time' | 'person' | 'place')[]): boolean {
  const outcome = applyHardRules([candidate(question)], {
    signals: emptySignals(),
    memory: createEmptyMemory(),
    userText: '（测试输入）',
    askedQuestions: [],
    unknownFacts,
  });
  return outcome.kept.length === 0;
}

/* ---------------------------- F1 ---------------------------- */
function testF1(): void {
  console.log('\n========== F1 · 弱结束 ≠ 结束整场 ==========');

  // 1. 「这个先不说了」→ 放下当前话题，不结束整场
  assert(resolveIntent('这个先不说了。') === 'topic_decline', '「这个先不说了」→ topic_decline（不结束）');
  assert(detectEndIntent('这个先不说了。') === 'topic_decline', 'detectEndIntent 同判 topic_decline（不是 end）');

  // 2. 「算了，这个先不聊。」
  assert(resolveIntent('算了，这个先不聊。') === 'topic_decline', '「算了，这个先不聊」→ topic_decline（不结束）');

  // 3. 真正结束整场仍照旧
  assert(resolveIntent('今天先到这里吧。') === 'session_end', '「今天先到这里吧」→ session_end');
  assert(resolveIntent('今天就聊到这儿。') === 'session_end', '「今天就聊到这儿」→ session_end');
  assert(resolveIntent('算了，我今天先不聊了') === 'session_end', '「算了，我今天先不聊了」→ session_end（弱结束 + 今天）');
  assert(resolveIntent('这个先不说，今天先到这里') === 'session_end', '「这个先不说，今天先到这里」→ session_end（强结束优先）');

  // 4. 拒绝话题 + 同句新入口 → 直接承接（不套固定话术）
  const withEntry = '这个先不说了。对了，我妈那件事我倒是可以讲。';
  assert(resolveIntent(withEntry) === 'topic_decline', '「这个先不说了。对了，我妈那件事…」仍是 topic_decline');
  assert(
    buildForcedReply(emptySignals(), withEntry, { hasSubstance: true }) === null,
    '同句带新入口 → 不套固定 REFUSE_TEXT（交给候选承接新入口）',
  );
  assert(
    buildForcedReply(emptySignals(), '这个先不说了。', {}) !== null,
    '只有拒绝、没有新入口 → 仍给固定「换入口」话术',
  );

  // 5. 拒绝话题后下一轮继续说 → Session 仍 active
  assert(resolveIntent('我妈那件事我一直记着。') === 'continue', '下一轮正常讲述 → continue');
  assert(deriveConversationStatus('EXPLORING', false) === 'active', 'topic decline 后 Session 仍 active');
  assert(detectEndIntent('这个先不说了。') !== 'end', 'topic decline 不会走 end 分支（UI 不会跳故事页）');

  // 6. 结束整场后，下一句不得被自动接受为同一 Session
  assert(deriveConversationStatus('SUMMARY_CONFIRM', true) === 'ended', '已结束的会话保持 ended');
  assert(beginsNewSessionAfterEnd(true) === true, '已结束 → 下一句另起新 session');
  assert(beginsNewSessionAfterEnd(false) === false, '未结束 → 正常续在同一段会话');
  assert(resolveIntent('嗯，你好。') === 'continue', '结束后的普通一句不会被自动当成要故事/结束');
}

/* ---------------------------- F2 ---------------------------- */
function testF2(): void {
  console.log('\n========== F2 · 已声明「记不清」的事实不再追问 ==========');

  // 1. 年份记不清 → time
  assert(detectUnknownFacts(['哪一年我不记得了。']).includes('time'), '「哪一年我不记得了」→ 记住 time 已不确定');
  assert(blocked('那大概是哪一年？', ['time']), '「那大概是哪一年？」被拦下');
  assert(blocked('你还记得具体什么时候吗？', ['time']), '「你还记得具体什么时候吗？」被拦下');
  assert(blocked('是高中还是大学？', ['time']), '「是高中还是大学？」（变相追问时间）被拦下');

  // 2. 时间不确定 → time
  assert(detectUnknownFacts(['具体时间不确定。']).includes('time'), '「具体时间不确定」→ time 已不确定');

  // 3. 人物记不清 → person
  assert(detectUnknownFacts(['我也不知道是谁。']).includes('person'), '「我也不知道是谁」→ 记住 person 已不确定');
  assert(blocked('那个人叫什么名字？', ['person']), '「那个人叫什么名字？」被拦下');

  // 4. 只泛泛说"记不清"，但同句给了新信息（雨）→ 不把时间视为已声明，且承接新信息
  const rainText = '我记不清了，不过我记得那天下了很大的雨。';
  assert(!detectUnknownFacts([rainText]).includes('time'), '「记不清了…但记得下大雨」不把 time 标为已声明');
  assert(!blocked('那场雨里，你最先想起来的是什么？', []), '承接「雨」的追问不被拦下');
  assert(
    !blocked('那场雨里，你最先想起来的是什么？', ['time']),
    '即使 time 已知不确定，「雨」这种非时间追问也不受影响',
  );
  assert(!blocked('后来发生了什么？', ['time']), '换入口问「后来发生了什么」被放行');

  // 阶梯：时间入口被跳过，其它入口保留
  const ids = usableLadder(ENTRY_LADDER, ['time']).map((step) => step.id);
  assert(!ids.includes('time'), '已知 time 不确定 → 入口阶梯跳过「时间入口」');
  assert(ids.includes('scene') && ids.includes('people'), '其它入口仍然保留');
  assert(
    usableLadder(ENTRY_LADDER, []).some((step) => step.id === 'time'),
    '未声明 time 不确定时，时间入口仍然可用',
  );

  // 追问类别识别
  assert(questionSeeksCategories('那是什么时候的事？').includes('time'), '「那是什么时候的事」识别为追问时间');
  assert(questionSeeksCategories('是在学校还是在家里？').includes('place'), '「是在学校还是在家里」识别为追问地点');
}

function main(): void {
  testF1();
  testF2();
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
