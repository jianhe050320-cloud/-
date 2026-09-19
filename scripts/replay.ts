/**
 * 逻辑回放：不依赖浏览器，直接跑完整采访链路。
 *
 * 用法（复用工程里已装好的 tsx）：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/replay.ts
 *
 * 它回答的是这个产品唯一重要的问题：
 *   「AI 到底是在执行问答，还是在理解一个正在发生的人生故事？」
 */
import type { Clue, InterviewState, StoryMemory } from '../src/types/interview';
import { createEmptyMemory } from '../src/types/interview';
import { runTurn } from '../src/services/interviewService';
import { DEMO_SCRIPTS, LEAVING_HOME_BEATS, LEAVING_HOME_STORY } from '../src/data/demoScript';
import { BADCASE_INPUTS } from '../src/data/seed';
import { checkAck } from '../src/services/ackGuard';
import { hasFabrication, lintStory, type ViolationKind } from '../src/services/storyLint';

const TOPIC = { id: 'first_leave_home', label: '第一次离开家' };

interface Session {
  state: InterviewState;
  scriptStep: number;
  memory: StoryMemory;
  clues: Clue[];
  highValueClues: string[];
  messages: { role: 'user' | 'assistant'; text: string }[];
}

function newSession(): Session {
  return {
    state: 'START',
    // 开场白（剧本第 0 条）已经说过
    scriptStep: 1,
    memory: createEmptyMemory(),
    clues: [],
    highValueClues: [],
    messages: [{ role: 'assistant', text: LEAVING_HOME_BEATS[0].ai }],
  };
}

async function send(session: Session, userText: string) {
  const output = await runTurn({
    topicId: TOPIC.id,
    topicLabel: TOPIC.label,
    state: session.state,
    scriptStep: session.scriptStep,
    memory: session.memory,
    clues: session.clues,
    highValueClues: session.highValueClues,
    messages: session.messages,
    userText,
  });
  session.messages = [
    ...session.messages,
    { role: 'user', text: userText },
    { role: 'assistant', text: output.result.reply },
  ];
  session.state = output.result.state;
  session.scriptStep = output.scriptStep;
  session.memory = output.result.memory;
  session.clues = output.clues;
  session.highValueClues = output.highValueClues;
  return output.result;
}

function line(text: string, limit = 78): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

async function replayScript(): Promise<{ multiQuestion: string[] }> {
  console.log('\n================ 测试集 test_conversation_01《第一次离开家》 ================\n');
  console.log(`采访者：${LEAVING_HOME_BEATS[0].ai}\n`);

  const session = newSession();
  const multiQuestion: string[] = [];

  for (let turn = 1; turn <= 14; turn += 1) {
    // beats[k].sampleUser 是「第 k+1 轮」用户说的那句话，所以第 N 轮取 beats[N-1]
    const beat = LEAVING_HOME_BEATS[Math.min(turn - 1, LEAVING_HOME_BEATS.length - 1)];
    const userText = beat.sampleUser ?? '';
    const result = await send(session, userText);

    const questionCount = (result.reply.match(/[？?]/g) ?? []).length;
    if (questionCount > 1) multiQuestion.push(`第 ${turn} 轮：${result.reply}`);

    console.log(`【第 ${turn} 轮】用户：${line(userText, 60)}`);
    console.log(`        采访者：${line(result.reply, 100)}`);
    console.log(
      `        └ 状态 ${result.state}${result.branch ? ` / 分支 ${result.branch}` : ''}` +
        ` · 完整度 ${(result.observer.completeness * 100).toFixed(0)}%` +
        ` · 问号数 ${questionCount}`,
    );
    console.log(
      `        └ 候选 ${result.observer.candidates.length} 个` +
        `（拦下 ${result.observer.candidates.filter((candidate) => candidate.blocked).length} 个）` +
        ` · 选中 ${result.observer.selected?.priority ?? '—'} / score ${result.observer.selected?.score ?? '—'}`,
    );
    if (result.observer.highValueClues.length) {
      console.log(`        └ 高价值线索：${result.observer.highValueClues.join(' ｜ ')}`);
    }
    if (result.observer.ruleHits.length) {
      console.log(`        └ 命中判断：${result.observer.ruleHits.join(' / ')}`);
    }
    console.log('');
  }

  console.log('---------------- 最终结构化 Memory ----------------');
  const memory = session.memory;
  console.log(`人物：${memory.people.map((p) => `${p.name}(${p.importance}★)`).join('、') || '—'}`);
  console.log(`事件：${memory.events.map((e) => e.description).join('；') || '—'}`);
  console.log(`情绪：${memory.emotions.map((e) => e.emotion).join('、') || '—'}`);
  console.log(
    `转折：${memory.turning_points
      .map((t) => `${t.before} → ${t.after}（因为${t.trigger}）`)
      .join('；') || '—'}`,
  );
  console.log(`细节：${memory.details.map((d) => d.detail).join('；') || '—'}`);
  console.log(
    `主题 L4（未确认）：${memory.meaning.filter((m) => !m.confirmed_by_user).map((m) => m.interpretation).join('；') || '—'}`,
  );
  console.log(
    `对用户的理解 L5（已确认）：${memory.meaning.filter((m) => m.confirmed_by_user).map((m) => m.interpretation).join('；') || '—'}`,
  );
  console.log(`故事状态：${memory.story_status}`);
  console.log(`\n最终故事标题：${LEAVING_HOME_STORY.title}（${LEAVING_HOME_STORY.content.length} 字）`);

  return { multiQuestion };
}

async function replayBadcases(): Promise<void> {
  console.log('\n================ 10 种刻意攻击输入 ================\n');
  for (const item of BADCASE_INPUTS) {
    const session = newSession();
    const result = await send(session, item.text);
    const questionCount = (result.reply.match(/[？?]/g) ?? []).length;
    console.log(`输入「${item.text}」`);
    console.log(`  采访者：${line(result.reply, 110)}`);
    console.log(
      `  └ 状态 ${result.state}${result.branch ? ` / 分支 ${result.branch}` : ''}` +
        ` · 问号数 ${questionCount} · 判断：${result.observer.ruleHits.join(' / ') || '（常规追问）'}`,
    );
    console.log('');
  }
}

/**
 * 复现线上截图里的场景：非剧本话题（没有手写台词）+ 用户重复自己。
 * 断言：绝不出现连续两条一模一样的回复。
 */
async function replayNonScriptTopic(): Promise<string[]> {
  console.log('\n================ 非剧本话题 · 重复与敷衍输入 ================\n');
  const OPENING = '您还记得第一次来到大学的那天吗？那时候是什么样子的？';
  const session: Session = {
    state: 'START',
    scriptStep: 1,
    memory: createEmptyMemory(),
    clues: [],
    highValueClues: [],
    messages: [{ role: 'assistant', text: OPENING }],
  };
  console.log(`采访者：${OPENING}\n`);

  const inputs = [
    '没去过大学的我而言。爸妈教我问路的时候要礼貌，我们绕了一大圈才走到了去报道的地方',
    '这有什么好讲的，就是坐绿皮火车过来的呀',
    '这有什么好讲的，就是坐绿皮火车过来的呀',
    '这有什么好讲的，就是坐绿皮火车过来的呀',
    '那年我十八岁，一个人拎着两个编织袋',
    '那年我十八岁，一个人拎着两个编织袋',
  ];

  const repeats: string[] = [];
  let previousReply = OPENING;
  const recent: string[] = [];

  for (const userText of inputs) {
    const output = await runTurn({
      topicId: 'first_university',
      topicLabel: '第一次来到大学',
      state: session.state,
      scriptStep: session.scriptStep,
      memory: session.memory,
      clues: session.clues,
      highValueClues: session.highValueClues,
      messages: session.messages,
      userText,
    });
    const reply = output.result.reply;
    const identical = reply === previousReply;
    const echoedEarlier = !identical && recent.slice(-2).includes(reply);
    if (identical) repeats.push(reply);

    console.log(`用户：${line(userText, 46)}`);
    console.log(
      `采访者：${line(reply, 74)}${identical ? '   ← ✗ 与上一句完全相同' : echoedEarlier ? '   ← ⚠ 与前两句之一相同' : ''}`,
    );
    console.log(
      `        └ 引擎 ${output.result.engine} · 问号数 ${(reply.match(/[？?]/g) ?? []).length}` +
        (output.result.observer.ruleHits.length ? ` · ${output.result.observer.ruleHits.join(' / ')}` : ''),
    );
    console.log('');

    session.messages = [
      ...session.messages,
      { role: 'user', text: userText },
      { role: 'assistant', text: reply },
    ];
    session.state = output.result.state;
    session.scriptStep = output.scriptStep;
    session.memory = output.result.memory;
    session.clues = output.clues;
    session.highValueClues = output.highValueClues;
    previousReply = reply;
    recent.push(reply);
  }

  return repeats;
}

/**
 * 通用：把任意一个手写剧本完整跑一遍。
 * 检查两件事：每轮只问一个核心问题；最后一轮必须主动收尾而不是继续追问。
 */
async function replayTopicScript(
  topicId: string,
  label: string,
): Promise<{ multiQuestion: string[]; closed: boolean; sawRecap: boolean }> {
  const script = DEMO_SCRIPTS[topicId];
  console.log(`\n================ 演示剧本《${script.story.title}》（话题：${label}） ================\n`);
  console.log(`采访者：${script.beats[0].ai}\n`);

  const session: Session = {
    state: 'START',
    scriptStep: 1,
    memory: createEmptyMemory(),
    clues: [],
    highValueClues: [],
    messages: [{ role: 'assistant', text: script.beats[0].ai }],
  };

  const multiQuestion: string[] = [];
  let lastReply = script.beats[0].ai;
  // 收尾前应该主动回顾一次整段故事（原则 9）
  let sawRecap = false;

  for (let turn = 1; turn < script.beats.length; turn += 1) {
    const userText = script.beats[turn - 1].sampleUser ?? '';
    const output = await runTurn({
      topicId,
      topicLabel: label,
      state: session.state,
      scriptStep: session.scriptStep,
      memory: session.memory,
      clues: session.clues,
      highValueClues: session.highValueClues,
      messages: session.messages,
      userText,
    });
    const reply = output.result.reply;
    const marks = (reply.match(/[？?]/g) ?? []).length;
    if (marks > 1) multiQuestion.push(`第 ${turn} 轮：「${reply}」`);
    lastReply = reply;
    if (output.result.recap) {
      sawRecap = true;
      console.log(`\n【记忆板回执】${output.result.recap}\n`);
    }

    console.log(`用户：${line(userText, 52)}`);
    console.log(`采访者：${line(reply, 76)}`);
    console.log(
      `        └ 状态 ${output.result.state} · 完整度 ${(output.result.observer.completeness * 100).toFixed(0)}%`,
    );

    session.messages = [
      ...session.messages,
      { role: 'user', text: userText },
      // 记忆板回执在真实 app 里也是一条独立消息，回放要跟它保持一致，
      // 否则「同一句回执不重复」这条规则在回放里根本测不到
      ...(output.result.recap ? [{ role: 'assistant' as const, text: output.result.recap }] : []),
      { role: 'assistant', text: reply },
    ];
    session.state = output.result.state;
    session.scriptStep = output.scriptStep;
    session.memory = output.result.memory;
    session.clues = output.clues;
    session.highValueClues = output.highValueClues;
  }

  // 收尾判据：最后一轮应该主动提出整理，而不是又在追问
  const closed = /整理|完整/.test(lastReply) && !/吗？|呢？/.test(lastReply);
  console.log(
    closed
      ? '\n✓ 最后一轮主动收尾：提出「先替您整理下来」而不是继续追问。'
      : `\n✗ 最后一轮没有主动收尾：「${lastReply}」`,
  );

  return { multiQuestion, closed, sawRecap };
}

/**
 * 结束即产出：复现线上截图里那两句原话，确认意图被正确识别。
 * 用户说「聊完了」或「帮我生成故事」时，必须给出 end / story_request，UI 才能立刻交出故事。
 */
async function replayIntents(): Promise<string[]> {
  console.log('\n================ 结束意图 / 要故事意图 ================\n');
  const failures: string[] = [];

  const cases: { input: string; expect: 'end' | 'story_request' | 'continue' }[] = [
    { input: '好的，就先讲到这里了', expect: 'end' },
    { input: '算了，不聊了', expect: 'end' },
    { input: '你现在可以帮助生成故事吗，我怎么看不到我故事已经生成了', expect: 'story_request' },
    { input: '你什么时候帮助我生成好我的故事呢', expect: 'story_request' },
    // 「不想说这一件」是换话题，不是结束整场，绝不能顺手把故事交出去
    { input: '这个我不太想说。', expect: 'continue' },
    { input: '算了，不聊这个了。', expect: 'continue' },
    { input: '那时候我其实特别怕读不下去', expect: 'continue' },
  ];

  for (const item of cases) {
    const output = await runTurn({
      topicId: 'first_university',
      topicLabel: '第一次来到大学',
      state: 'DEEPENING',
      scriptStep: 1,
      memory: createEmptyMemory(),
      clues: [],
      highValueClues: [],
      messages: [{ role: 'assistant', text: '后来是什么时候开始变得不一样的？' }],
      userText: item.input,
    });
    const { intent, reply, observer } = output.result;
    const ok = intent === item.expect;
    if (!ok) failures.push(`「${item.input}」期望 ${item.expect}，实际 ${intent}`);

    console.log(`用户：${line(item.input, 46)}`);
    console.log(`意图：${intent}${ok ? '' : `   ← ✗ 期望 ${item.expect}`}`);
    console.log(`采访者：${line(reply, 74)}`);
    console.log(`        └ ${observer.ruleHits.slice(0, 3).join(' / ')}`);
    console.log('');
  }

  return failures;
}

/**
 * 复现线上截图那段对话：
 *   AI：他送您回家那次，您还记得路上是什么样吗？
 *   用户：已经不记得了，奶奶告诉我，她拿着小推车把我放在上面，从幼儿园推回了我老家。我听到了觉得很触动。
 *
 * 以前的回答是「不用着急，您可以慢慢想」——把用户给的整段细节全丢了。
 * 断言：这种回复里不许再出现任何「慢慢想 / 换个话题」的劝退话术。
 */
async function replayVagueMemory(): Promise<string[]> {
  console.log('\n================ 「不记得」但不许丢掉用户已经给出的细节 ================\n');
  const failures: string[] = [];
  const BAD = ['不用着急', '换一件事', '换个角度', '说点别的', '换个话题'];

  const session = {
    state: 'DEEPENING' as InterviewState,
    scriptStep: 1,
    memory: createEmptyMemory(),
    clues: [] as Clue[],
    highValueClues: [] as string[],
    messages: [
      { role: 'assistant' as const, text: '奶奶要是不说，这事可能就沉下去了。他送您回家那次，您还记得路上是什么样吗？' },
    ],
  };

  const inputs = [
    '已经不记得了，奶奶告诉我，她拿着小推车把我放在上面，从幼儿园推回了我老家。我听到了觉得很触动。',
    '已经想不起来了',
    '可以继续讲讲这件事呀',
  ];

  for (const userText of inputs) {
    const output = await runTurn({
      topicId: 'people_remember',
      topicLabel: '一个我一直记得的人',
      state: session.state,
      scriptStep: session.scriptStep,
      memory: session.memory,
      clues: session.clues,
      highValueClues: session.highValueClues,
      messages: session.messages,
      userText,
    });
    const reply = output.result.reply;
    const hit = BAD.find((word) => reply.includes(word));
    if (hit) failures.push(`「${userText}」→ 回复出现了「${hit}」：${reply}`);

    console.log(`用户：${line(userText, 48)}`);
    console.log(`采访者：${line(reply, 74)}${hit ? `   ← ✗ 出现了「${hit}」` : '   ← ✓'}`);
    console.log('');

    session.messages = [
      ...session.messages,
      { role: 'user', text: userText },
      { role: 'assistant', text: reply },
    ];
    session.state = output.result.state;
    session.scriptStep = output.scriptStep;
    session.memory = output.result.memory;
    session.clues = output.clues;
    session.highValueClues = output.highValueClues;
  }

  return failures;
}

/**
 * 接住质检（原则 1）。
 * 断言：真正复述了用户原话的接住能通过；空泛的接住必须被判不合格。
 */
function replayAckGuard(): string[] {
  console.log('\n================ 接住质检（原则 1） ================\n');
  const failures: string[] = [];
  const userTexts = [
    '我当时努力了一段时间，但是成绩就是没有起色，很难受',
    '我其实特别怕读不下去，怕给家里丢脸',
  ];

  const cases: { ack: string; expect: boolean; label: string }[] = [
    {
      ack: '你刚才说，自己其实努力了一段时间，但成绩还是没有起色。',
      expect: true,
      label: '复述了「努力了一段时间」「成绩」→ 应该通过',
    },
    { ack: '嗯，我听到了。', expect: false, label: '纯空话 → 应该不合格' },
    { ack: '原来是这样。这跟我想的不太一样。', expect: false, label: '有理解但没复述 → 应该不合格' },
    {
      ack: '你说特别怕读不下去，还怕给家里丢脸，这两件事压在一起。',
      expect: true,
      label: '复述了「怕读不下去」「给家里丢脸」→ 应该通过',
    },
  ];

  for (const item of cases) {
    const check = checkAck(item.ack, userTexts);
    const ok = check.ok === item.expect;
    if (!ok) failures.push(`「${item.ack}」期望 ${item.expect}，实际 ${check.ok}（${check.reason}）`);
    console.log(`${ok ? '✓' : '✗'} ${item.label}`);
    console.log(`   ${item.ack}`);
    console.log(`   → ${check.ok ? '合格' : '不合格'}：${check.reason}\n`);
  }

  return failures;
}

/**
 * 故事质检（原则 10）。
 * 用你给的 badcase 原文构造故事，断言能被抓住。
 */
function replayStoryLint(): string[] {
  console.log('\n================ 故事质检（原则 10） ================\n');
  const failures: string[] = [];
  const userTexts = [
    '我好像是98年去的，也可能是99年。我大学毕业以后去了上海。',
    '我妈那时候其实特别辛苦，我一直记得。',
  ];

  const fabricated =
    '那是一个阳光明媚的夏天，我怀着对未来的憧憬踏上了前往上海的列车。1998年，我去了那里。' +
    '我心里其实一直明白，那是命运给我的安排。';
  const violations = lintStory(fabricated, userTexts);
  console.log('【编造版】');
  console.log(fabricated);
  for (const item of violations) console.log(`  ✗ [${item.kind}] ${item.detail}`);
  const caught = new Set(violations.map((item) => item.kind));
  const need: ViolationKind[] = ['uncertainty', 'literary', 'inner_thought'];
  for (const kind of need) {
    if (!caught.has(kind)) failures.push(`编造版没有被抓到「${kind}」`);
  }
  console.log(
    hasFabrication(violations)
      ? '  → 判定为「有编造」：会重写一次，仍违规就降级为原话拼装 ✓\n'
      : '  → ✗ 没有被判定为编造\n',
  );

  const faithful =
    '我大学毕业以后去了上海。时间我记不太清了，大概是98年，也可能是99年。' +
    '我妈那时候其实特别辛苦，我一直记得这件事。';
  const clean = lintStory(faithful, userTexts);
  console.log('【忠实版】');
  console.log(faithful);
  for (const item of clean) console.log(`  ✗ [${item.kind}] ${item.detail}`);
  console.log(
    clean.length === 0 ? '  → 没有违规，直接采用 ✓\n' : `  → ✗ 误报 ${clean.length} 条\n`,
  );
  if (clean.length > 0) failures.push('忠实版被误报');

  return failures;
}

/**
 * 决策菜单（原则 7）。
 * 「你想继续讲、换个角度讲，还是讲其他事情？」看起来尊重，实际是把负担丢给用户。
 * 断言：回复里不许再出现「以问句形式让用户选要不要继续」。
 */
async function replayNoMenu(): Promise<string[]> {
  console.log('\n================ 决策菜单（原则 7） ================\n');
  const failures: string[] = [];
  // 「还是」被写成问句 = 让用户做决定；关于记忆本身的二选一不受限（例如"是身边没人，还是有人但没人懂你"）
  const MENU_QUESTION_RE = /还是[^。！？]{0,14}？/;

  const inputs = [
    '这个我不想说。',
    '算了，不聊这个了。',
    '我觉得也没什么特别的。',
    '我也不太记得了。',
    '这有什么好讲的',
    '这有什么好讲的',
  ];

  const session = {
    state: 'DEEPENING' as InterviewState,
    scriptStep: 1,
    memory: createEmptyMemory(),
    clues: [] as Clue[],
    highValueClues: [] as string[],
    messages: [{ role: 'assistant' as const, text: '那时候你在做什么？' }],
  };

  for (const userText of inputs) {
    const output = await runTurn({
      topicId: 'people_remember',
      topicLabel: '一个我一直记得的人',
      state: session.state,
      scriptStep: session.scriptStep,
      memory: session.memory,
      clues: session.clues,
      highValueClues: session.highValueClues,
      messages: session.messages,
      userText,
    });
    const reply = output.result.reply;
    const hit = MENU_QUESTION_RE.test(reply);
    if (hit) failures.push(`「${userText}」→ ${reply}`);

    console.log(`用户：${line(userText, 40)}`);
    console.log(`采访者：${line(reply, 74)}${hit ? '   ← ✗ 仍是决策菜单' : '   ← ✓'}`);
    console.log('');

    session.messages = [
      ...session.messages,
      { role: 'user', text: userText },
      { role: 'assistant', text: reply },
    ];
    session.state = output.result.state;
    session.scriptStep = output.scriptStep;
    session.memory = output.result.memory;
    session.clues = output.clues;
    session.highValueClues = output.highValueClues;
  }

  return failures;
}

/**
 * 批次 ② 的四条确定性机制：
 *   原则 4 入口轮换 / 原则 3 抽象降维 / 原则 5 节奏控制 / 原则 8 产品提问
 */
async function replayLadders(): Promise<string[]> {
  console.log('\n================ 入口轮换 · 抽象降维 · 节奏控制 · 产品提问 ================\n');
  const failures: string[] = [];

  const memory = createEmptyMemory();
  memory.events = [{ description: '高三那段时间成绩一直没起色', time: '', place: '', importance: 5 }];

  const base = {
    topicId: 'people_remember',
    topicLabel: '一个我一直记得的人',
    scriptStep: 1,
    memory,
    clues: [] as Clue[],
    highValueClues: [] as string[],
  };

  const ask = async (
    messages: { role: 'user' | 'assistant'; text: string }[],
    userText: string,
    state: InterviewState = 'DEEPENING',
  ) => runTurn({ ...base, state, messages, userText });

  /* --- 原则 4：连说三次「不记得」，必须换三次入口 --- */
  console.log('【原则 4 · 换入口，不换故事】原话：不记得了（连说三次）');
  const history: { role: 'user' | 'assistant'; text: string }[] = [
    { role: 'assistant', text: '大概是什么时候的事，你还记得吗？' },
  ];
  const seen: string[] = [];
  for (let round = 1; round <= 3; round += 1) {
    const output = await ask(history, '不记得了');
    const reply = output.result.reply;
    seen.push(reply);
    console.log(`  第 ${round} 次 → ${reply}`);
    history.push({ role: 'user', text: '不记得了' }, { role: 'assistant', text: reply });
  }
  if (new Set(seen).size !== 3) failures.push('连续三次「不记得」没有换到三个不同入口');
  const expected = ['学校', '身边有谁', '感觉是什么'];
  expected.forEach((keyword, index) => {
    if (!seen[index]?.includes(keyword)) {
      failures.push(`第 ${index + 1} 次换入口没落在「${keyword}」上：${seen[index]}`);
    }
  });
  console.log('');

  /* --- 原则 3：抽象判断必须往具体压，且不许问「为什么」 --- */
  console.log('【原则 3 · 抽象 → 具体】原话：我大学过得很迷茫');
  const abstractOut = await ask([], '我大学过得很迷茫');
  console.log(`  → ${abstractOut.result.reply}`);
  if (!abstractOut.result.reply.includes('画面')) failures.push('抽象判断没有压到「画面」这一步');
  if (/为什么/.test(abstractOut.result.reply)) failures.push('抽象判断竟然问了「为什么」');
  console.log('');

  /* --- 原则 5：连续两轮都在提问之后，这一轮必须停留 --- */
  console.log('【原则 5 · 允许停留】前两轮都是问句，这一轮用户只说了一句重的');
  const holdOut = await ask(
    [
      { role: 'assistant', text: '那时候是哪一年？' },
      { role: 'user', text: '高三。' },
      { role: 'assistant', text: '当时身边有谁？' },
      { role: 'user', text: '就我自己。' },
    ],
    '嗯，我知道了。',
  );
  console.log(`  → ${holdOut.result.reply}`);
  if (/[？?]/.test(holdOut.result.reply)) failures.push('连续两轮追问后仍然又追问了');
  console.log('');

  /* --- 原则 8：产品提问必须切到操作模式（含扩展后的各类别） --- */
  console.log('【原则 8 · 用户突然改变意图】');
  const productCases: { input: string; keyword: string }[] = [
    { input: '我怎么才能看到我的故事', keyword: '我的故事' },
    { input: '你能记住多久？会不会忘？', keyword: '留在这一段故事里' },
    { input: '下次还能接着聊吗', keyword: '随时回来' },
    { input: '能分享给别人吗', keyword: '还不能导出' },
    { input: '你是心理咨询师吗', keyword: '不做判断' },
    { input: '还要聊多久啊', keyword: '不看时间' },
  ];
  for (const item of productCases) {
    const out = await ask([], item.input);
    const okIntent = out.result.intent === 'product_question';
    const okReply = out.result.reply.includes(item.keyword);
    if (!okIntent) failures.push(`「${item.input}」意图被识别成 ${out.result.intent}`);
    if (!okReply) failures.push(`「${item.input}」回答里没有「${item.keyword}」：${out.result.reply}`);
    console.log(`  ${okIntent && okReply ? '✓' : '✗'} ${item.input}`);
    console.log(`     → ${out.result.reply}`);
  }
  console.log('');

  return failures;
}

async function main(): Promise<void> {
  const { multiQuestion } = await replayScript();
  await replayBadcases();
  const repeats = await replayNonScriptTopic();
  const university = await replayTopicScript('first_university', '第一次来到大学');
  const friend = await replayTopicScript('people_friend', '一个改变过我的朋友');
  const intentFailures = await replayIntents();
  const vagueFailures = await replayVagueMemory();
  const ackFailures = replayAckGuard();
  const lintFailures = replayStoryLint();
  const menuFailures = await replayNoMenu();
  const ladderFailures = await replayLadders();

  console.log('\n================ 结论 ================');
  console.log(
    multiQuestion.length === 0
      ? '✓ 全程没有任何一轮出现多个问号：一次只问一个核心问题。'
      : `✗ 有 ${multiQuestion.length} 轮出现连环追问：\n${multiQuestion.join('\n')}`,
  );
  console.log(
    repeats.length === 0
      ? '✓ 没有出现连续两条一模一样的回复：不会被用户看成死循环。'
      : `✗ 有 ${repeats.length} 次复读：\n${repeats.join('\n')}`,
  );
  const allClosed = university.closed && friend.closed;
  console.log(allClosed ? '✓ 两个新剧本都能自己走到收尾。' : '✗ 有新剧本没能自己收尾。');
  console.log(
    intentFailures.length === 0
      ? '✓ 结束意图 / 要故事意图识别全部正确（结束即产出的前提）。'
      : `✗ 意图识别有误：\n${intentFailures.join('\n')}`,
  );
  console.log(
    vagueFailures.length === 0
      ? '✓ 用户说「不记得」时不会丢掉他已经给出的细节，也不会用「慢慢想 / 换话题」劝退。'
      : `✗ 仍然出现了劝退式回复：\n${vagueFailures.join('\n')}`,
  );
  console.log(
    ackFailures.length === 0
      ? '✓ 接住质检：会复述原话的接住通过，空泛的接住被判不合格。'
      : `✗ 接住质检有误：\n${ackFailures.join('\n')}`,
  );
  console.log(
    lintFailures.length === 0
      ? '✓ 故事质检：编造版被抓（年份/文学化/心理活动），忠实版不误报。'
      : `✗ 故事质检有误：\n${lintFailures.join('\n')}`,
  );
  console.log(
    menuFailures.length === 0
      ? '✓ 决策菜单已清除：不会再以问句形式让用户决定「要不要继续」。'
      : `✗ 仍然存在决策菜单：\n${menuFailures.join('\n')}`,
  );
  console.log(
    ladderFailures.length === 0
      ? '✓ 换入口 / 抽象降维 / 允许停留 / 产品提问，四条确定性机制全部生效。'
      : `✗ 批次② 的机制有问题：\n${ladderFailures.join('\n')}`,
  );
  console.log(
    university.sawRecap
      ? '✓ 收尾前会主动回顾整段故事（记忆板回执）。'
      : '✗ 收尾时没有给出整段回顾。',
  );
}

void main();
