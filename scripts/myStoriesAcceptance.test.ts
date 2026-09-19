/**
 * 「我的故事」重构 —— 可在无浏览器环境下验证的部分。
 *
 * 覆盖：类目映射 / 标题 / 摘录 / 排序 / 回忆入口 / 用户可见文案红线。
 * UI 交互（点击、路由、编辑保存）需要在浏览器里人工验证，不在本脚本范围。
 *
 * 用法：
 *   node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/myStoriesAcceptance.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sortStoriesByRecency, storyCategory, storyTitle } from '../src/data/storyCategories';
import { buildRecallPrompts } from '../src/services/recallPrompts';
import { questionSeeksCategories } from '../src/services/rules';
import type { Story } from '../src/types/models';

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

function makeStory(patch: Partial<Story> = {}): Story {
  return {
    id: 's1',
    title: '第一次来到大学',
    topic: 'first_university',
    content: '第一次来大学的时候觉得特别神奇，发现这里的树特别特别高。',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_1',
    sourceMessageIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    memory: null,
    ...patch,
  } as Story;
}

/* ---------------- 类目 / 标题 / 摘录 ---------------- */
function testCardMeta(): void {
  console.log('\n========== 故事卡片：类目 / 标题 / 摘录 ==========');

  assert(storyCategory({ topic: 'first_university' }).label === '求学', '已知话题归入「求学」');
  assert(storyCategory({ topic: 'people_friend' }).label === '朋友', '已知话题归入「朋友」');
  assert(storyCategory({ topic: 'first_earn' }).label === '工作', '已知话题归入「工作」');

  // 归不进去时：给通用类目（不再拿话题问句当类目）
  const unknown = storyCategory({ topic: 'regret_sorry' });
  assert(unknown.icon.length > 0, '未知类目也有图标（不空白）');
  assert(storyCategory({ topic: 'no_such_topic' }).icon === 'book', '认不出的话题 → 通用故事图标');
  assert(storyCategory({ topic: 'random_question' }).icon === 'book', '随机问题 → 通用故事图标');
  assert(storyCategory({ topic: 'no_such_topic' }).label === '某段经历', '认不出的话题 → 通用类目「某段经历」');

  // 类目绝不能再是「话题问句」（它是一段什么经历，不是又抛一个问题）
  const allTopics = [
    'first_university', 'first_leave_home', 'first_earn', 'first_love', 'first_grown',
    'people_friend', 'people_teacher', 'people_lost', 'people_remember',
    'small_night', 'small_meal', 'small_message', 'small_laugh',
    'self_changed', 'self_like', 'self_dislike', 'self_cando',
    'regret_again', 'regret_undecided', 'regret_gaveup', 'regret_sorry',
    'future_grad', 'future_life', 'future_adult', 'future_money',
  ];
  const questionLike = allTopics.filter((topic) => /[？?]|我什么时候|我真正|我不太|我不知道|我害怕|如果/.test(storyCategory({ topic }).label));
  assert(questionLike.length === 0, `类目里不出现话题问句（实际问题类目：${questionLike.join('、') || '无'}）`);
  const icons = new Set(allTopics.map((topic) => storyCategory({ topic }).icon));
  assert(icons.size >= 5, `全部话题都有明确类目（用到 ${icons.size} 种图标，不再是一堆 emoji）`);

  // 绝不能出现另一个产品（fuyuan）的类目
  const all = ['first', 'people', 'small', 'self', 'regret', 'future'].flatMap((prefix) =>
    [`${prefix}_x`, prefix],
  );
  const forbidden = ['困扰', '在意', '开心', '小习惯'];
  const leaked = all.filter((topic) => forbidden.includes(storyCategory({ topic }).label));
  assert(leaked.length === 0, '不复用 fuyuan 的「困扰/在意/开心/小习惯」类目');

  assert(storyTitle({ title: '和爷爷在一起', topic: 'first_university' }) === '和爷爷在一起', '标题优先用 Story.title');
  assert(storyTitle({ title: '', topic: 'first_university' }) === '第一次来到大学', '没有标题时用事实性话题名');
  assert(storyTitle({ title: '', topic: '' }) === '一段人生片段', '都没有时用朴素的兜底标题');
  const literary = ['青春的答案', '命运的转折', '雨中的思念', '人生最重要的那一天'];
  assert(!literary.includes(storyTitle({ title: '', topic: 'first_university' })), '不生成文学化标题');
}

/* ---------------- 排序 ---------------- */
function testOrder(): void {
  console.log('\n========== 排序：最近记录在前 ==========');
  const old = makeStory({ id: 'a', updatedAt: '2026-08-01T00:00:00.000Z' });
  const recent = makeStory({ id: 'b', updatedAt: '2026-09-16T00:00:00.000Z' });
  const mid = makeStory({ id: 'c', updatedAt: '2026-09-02T00:00:00.000Z' });
  const list = sortStoriesByRecency([old, recent, mid]);
  assert(list.map((item) => item.id).join(',') === 'b,c,a', '按 updatedAt 倒序（最近讲过的回到前面）');
  assert(sortStoriesByRecency([]).length === 0, '空列表不报错');
}

/* ---------------- 回忆入口 ---------------- */
function testRecall(): void {
  console.log('\n========== 回忆入口（也许你还记得……） ==========');

  // 1) 只围绕已有信息
  const withPeople = makeStory({
    memory: {
      ...(makeStory().memory ?? {}),
      people: [{ name: '爸爸', relationship: '父亲', importance: 4 }],
      events: [{ description: '第一次来大学', time: '', place: '学校', importance: 4 }],
      details: [],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['第一次来大学的时候觉得特别神奇。'],
      story_status: 'saved',
    } as Story['memory'],
  });
  const prompts = buildRecallPrompts(withPeople, 3);
  assert(prompts.length >= 1 && prompts.length <= 3, `回忆入口数量 1～3（实际 ${prompts.length}）`);
  assert(
    prompts.some((item) => item.includes('爸爸')),
    `围绕已出现的人物生成入口（实际：${prompts.join(' / ')}）`,
  );

  // 2) 不追问用户已经声明「记不清」的事实 —— 年份
  const yearUnknown = makeStory({
    memory: {
      people: [],
      events: [],
      details: [],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['具体是哪一年，我现在已经记不清了。'],
      story_status: 'saved',
    } as Story['memory'],
  });
  const yearPrompts = buildRecallPrompts(yearUnknown, 3);
  const asksYear = yearPrompts.filter((item) => questionSeeksCategories(item).includes('time'));
  assert(asksYear.length === 0, `已说「哪一年记不清」→ 不再追问年份（实际：${yearPrompts.join(' / ')}）`);

  // 3) 不追问用户已经声明「不知道是谁」的事实 —— 人物
  const whoUnknown = makeStory({
    memory: {
      people: [],
      events: [],
      details: [],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['后来有人来找我，但我也不知道是谁。'],
      story_status: 'saved',
    } as Story['memory'],
  });
  const whoPrompts = buildRecallPrompts(whoUnknown, 3);
  const asksPerson = whoPrompts.filter((item) => questionSeeksCategories(item).includes('person'));
  assert(asksPerson.length === 0, `已说「不知道是谁」→ 不再追问人物（实际：${whoPrompts.join(' / ')}）`);

  // 4) 不追问已声明「记不清地点」的事实
  const placeUnknown = makeStory({
    memory: {
      people: [],
      events: [],
      details: [],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['我记不清具体是在哪儿了。'],
      story_status: 'saved',
    } as Story['memory'],
  });
  const placePrompts = buildRecallPrompts(placeUnknown, 3);
  const asksPlace = placePrompts.filter((item) => questionSeeksCategories(item).includes('place'));
  assert(asksPlace.length === 0, `已说「记不清地点」→ 不再追问地点（实际：${placePrompts.join(' / ')}）`);

  // 5) 没有任何信息时，给安全入口（不审讯、不空白）
  const empty = buildRecallPrompts(makeStory(), 3);
  assert(empty.length >= 1, '没有任何记忆时仍然给入口（不开天窗）');
  assert(
    empty.every((item) => questionSeeksCategories(item).length === 0),
    '兜底入口不追问任何具体事实（不是审讯）',
  );

  // 6) 不制造任务压力
  const allText = [...prompts, ...yearPrompts, ...empty].join(' ');
  assert(!/(再想一想|请继续回答|还有一个问题|必须回答)/.test(allText), '回忆入口不带催促/任务感');
}

/* ---------------- 用户可见文案红线（静态检查） ---------------- */

/** 只检查「真正会被用户看到的东西」：先把注释去掉，避免命中文档里列举的禁用词 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function testCopyRedLines(): void {
  console.log('\n========== 文案红线：不暴露内部概念、不制造完成焦虑 ==========');
  const root = join(process.cwd(), 'src');
  const myStories = stripComments(readFileSync(join(root, 'pages/MyStoriesPage.tsx'), 'utf8'));
  const card = stripComments(readFileSync(join(root, 'components/stories/StoryCard.tsx'), 'utf8'));
  const detail = stripComments(readFileSync(join(root, 'pages/StoryDetailPage.tsx'), 'utf8'));

  assert(/我的故事/.test(myStories), '首页有标题「我的故事」');
  assert(/已经留下/.test(myStories), '首页有「已经留下 N 个故事」');
  assert(/继续讲一个故事/.test(myStories), '首页有底部「继续讲一个故事」');
  assert(/想起什么，就从什么开始/.test(myStories), '首页底部有副文案');
  assert(/这里会放下你想留下的人生片段/.test(myStories), '空状态文案温和（不是「暂无数据」）');
  assert(/开始讲一件事/.test(myStories), '空状态有「开始讲一件事」');

  /*
   * threadId 单独处理：它在「继续讲这段」时必须被代码带回去（不是展示给用户），
   * 所以这里只禁止它出现在 JSX 可见文本里。
   */
  const internal = /MemoryEntry|\bseed\b|\bnote\b|maturity|storyStatus/;
  assert(!internal.test(myStories), '首页不展示 MemoryEntry / seed / note / maturity 等内部概念');
  assert(!internal.test(card), '卡片不展示内部概念');
  assert(!/\{story\.threadId\}/.test(myStories), '首页不渲染 threadId');

  const anxiety = /未完成|完成度|还差|差 \d+ 个问题|百分比/;
  assert(!anxiety.test(myStories), '首页不出现「未完成 / 完成度」等完成焦虑');
  assert(!anxiety.test(card), '卡片不出现「未完成 / 完成度」');
  assert(/人生片段/.test(card), 'fragment 显示为「人生片段」');
  assert(/还可以继续讲/.test(card), 'fragment 提示「还可以继续讲」');

  assert(/继续讲这段/.test(detail), '详情页有「继续讲这段」');
  assert(/也许你还记得/.test(detail), '详情页有「也许你还记得……」');
  assert(/想起来了吗/.test(detail), '详情页有「想起来了吗？」');
  assert(!internal.test(detail), '详情页不展示内部概念');
  assert(!/\{story\.threadId\}/.test(detail), '详情页不把 threadId 显示给用户（只用于继续讲时带回去）');
}

function main(): void {
  testCardMeta();
  testOrder();
  testRecall();
  testCopyRedLines();
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
