/**
 * 真实模型契约校验：用我们真正的三段系统提示词去打 DeepSeek，
 * 看返回能不能被 sanitizeUnderstanding / sanitizeCandidates 接住。
 *
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/llm-check.ts
 *
 * 密钥从 .env.local 读（不加 VITE_ 前缀，所以不会进前端产物）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  QUESTIONER_SYSTEM_PROMPT,
  STORY_SYSTEM_PROMPT,
  UNDERSTANDER_SYSTEM_PROMPT,
  renderMemoryDigest,
} from '../src/data/prompts';
import { sanitizeUnderstanding } from '../src/services/understander';
import { sanitizeCandidates } from '../src/services/questioner';
import { createEmptyMemory } from '../src/types/interview';
import { parseJsonSafe } from '../src/lib/json';

function loadEnv(): Record<string, string> {
  const file = path.resolve(import.meta.dirname, '..', '.env.local');
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const matched = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (matched) out[matched[1]] = matched[2].trim();
  }
  return out;
}

const env = loadEnv();
const API_KEY = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const MODEL = env.DEEPSEEK_MODEL || 'deepseek-chat';
const BASE = 'https://api.deepseek.com';

if (!API_KEY) {
  console.error('✗ .env.local 里没有 DEEPSEEK_API_KEY');
  process.exit(1);
}

async function ask(system: string, user: string, maxTokens: number): Promise<string> {
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await res.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string; reasoning_content?: string } }[];
    usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    error?: { message?: string };
  };
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  const choice = data.choices?.[0];
  const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  console.log(
    `  （耗时 ${seconds}s · 输出 ${data.usage?.completion_tokens ?? '?'} tokens` +
      `${reasoning ? `，其中思考 ${reasoning}` : ''} · finish_reason=${choice?.finish_reason}）`,
  );
  if (!choice?.message?.content) {
    throw new Error(
      `返回的 content 为空${choice?.message?.reasoning_content ? '（全被 reasoning_content 占了，说明是推理模型）' : ''}`,
    );
  }
  return choice.message.content;
}

/* ---------------- 测试用例取自《第一次离开家》测试集 ---------------- */
const TRANSCRIPT = [
  '采访者：您还记得第一次离开家，去外地工作的时候吗？',
  '用户：怎么不记得呢。那是我二十岁出头的时候吧，我记得那时候我们村里很多年轻人都出去，我也就跟着一起去了。那时候其实也没想那么多，年轻嘛，就觉得外面的世界肯定比家里好。',
  '采访者：听起来，二十岁出头的时候，家里还是您最熟悉的地方，而外面的世界既陌生又让人有点期待。那时候您眼里的家，和外面的世界，分别是什么样子的？',
  '用户：家嘛，就是从小长大的地方，什么都熟悉。谁家有几口人都知道。外面就不一样了，什么都新鲜。刚出去的时候其实挺兴奋的，但是到了晚上突然就想家了。',
].join('\n');

const LAST_USER = '家嘛，就是从小长大的地方，什么都熟悉。谁家有几口人都知道。外面就不一样了，什么都新鲜。刚出去的时候其实挺兴奋的，但是到了晚上突然就想家了。';

async function checkUnderstander(): Promise<void> {
  console.log('\n========== LLM1 · 理解器 ==========');
  const raw = await ask(
    UNDERSTANDER_SYSTEM_PROMPT,
    [
      '【已经记住的内容】\n（目前还什么都没有，用户刚开口。）',
      `【对话记录】\n${TRANSCRIPT}`,
      '【本次任务】阅读上面的对话，只输出一个 JSON 对象。',
    ].join('\n\n'),
    1600,
  );

  const parsed = parseJsonSafe<Record<string, unknown>>(raw);
  if (!parsed) {
    console.log('✗ 无法解析出 JSON。原始输出前 200 字：\n' + raw.slice(0, 200));
    return;
  }
  const understanding = sanitizeUnderstanding(parsed, 2, LAST_USER);
  console.log(`✓ JSON 解析成功`);
  console.log(`  线索 ${understanding.newClues.length} 条：`);
  for (const clue of understanding.newClues) {
    console.log(`    [${clue.kind}] ${clue.text}（重要度 ${clue.importance}，主动提及 ${clue.userInitiated}）`);
  }
  console.log(`  用户信号：${JSON.stringify(understanding.signals)}`);
  console.log(`  完整度自评：${understanding.completeness}`);
  console.log(`  最值得继续：${understanding.focus}`);
  const patch = understanding.memoryPatch;
  console.log(
    `  Memory 增量：事件 ${patch?.events?.length ?? 0} / 情绪 ${patch?.emotions?.length ?? 0} / ` +
      `人物 ${patch?.people?.length ?? 0} / 细节 ${patch?.details?.length ?? 0} / 原话 ${patch?.user_quotes?.length ?? 0}`,
  );
}

async function checkQuestioner(): Promise<void> {
  console.log('\n========== LLM2 · 候选追问生成 ==========');
  const memory = createEmptyMemory();
  memory.people = [{ name: '妈妈', relationship: '母亲', importance: 5 }];
  memory.events = [
    { description: '第一次外出打工，二十岁出头跟着村里人一起出去', time: '二十岁出头', place: '', importance: 5 },
    { description: '晚上饿了拿出妈妈煮的鸡蛋，突然特别想家', time: '', place: '', importance: 4 },
  ];
  memory.details = [{ detail: '走之前煮了几个鸡蛋，偷偷放进包里', importance: 5 }];
  memory.emotions = [{ emotion: '想家', evidence: '到了晚上突然就想家了', confidence: 0.9 }];

  const raw = await ask(
    QUESTIONER_SYSTEM_PROMPT,
    [
      '【这次访谈的方向】用户第一次离开家（去外地工作或上学）',
      '【当前采访状态】EXPLORING',
      `【已经记住的内容】\n${renderMemoryDigest(memory)}`,
      '【可用的故事线索】\n- [person] 妈妈（重要度5，用户主动提及）\n- [detail] 走之前煮了几个鸡蛋，偷偷放进包里（重要度5，用户主动提及）\n- [emotion] 想家（重要度5，用户主动提及）',
      `【用户刚刚说】${LAST_USER}`,
      '【本次任务】输出 2-3 个候选追问的 JSON 数组。',
    ].join('\n\n'),
    1200,
  );

  const parsed = parseJsonSafe<unknown>(raw);
  const list = Array.isArray(parsed) ? parsed : (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) {
    console.log('✗ 没有返回数组。原始输出前 200 字：\n' + raw.slice(0, 200));
    return;
  }
  const candidates = sanitizeCandidates(list);
  console.log(`✓ 拿到 ${candidates.length} 个候选追问`);
  candidates.forEach((candidate, index) => {
    const marks = (candidate.question.match(/[？?]/g) ?? []).length;
    console.log(`  ${index + 1}. ${candidate.question}`);
    console.log(
      `     针对线索：${candidate.target_clue} · 问号数 ${marks}` +
        ` · 价值${candidate.story_value} 主动${candidate.user_initiative} 情绪${candidate.emotional_signal}` +
        ` 增益${candidate.information_gain} 愿意${candidate.willingness}` +
        ` − 打扰${candidate.disturbance_cost} − 敏感${candidate.sensitivity_risk}`,
    );
    if (marks > 1) console.log('     ⚠ 这句话里有多个问号，属于连环追问');
  });
}

const FORBIDDEN = ['阳光明媚', '憧憬', '列车', '微风', '命运', '心里一暖'];

async function checkStoryWriter(): Promise<void> {
  console.log('\n========== LLM3 · 故事整理 ==========');
  const raw = await ask(
    STORY_SYSTEM_PROMPT,
    [
      '【这次访谈的方向】第一次离开家',
      '【完整对话（这是你唯一的信息来源，不要引入任何对话以外的内容）】\n' + TRANSCRIPT,
      '【本次任务】输出故事 JSON。',
    ].join('\n\n'),
    2000,
  );

  const parsed = parseJsonSafe<Record<string, unknown>>(raw);
  const title = typeof parsed?.title === 'string' ? parsed.title : '';
  const content = typeof parsed?.content === 'string' ? parsed.content : '';
  if (!title || !content) {
    console.log('✗ 故事 JSON 不完整。原始输出前 200 字：\n' + raw.slice(0, 200));
    return;
  }
  console.log(`✓ 标题：${title}`);
  console.log(`✓ 正文 ${content.length} 字，${content.split(/\n{2,}/).length} 段`);
  console.log('  ' + content.split(/\n{2,}/)[0]?.slice(0, 80) + '…');

  const hits = FORBIDDEN.filter((word) => content.includes(word));
  console.log(
    hits.length === 0
      ? '✓ 没有出现用户没说过的文学化填充词（阳光明媚 / 憧憬 / 列车 / 命运 …）'
      : `✗ 出现了用户没说过的词：${hits.join('、')}`,
  );
  console.log(`  literary 标记：${Boolean(parsed?.literary)}`);
}

async function main(): Promise<void> {
  console.log(`模型：${MODEL}（密钥来自 .env.local，长度 ${API_KEY.length}）`);
  await checkUnderstander();
  await checkQuestioner();
  await checkStoryWriter();
  console.log('\n完成。');
}

void main();
