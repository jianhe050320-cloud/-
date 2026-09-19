/**
 * Phase 6 · 真人体验排练（第一轮，完整闭环）。
 *
 * 原则：**只观察，不救场，不边测边修**。
 * 本脚本不修改任何产品代码，只按真实用户在界面里会走的链路，逐层调用产品自身的服务：
 *   开始（startInterview）
 *   → 逐轮采访（runTurn：LLM1 理解 + 硬规则 + LLM2 候选 + 排序 + 接住质检）
 *   → 成熟度分流（decideOutput / classifyMemory）
 *   → Story Organizer（writeStory：LLM3 + 骨架 + 质检）
 *   → Thread 续接（resolveThread）
 *
 * 说明（诚实边界）：
 *   - UI 点击层（查看/修改/保存/离开/回来）与 CloudBase 持久化在无浏览器环境下无法执行
 *     （src/lib/cloudbase.ts 依赖 import.meta.env，Node 下不可加载），
 *     因此这部分的**决策层**用同等服务函数替代，UI 外壳本身不在本次观察范围。
 *   - 本轮只输出原始观察数据，不作修复、不作评分。
 *
 * 用法：
 *   $env:VITE_LLM_PROXY_URL='http://localhost:5175'
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/experienceRehearsal.ts
 */
import { runTurn, startInterview } from '../src/services/interviewService';
import { writeStory } from '../src/services/storyWriter';
import { decideOutput, classifyMemory } from '../src/machines/interviewMachine';
import { resolveThread } from '../src/services/threadService';
import { resolveEngineId, probeServerKey } from '../src/services/llmGateway';
import { createEmptyMemory } from '../src/types/interview';
import type { Clue, InterviewState, StoryMemory } from '../src/types/interview';

/** 一个老人的一段年轻经历。故意不完整：不确定、记不清、跳到别人、突然不想说、突然换故事、很碎、没有高潮。 */
const SCRIPT = [
  '我突然想起来，我年轻的时候有一次下雨……',
  '好像是在学校门口吧。',
  '那时候我跟我妈关系其实挺好的。',
  '不过具体是哪一年，我现在已经记不清了。',
  '我记得那天下了挺大的雨，我就在门口站了很久。',
  '后来好像有人来找我，但我现在也记不清是谁了。',
  '这件事情其实过去很多年了。',
  '对了，你什么时候能帮我整理成故事？', // 中途询问（产品咨询）
  '算了，这个先不说了。', // 突然不想说
  '对了，我突然想起来另外一件事……', // 突然换故事
  '就是我爸带我去镇上那次，好像也是在雨里，我记不太清了。',
  '好，就先聊到这儿吧。',
  '那你现在帮我整理成故事吧。', // 最后要求整理
];

function lcs(a: string, b: string): number {
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

const INJECTION = ['事情后来变了样子', '后来发生了变化', '这是一个重要的人生转折', '这对你影响很大', '你当时一定很'];

function memoryLine(memory: StoryMemory): string {
  return `人=${memory.people.length} 事=${memory.events.length} 情=${memory.emotions.length} 细节=${memory.details.length} 转折=${memory.turning_points.length} 原话=${memory.user_quotes.length}`;
}

async function main(): Promise<void> {
  console.log('==================================================');
  console.log('  Phase 6 · 真人体验排练（第一轮 · 完整闭环）');
  console.log('  只观察，不救场；不修改产品代码');
  console.log('==================================================\n');

  await probeServerKey();
  const engine = await resolveEngineId();
  console.log(`引擎：${engine}`);
  if (engine !== 'llm') {
    console.log('❌ 未连上真实模型，中止（不降级，避免把模板行为误当体验）。');
    process.exit(2);
  }

  const topicId = 'topic_rehearsal_1';
  const topicLabel = '年轻时候的一段经历';
  const threadId = 'th_rehearsal_1';

  // —— 进入产品 ——
  const opening = startInterview({ topicId, topicLabel, question: null });
  console.log('【进入产品】AI 开场：', opening.opening, '\n');

  let state: InterviewState = 'START';
  let scriptStep = opening.scriptStep;
  let memory: StoryMemory = createEmptyMemory();
  let clues: Clue[] = [];
  let highValueClues: string[] = [];
  const messages: { role: 'user' | 'assistant'; text: string }[] = [
    { role: 'assistant', text: opening.opening },
  ];

  const turnStats: { questions: number; reuse: number; injection: string[]; ms: number; intent: string }[] = [];

  for (const text of SCRIPT) {
    const t0 = Date.now();
    const out = await runTurn({
      topicId,
      topicLabel,
      state,
      scriptStep,
      memory,
      clues,
      highValueClues,
      messages: [...messages],
      userText: text,
    });
    const ms = Date.now() - t0;
    const r = out.result;
    const selected = r.observer.selected;
    const ack = (selected?.ack ?? '').trim();
    const question = (selected?.question ?? '').trim();
    const questions = (r.reply.match(/[？?]/g) ?? []).length;
    const injection = INJECTION.filter((p) => r.reply.includes(p));
    const reuse = lcs(text, r.reply);

    console.log(`用户（${ms}ms）：${text}`);
    console.log(`AI：${r.reply}`);
    console.log(`  [结构] intent=${r.intent} | 提问数=${questions} | 与用户原话重合=${reuse}`);
    console.log(`  [选中] ack=${ack || '（无）'} | question=${question || '（无）'}`);
    console.log(`  [观察] memory ${memoryLine(memory)} → ${memoryLine(r.memory)}`);
    console.log(
      `  [红线] 叙事注入=${injection.length ? injection.join('/') + '(异常)' : '无'} | 记忆回执=${r.recap ? '有' : '无'}`,
    );
    console.log(`  [规则] ${r.observer.ruleHits.join('；') || '（无）'}\n`);

    turnStats.push({ questions, reuse, injection, ms, intent: r.intent });

    messages.push({ role: 'user', text });
    messages.push({ role: 'assistant', text: r.reply });
    state = r.state;
    scriptStep = out.scriptStep;
    memory = r.memory;
    clues = out.clues;
    highValueClues = out.highValueClues;
  }

  // —— 成熟度分流 + Story Organizer ——
  console.log('==================== 整理闭环 ====================');
  const decision = decideOutput({ memory, messages, userRequestsOrganize: true, llmCompleteness: 0 });
  const entryType = classifyMemory({ memory, messages, userRequestsOrganize: true });
  console.log(`decideOutput = ${decision} | classifyMemory = ${entryType}`);

  if (decision === 'seed') {
    console.log('→ 不生成 Story，落成一条记忆入口（MemoryEntry, type=' + entryType + '）');
    console.log('→ 用户在确认页看到的是「被收好的一段话」，而不是一篇故事。');
  } else {
    const draft = await writeStory({
      topicId,
      topicLabel,
      memory,
      messages,
      engine,
      target: decision,
      threadId,
      sourceMessageIds: messages.map((_, index) => `umsg_${index}`).filter((_, index) => messages[index]?.role === 'user'),
    });
    console.log(`\n【查看故事】kind=${draft.kind} literary=${draft.literary} title=${draft.title}`);
    console.log('----- 正文 -----');
    console.log(draft.content);
    console.log('----- 事实地图 outline -----');
    console.log(JSON.stringify(draft.outline ?? null, null, 2));
    console.log('----- 质检 -----');
    console.log(JSON.stringify(draft.lint ?? null));
  }

  // —— 离开 → 回来 → 同一 Thread ——
  console.log('\n==================== 离开 / 回来 / Thread ====================');
  const resumed = resolveThread({
    continuesThreadId: null,
    knownThreadIds: [threadId],
    topicThreadId: threadId,
  });
  console.log(`再次进入同一话题 → resolveThread = ${JSON.stringify(resumed)}`);
  console.log(`是否复用同一 Thread：${resumed.threadId === threadId ? '是' : '否'} | 是否新建：${resumed.created ? '是' : '否'}`);

  // —— 原始统计（不做评分） ——
  const totalMs = turnStats.reduce((sum, item) => sum + item.ms, 0);
  console.log('\n==================== 原始统计（不评分） ====================');
  console.log(`轮数=${turnStats.length} | 平均响应=${Math.round(totalMs / turnStats.length)}ms | 累计等待=${(totalMs / 1000).toFixed(1)}s`);
  console.log(`多问题轮数=${turnStats.filter((t) => t.questions > 1).length}`);
  console.log(`零提问轮数=${turnStats.filter((t) => t.questions === 0).length}`);
  console.log(`叙事注入轮数=${turnStats.filter((t) => t.injection.length).length}`);
  console.log(`意图序列=${turnStats.map((t) => t.intent).join(' → ')}`);
}

void main();
