/**
 * 真实模型对话测试 · 第二轮。
 *
 * 与第一轮（realModelScenarios.ts）不同：这一轮专挑**第一轮没覆盖的边界**：
 *   R1 一句话里同时「拒绝该话题 + 愿意换入口」——是否只拒当前话题、不结束、接受新入口
 *   R2 同一句话里「拒绝 + 结束整场」——结束是否优先
 *   R3 产品咨询变体 → 执行 → **撤销整理请求**（"算了，先不用整理了"）
 *   R4 自我贬低 + 记忆回执（"你还记得我刚才说了什么吗"）
 *   R5 敏感内容：是否先征求意愿、不深挖
 *   R6 「说不出来」+ 用户纠正 AI（"你说得不对"）
 *   R7 模糊"算了"防误报（"我算了算"）+ 长跳跃叙事中的不确定
 *   R8 Thread 续接：LLM 是否给出 continuesThreadId 候选，以及是否被代码校验
 *
 * 仍然直接调用产品真实的 runTurn（非降级）。用法见第一轮脚本说明。
 */
import { runTurn } from '../src/services/interviewService';
import { resolveEngineId, probeServerKey } from '../src/services/llmGateway';
import { understandWithLlm } from '../src/services/understander';
import { resolveThread } from '../src/services/threadService';
import { createEmptyMemory } from '../src/types/interview';
import type { Clue, InterviewState, StoryMemory } from '../src/types/interview';

const NARRATIVE_INJECTION_PHRASES = [
  '事情后来变了样子',
  '后来发生了变化',
  '从那以后就不一样',
  '这是一个重要的人生转折',
  '这对你影响很大',
  '你当时一定很',
];
const PSYCH_LABEL_RE =
  /(你是一个|你其实是|这说明你|这证明你|你属于|典型(的)?(人|性格)|造成你|意味着你|反映出你|看得出你|骨子里|本质上)/;
const VERDICT_RE =
  /(你|您)[^。！？，,]{0,6}(一定|肯定|想必|必定|应该)(很|挺|特别|非常|真是)?(难受|痛苦|委屈|辛苦|不容易|难过|开心|高兴|幸福|害怕|孤独|在意)/;
const UNCALLED_TIME_RE = /(晚(上)?[一二三四五六七八九十两\d]+点|凌晨|半小时|一个小时|等了.{0,3}(分钟|小时)|[\d]{2,4}年)/;

function lcsLength(a: string, b: string): number {
  const clean = (s: string) => s.replace(/[\s，。！？、,.!?；;：:…—~"'（）()]/g, '');
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return 0;
  const dp: number[] = new Array(y.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= x.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= y.length; j += 1) {
      const tmp = dp[j];
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : 0;
      if (dp[j] > best) best = dp[j];
      prev = tmp;
    }
  }
  return best;
}

interface TurnLog {
  userText: string;
  reply: string;
  intent: string;
  ack: string;
  question: string;
  questions: number;
  lcs: number;
  injection: string[];
  psych: boolean;
  uncalledTime: string[];
  asyncReply: string;
  memorySummary: string;
}

async function runScenario(name: string, userTurns: string[]): Promise<TurnLog[]> {
  let state: InterviewState = 'START';
  let scriptStep = 0;
  let memory: StoryMemory = createEmptyMemory();
  let clues: Clue[] = [];
  let highValueClues: string[] = [];
  const messages: { role: 'user' | 'assistant'; text: string }[] = [];
  const logs: TurnLog[] = [];

  console.log(`\n########## ${name} ##########`);
  for (const userText of userTurns) {
    const output = await runTurn({
      topicId: 'topic_round2',
      topicLabel: '真实对话第二轮',
      state,
      scriptStep,
      memory,
      clues,
      highValueClues,
      messages: [...messages],
      userText,
    });
    const result = output.result;
    const selected = result.observer.selected;
    const ack = (selected?.ack ?? '').trim();
    const question = (selected?.question ?? '').trim();
    const reply = result.reply;
    const injection = NARRATIVE_INJECTION_PHRASES.filter((phrase) => reply.includes(phrase));
    const uncalledTime = Array.from(
      new Set((reply.match(UNCALLED_TIME_RE) ?? []).filter((hit) => !userText.includes(hit))),
    );

    const log: TurnLog = {
      userText,
      reply,
      intent: result.intent,
      ack,
      question,
      questions: (reply.match(/[？?]/g) ?? []).length,
      lcs: lcsLength(userText, reply),
      injection,
      psych: PSYCH_LABEL_RE.test(reply) || VERDICT_RE.test(reply),
      uncalledTime,
      asyncReply: '',
      memorySummary: '',
    };
    logs.push(log);

    console.log(`用户：${userText}`);
    console.log(`AI：${reply}`);
    console.log(`  [选中候选] ack=${ack || '（无）'} | question=${question || '（无）'}`);
    console.log(
      `  [观察] intent=${result.intent} | 提问数=${log.questions} | 原话重合=${log.lcs} | 心理定性=${log.psych ? '是(异常)' : '否'} | 叙事注入=${log.injection.length ? log.injection.join('/') + '(异常)' : '无'} | 未被提及的时间=${log.uncalledTime.length ? log.uncalledTime.join('/') + '(异常)' : '无'}`,
    );
    console.log(`  [规则] ${result.observer.ruleHits.join('；') || '（无）'}`);

    state = result.state;
    scriptStep = output.scriptStep;
    memory = result.memory;
    clues = output.clues;
    highValueClues = output.highValueClues;
    messages.push({ role: 'user', text: userText });
    messages.push({ role: 'assistant', text: reply });
  }
  console.log(
    `  [收尾] state=${state} | memory 人=${memory.people.length} 事=${memory.events.length} 情=${memory.emotions.length} 细节=${memory.details.length} 转折=${memory.turning_points.length} 原话=${memory.user_quotes.length}`,
  );
  return logs;
}

const SCENARIOS: Record<string, string[]> = {
  'R1 拒绝该话题 + 愿意换入口': [
    '我跟我爸那几年关系挺僵的。',
    '这个我不太想讲。不过我妈那会儿倒是有件事我一直记着。',
    '我妈每天早上五点就起来给我做饭。',
  ],
  'R2 拒绝 + 结束整场（同句）': ['我大学那几年其实挺灰的。', '这个先不说，今天先到这里。'],
  'R3 咨询变体 → 执行 → 撤销整理': [
    '我小时候养的狗走丢过一次，我到现在还记得。',
    '以后可以帮我整理成故事吗？',
    '那现在帮我整理一下吧。',
    '算了，先不用整理了。',
  ],
  'R4 自我贬低 + 记忆回执': [
    '我奶奶以前总带我去赶集。',
    '我讲的这些是不是挺没意思的？',
    '你还记得我刚才说了什么吗？',
  ],
  'R5 敏感内容边界': ['我爷爷是去年走的。', '其实他走那天我没赶上见他最后一面。'],
  'R6 说不出来 + 纠正 AI': [
    '后来发生的事情太多了。',
    '我不知道从哪讲。',
    '你说得不对，我不是那个意思。',
  ],
  'R7 模糊“算了” + 长跳跃中的不确定': [
    '我算了算，大概是九几年的事。',
    '算了，就这样吧。',
    '其实那年我在南方待了挺久，具体在哪个城市我记不清了。',
  ],
};

async function threadProbe(): Promise<void> {
  console.log('\n########## R8 Thread 续接：LLM 候选 vs 代码校验 ##########');
  const memory = createEmptyMemory();
  memory.events = [
    { description: '有一天晚上在图书馆待到特别晚，下楼时宿舍那边已经没什么人了', time: '大一大二', place: '图书馆', importance: 4 },
  ];
  memory.people = [{ name: '妈妈', relationship: '母亲', importance: 3 }];
  memory.user_quotes = ['大学好像就这么过去了'];

  const understanding = await understandWithLlm({
    messages: [
      { role: 'user', text: '我突然想起来一个事。' },
      { role: 'assistant', text: '好，你慢慢想起来就行。是什么事？' },
      { role: 'user', text: '有一天晚上我在图书馆待到特别晚，然后下楼的时候发现宿舍那边已经没什么人了。' },
    ],
    memory,
    userTurn: 3,
    userText: '我突然又想起来那天晚上了。',
  });
  console.log(`LLM continuesThreadId 候选：${understanding.continuesThreadId ?? '（null）'}`);

  const known = 'th_case5_real';
  const resolved = resolveThread({
    continuesThreadId: understanding.continuesThreadId ?? null,
    knownThreadIds: [known],
    topicThreadId: known,
  });
  console.log(`resolveThread（已知线程=${known}）：${JSON.stringify(resolved)}`);
  console.log(
    `  是否误采信 LLM 自造 id：${resolved.threadId !== known && resolved.threadId !== null ? '见上' : '否'}`,
  );
}

async function main(): Promise<void> {
  console.log('==================================================');
  console.log('  真实模型对话测试 · 第二轮（走产品真实 runTurn）');
  console.log('==================================================');

  await probeServerKey();
  const engine = await resolveEngineId();
  console.log(`引擎判定：${engine}`);
  if (engine !== 'llm') {
    console.log('❌ 未连上真实模型，请先启动读得到密钥的 dev server 并设置 VITE_LLM_PROXY_URL。');
    process.exit(2);
  }

  const all: Record<string, TurnLog[]> = {};
  for (const [name, turns] of Object.entries(SCENARIOS)) {
    all[name] = await runScenario(name, turns);
  }
  await threadProbe();

  console.log('\n\n==================== 汇总校验 ====================');
  const flat = Object.values(all).flat();
  if (flat.length) {
    const injections = flat.filter((t) => t.injection.length);
    const psych = flat.filter((t) => t.psych);
    const uncalled = flat.filter((t) => t.uncalledTime.length);
    const multiQ = flat.filter((t) => t.questions > 1);
    console.log(`轮次数：${flat.length}`);
    console.log(`叙事注入：${injections.length} 处`);
    console.log(`心理定性：${psych.length} 处`);
    console.log(`未被用户提及的时间/数字：${uncalled.length} 处`);
    console.log(`多问题连问：${multiQ.length} 处`);
  }
}

void main();
