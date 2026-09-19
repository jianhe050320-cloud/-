/**
 * Phase 5-2 · 「取消整理」意图边界回归。
 *
 * 只验证一件事：STORY_REQUEST 之后用户改主意说「算了，先不用整理了」，
 * 应当被识别为 CANCEL_STORY_REQUEST（取消动作），而不是 TOPIC_DECLINE / SESSION_END。
 *
 * 覆盖需求里的 7 条测试，外加「拒绝话题 + 新入口」的现状观察。
 * 不联网，全部走确定性代码（resolveIntent / buildForcedReply / maturity）。
 *
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/cancelStoryRequest.test.ts
 */
import {
  buildForcedReply,
  detectEndIntent,
  detectPendingStoryRequest,
  resolveIntent,
  strengthenSignals,
} from '../src/services/rules';
import { classifyMemory, isWorthSaving } from '../src/machines/interviewMachine';
import { mergeMemory } from '../src/services/memoryService';
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

const STORY_REQUEST_TURN = '现在帮我整理一下。';
const STORY_REQUEST_REPLY = '好，我这就把您刚才讲的整理出来，您看一下。';

function afterStoryRequest(): { role: 'user' | 'assistant'; text: string }[] {
  return [
    { role: 'user', text: STORY_REQUEST_TURN },
    { role: 'assistant', text: STORY_REQUEST_REPLY },
  ];
}

/* ---------- 1. STORY_REQUEST → CANCEL_STORY_REQUEST ---------- */
function testCancel(): void {
  console.log('\n========== 1. STORY_REQUEST → CANCEL_STORY_REQUEST ==========');
  const messages = afterStoryRequest();
  const pending = detectPendingStoryRequest(messages, 'EXPLORING');
  assert(pending === true, '上一轮刚请求整理 → pendingStoryRequest = true');

  const ctx = { pendingStoryRequest: pending };
  assert(resolveIntent('算了，先不用整理了。', ctx) === 'cancel_story_request', '「算了，先不用整理了」→ cancel_story_request');
  assert(resolveIntent('先不用整理了', ctx) === 'cancel_story_request', '「先不用整理了」→ cancel_story_request');
  assert(resolveIntent('还是算了，不整理了', ctx) === 'cancel_story_request', '「还是算了，不整理了」→ cancel_story_request');
  assert(resolveIntent('不用帮我整理了', ctx) === 'cancel_story_request', '「不用帮我整理了」→ cancel_story_request');
  assert(resolveIntent('我先不想整理了', ctx) === 'cancel_story_request', '「我先不想整理了」→ cancel_story_request');
  assert(resolveIntent('算了，暂时不用整理', ctx) === 'cancel_story_request', '「算了，暂时不用整理」→ cancel_story_request');

  // 不是结束、不是拒绝话题
  assert(resolveIntent('算了，先不用整理了。', ctx) !== 'session_end', '取消整理 → 不是 session_end');
  assert(resolveIntent('算了，先不用整理了。', ctx) !== 'topic_decline', '取消整理 → 不是 topic_decline');
  assert(resolveIntent('算了，先不用整理了。', ctx) !== 'story_request', '取消整理 → 不是 story_request');
  assert(detectEndIntent('算了，先不用整理了。', ctx) === null, 'detectEndIntent 对取消整理返回 null');

  const forced = buildForcedReply(emptySignals(), '算了，先不用整理了。', { pendingStoryRequest: pending });
  assert(forced !== null && forced.reason.includes('取消整理'), '硬规则命中「取消整理」');
  assert(forced !== null && !forced.text.includes('整理出来'), '取消整理 → 不宣称「整理出来」');
  assert(forced !== null && !forced.text.includes('今天先到这里'), '取消整理 → 不结束整场');
  assert(forced !== null && !forced.text.includes('不想说就不说'), '取消整理 → 不套用拒绝话题话术');

  // 「算了」常让模型把 wantsToStop 判成 true；取消整理要把它纠正回 false，否则会被当成结束整场
  const stopped = strengthenSignals({ ...emptySignals(), wantsToStop: true }, '算了，先不用整理了。');
  assert(stopped.wantsToStop === false, '取消整理 → 纠正模型误判的 wantsToStop（不结束整场）');

  // 无 MemoryEntry of refusal：取消整理本身不该成为值得长期留存的记忆
  const refusalMemory = mergeMemory(createEmptyMemory(), { user_quotes: ['算了，先不用整理了。'] });
  assert(isWorthSaving(refusalMemory) === false, '取消整理本身 → 不值得自动留存（无 MemoryEntry）');
  assert(
    classifyMemory({ memory: refusalMemory, messages: [{ role: 'user', text: '算了，先不用整理了。' }] }) === 'seed',
    '取消整理 → 分类为 seed（不产生 Story 级产物）',
  );
}

/* ---------- 2. STORY_REQUEST → CANCEL → CONTINUE ---------- */
function testCancelThenContinue(): void {
  console.log('\n========== 2. STORY_REQUEST → CANCEL → CONTINUE ==========');
  const ctx = { pendingStoryRequest: true };
  assert(resolveIntent('算了，先不用整理了。', ctx) === 'cancel_story_request', '先取消整理');
  const resume = '那我们继续刚才那个吧。';
  assert(resolveIntent(resume, { pendingStoryRequest: false }) === 'continue', '取消后说「继续刚才那个」→ continue（恢复采访）');
  assert(resolveIntent(resume, { pendingStoryRequest: false }) !== 'topic_decline', '不把取消动作当成拒绝话题');
  assert(buildForcedReply(emptySignals(), resume, {}) === null, '恢复采访 → 不套固定话术，回到正常追问');
}

/* ---------- 3. TOPIC_DECLINE 不被误判 ---------- */
function testTopicDeclineUnchanged(): void {
  console.log('\n========== 3. TOPIC_DECLINE 仍然成立 ==========');
  assert(resolveIntent('这个我不太想说。') === 'topic_decline', '「这个我不太想说」→ topic_decline');
  assert(resolveIntent('这个我不太想说。', { pendingStoryRequest: true }) === 'topic_decline', '即使处在整理上下文，拒绝话题仍是 topic_decline');
  assert(resolveIntent('算了，这个我不太想说。') === 'topic_decline', '「算了，这个我不太想说」→ topic_decline（不是取消整理）');
  const forced = buildForcedReply(emptySignals(), '这个我不太想说。', {});
  assert(forced !== null && forced.reason.includes('拒绝'), '拒绝话题 → REFUSE_TEXT（不含取消整理）');
}

/* ---------- 4. SESSION_END 不被误判 ---------- */
function testSessionEndUnchanged(): void {
  console.log('\n========== 4. SESSION_END 仍然成立 ==========');
  assert(resolveIntent('今天先到这里吧。') === 'session_end', '「今天先到这里吧」→ session_end');
  assert(resolveIntent('今天先到这里吧。', { pendingStoryRequest: true }) === 'session_end', '整理上下文下「今天先到这里」仍是 session_end');
  assert(detectEndIntent('今天就到这里') === 'end', '「今天就到这里」→ end');
  assert(resolveIntent('算了，先不用整理了，今天先到这里') === 'session_end', '取消整理 + 明确结束 → session_end（结束优先）');
}

/* ---------- 5. PRODUCT_QUESTION 不被误判 ---------- */
function testProductQuestionUnchanged(): void {
  console.log('\n========== 5. PRODUCT_QUESTION 仍然成立 ==========');
  assert(resolveIntent('什么时候可以帮我整理？') === 'product_question', '「什么时候可以帮我整理」→ product_question');
  assert(resolveIntent('以后可以帮我整理成故事吗？') === 'product_question', '「以后可以帮我整理吗」→ product_question');
  assert(resolveIntent('什么时候可以帮我整理？', { pendingStoryRequest: true }) === 'product_question', '整理上下文下能力咨询仍是 product_question');
}

/* ---------- 6. STORY_REQUEST 不被误判 ---------- */
function testStoryRequestUnchanged(): void {
  console.log('\n========== 6. STORY_REQUEST 仍然成立 ==========');
  assert(resolveIntent('那现在帮我整理一下。') === 'story_request', '「那现在帮我整理一下」→ story_request');
  assert(resolveIntent('把刚才这段整理成故事') === 'story_request', '「把这段整理成故事」→ story_request');
  const forced = buildForcedReply(emptySignals(), '那现在帮我整理一下。', { pendingStoryRequest: true });
  assert(forced !== null && forced.text.includes('整理出来'), '明确要故事 → 仍然产出');
}

/* ---------- 7. CANCEL + 新入口 ---------- */
function testCancelWithNewEntry(): void {
  console.log('\n========== 7. CANCEL + 新入口 ==========');
  const ctx = { pendingStoryRequest: true };
  const text = '算了，先不用整理了。对了，那只狗你还记得它叫什么名字吗？';
  assert(resolveIntent(text, ctx) === 'cancel_story_request', '取消整理 + 新入口 → cancel_story_request');
  assert(resolveIntent(text, ctx) !== 'story_request', '取消整理 + 新入口 → 不生成故事');
  assert(resolveIntent(text, ctx) !== 'session_end', '取消整理 + 新入口 → 不结束 session');
  assert(
    buildForcedReply(emptySignals(), text, { pendingStoryRequest: true, hasSubstance: true }) === null,
    '取消整理 + 新入口 → 不套固定话术（交给候选承接「那只狗」）',
  );
}

/* ---------- 观察：拒绝话题 + 新入口（本轮不改策略，记录现状） ---------- */
function observeTopicDeclineWithNewEntry(): void {
  console.log('\n========== 观察 · 拒绝话题 + 新入口（现状，待人工判断） ==========');
  const cases = ['这个我不太想说，不过我妈那件事我倒是可以讲。', '这个先不聊了。对了，那会儿你人在哪儿？'];
  for (const text of cases) {
    const intent = resolveIntent(text);
    const forced = buildForcedReply(emptySignals(), text, {});
    console.log(`  · 输入：${text}`);
    console.log(`    intent=${intent} | 固定回复=${forced ? `是（${forced.reason}）` : '否（交给候选承接）'}`);
    assert(intent !== 'story_request', '  不把「拒绝话题+新入口」误判成要故事');
    if (intent === 'session_end') {
      console.log(
        '    [待人工判断] 这句被判为「结束整场」，但用户随后明确给了新入口；「不聊了」的弱结束语义建议人工复核（本轮按要求不改策略）。',
      );
    } else {
      console.log(
        '    [待人工判断] 未结束整场；但确定性 fallback 仍使用固定 REFUSE_TEXT（保守、安全，但不会承接新入口）。',
      );
    }
  }
}

function main(): void {
  testCancel();
  testCancelThenContinue();
  testTopicDeclineUnchanged();
  testSessionEndUnchanged();
  testProductQuestionUnchanged();
  testStoryRequestUnchanged();
  testCancelWithNewEntry();
  observeTopicDeclineWithNewEntry();

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
