/**
 * 真实模型黑盒复跑（Phase 5 验证）。
 *
 * 与 observeScenarios.ts 不同：本脚本**不**走确定性降级，而是直接调用产品真实的
 * runTurn（LLM1 理解 + LLM2 候选 + 硬规则 + 排序 + 接住质检 + 意图路由），
 * 逐轮把 5 个黑盒案例跑一遍，用来验证：
 *   - P0 意图边界（拒绝话题 / 结束整场 / 产品咨询 / 立即执行）
 *   - P1 承接是否锚定用户刚说的内容、是否出现叙事注入
 *
 * 前置：本机已有一个读得到 .env.local 密钥的 vite dev server（默认 5175）。
 * 用法（PowerShell）：
 *   $env:VITE_LLM_PROXY_URL='http://localhost:5175'
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/realModelScenarios.ts
 */
import { runTurn } from '../src/services/interviewService';
import { resolveEngineId, probeServerKey } from '../src/services/llmGateway';
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
const UNCALLED_TIME_RE = /(晚(上)?[一二三四五六七八九十两\d]+点|凌晨|半小时|一个小时|多久了|等了.{0,3}(分钟|小时)|那年|某年|[\d]{2,4}年)/;

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
  engine: string;
  ack: string;
  question: string;
  questions: number;
  lcs: number;
  injection: string[];
  psych: boolean;
  uncalledTime: string[];
  ruleHits: string[];
  replyCandidateCount: number;
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
      topicId: 'topic_real',
      topicLabel: '真实模型复跑',
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
      engine: result.engine,
      ack,
      question,
      questions: (reply.match(/[？?]/g) ?? []).length,
      lcs: lcsLength(userText, reply),
      injection,
      psych: PSYCH_LABEL_RE.test(reply) || VERDICT_RE.test(reply),
      uncalledTime,
      ruleHits: result.observer.ruleHits,
      replyCandidateCount: result.candidates.length,
    };
    logs.push(log);

    console.log(`用户：${userText}`);
    console.log(`AI：${reply}`);
    console.log(`  [选中候选] ack=${ack || '（无）'} | question=${question || '（无）'}`);
    console.log(
      `  [观察] intent=${result.intent} | engine=${result.engine} | 提问数=${log.questions} | 与用户原话最长重合=${log.lcs} | 心理定性=${log.psych ? '是(异常)' : '否'} | 叙事注入=${log.injection.length ? log.injection.join('/') + '(异常)' : '无'} | 未被用户提及的时间=${log.uncalledTime.length ? log.uncalledTime.join('/') + '(异常)' : '无'}`,
    );
    console.log(`  [规则] ${log.ruleHits.join('；') || '（无）'}`);

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
  '案例1：模糊记忆入口': ['我高中那几年其实挺压抑的。', '今天先到这里吧'],
  '案例2：具体画面+不确定记忆': [
    '我记得有一次下雨，我就在校门口站了挺久的……具体多久我也不记得了。',
    '我也不太确定，反正就是站在那里。',
    '今天先到这里吧',
  ],
  '案例3：用户明确拒绝': ['其实大学前三年也没干什么，现在回头看有点后悔。', '算了，这个我不太想说。', '今天先到这里吧'],
  '案例4：采访中突然改变任务': [
    '我小时候其实特别喜欢跟我爷爷待在一起，后来关系就不太好了……',
    '对了，我什么时候可以让你帮我整理成故事？',
    '那现在就帮我整理一下吧。',
  ],
  '案例5：碎片化自然讲述': [
    '我突然想起来一个事。',
    '就是大二的时候吧，还是大一，我不记得了。',
    '有一天晚上我在图书馆待到特别晚，然后下楼的时候发现宿舍那边已经没什么人了。',
    '其实也没发生什么特别大的事，就是那天突然觉得，大学好像就这么过去了。',
    '后来我走回宿舍的时候还给我妈打了个电话，不过我已经不记得具体聊什么了。',
    '今天先到这里吧',
  ],
};

async function main(): Promise<void> {
  console.log('==================================================');
  console.log('  真实模型黑盒复跑（走产品真实 runTurn 管线）');
  console.log('==================================================');

  await probeServerKey();
  const engine = await resolveEngineId();
  console.log(`引擎判定：${engine}`);
  if (engine !== 'llm') {
    console.log('❌ 未连上真实模型（服务端密钥探测失败）。请先启动读得到密钥的 dev server，并设置 VITE_LLM_PROXY_URL。');
    process.exit(2);
  }

  const all: Record<string, TurnLog[]> = {};
  for (const [name, turns] of Object.entries(SCENARIOS)) {
    all[name] = await runScenario(name, turns);
  }

  console.log('\n\n==================== 汇总校验 ====================');
  const flat = Object.values(all).flat();
  const injections = flat.filter((t) => t.injection.length);
  const psych = flat.filter((t) => t.psych);
  const uncalled = flat.filter((t) => t.uncalledTime.length);
  const multiQ = flat.filter((t) => t.questions > 1);
  console.log(`轮次数：${flat.length}`);
  console.log(`叙事注入：${injections.length} 处`);
  console.log(`心理定性：${psych.length} 处`);
  console.log(`未被用户提及的时间/数字：${uncalled.length} 处`);
  console.log(`多问题连问：${multiQ.length} 处`);
  if (injections.length || psych.length || uncalled.length || multiQ.length) {
    console.log('⚠️ 存在需要人工复核的轮次；详见上文各轮 [观察] 行。');
  } else {
    console.log('✅ 本轮未出现叙事注入 / 心理定性 / 编造时间 / 多问题连问。');
  }
}

void main();
