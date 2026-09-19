/**
 * 内容红线（第二轮）：故事正文是「用户自己的话」，不是 AI 的人生总结。
 *
 * 用真实线上文本（用户实际在故事里看到的那一段）验证三件事：
 *   1. 质检能不能判定「AI 替用户总结 / AI 对用户说话」；
 *   2. 确定性清洗能不能把这种句子**整句**拿掉（不留残句）；
 *   3. 回忆入口会不会重复问同一个人（领队 = 队长）。
 *
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/storyContentGuard.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintStory, matchesUserWords } from '../src/services/storyLint';
import { enforceStoryRules } from '../src/services/storyWriter';
import { buildRecallPrompts, roleKey } from '../src/services/recallPrompts';
import type { StoryOutline } from '../src/types/interview';
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

function emptyOutline(): StoryOutline {
  return {
    core: '',
    people: [],
    moments: [],
    conflict: null,
    shift: null,
    quotes: [],
    ending: { kind: 'quote', text: '' },
    not_write: [],
  };
}

function makeStory(patch: Partial<Story> = {}): Story {
  return {
    id: 's1',
    title: '做了一些事情才发现',
    topic: 'self_changed',
    content: '',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'full',
    threadId: 'th_1',
    sourceMessageIds: [],
    memory: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...patch,
  } as Story;
}

/* 用户真实说过的话（模拟访谈原文） */
const USER_TEXTS = [
  '那阵子去乡村支教，和一群之前不大熟悉的小伙伴一起。',
  '我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚，我哭了。',
  '接住我的人是领队，他给了我很多的帮助，让我更好地担任副队长这个职位。',
  '我之前其实提到过很多次了，但是没有被回应。',
];

/** 线上真实出现过的违规段落（用户截图里的那一段） */
const AI_SUMMARY_PARAGRAPH =
  '谢谢你，这次经历让我感受到合作的不容易，很需要彼此的努力。会慢慢地看到别人和自己的思考和处理问题的方式不大一样，需要多去沟通和理解，需要双方不断地去努力。';

/* ---------------- 1. 质检判定 ---------------- */
function testLint(): void {
  console.log('\n========== 质检：AI 总结 / AI 对用户说话 ==========');

  const ks = lintStory(AI_SUMMARY_PARAGRAPH, USER_TEXTS).map((item) => item.kind);
  assert(ks.includes('ai_summary_ending'), `线上那段 AI 总结被判定出来（实际：${JSON.stringify(ks)}）`);

  const endingOnly = lintStory('后来才明白合作不容易。这让我明白，合作需要彼此的努力。', USER_TEXTS);
  assert(
    endingOnly.some((item) => item.kind === 'ai_summary_ending'),
    '「这让我明白…」式结尾被判定为 ai_summary_ending',
  );

  // 用户自己真的说过「谢谢你」→ 不能误判
  const ownWords = lintStory('谢谢你。', ['谢谢你']).map((item) => item.kind);
  assert(!ownWords.includes('ai_summary_ending'), '用户自己说过「谢谢你」→ 不判为 AI 对用户说话');
  assert(matchesUserWords('谢谢你', ['谢谢你']), '短句按自身长度判定出处（不会被 4 字门槛误杀）');

  // 结构型违规仍然不触发降级
  const kinds = lintStory(AI_SUMMARY_PARAGRAPH, USER_TEXTS).map((item) => item.kind);
  const fabrication = ['uncertainty', 'invented_dialogue', 'inner_thought', 'literary'];
  assert(
    !kinds.some((kind) => fabrication.includes(kind)),
    'AI 总结属于结构型违规，不会触发「降级成流水账」',
  );
}

/* ---------------- 2. 确定性清洗 ---------------- */
function testStrip(): void {
  console.log('\n========== 清洗：整句拿掉，不留残句 ==========');

  const story = [
    USER_TEXTS[0],
    USER_TEXTS[1],
    AI_SUMMARY_PARAGRAPH,
  ].join('\n\n');

  const cleaned = enforceStoryRules(story, emptyOutline(), USER_TEXTS);
  assert(!cleaned.includes('谢谢你'), '清洗后不再出现「谢谢你」');
  assert(!cleaned.includes('合作的不容易'), '清洗后不再残留 AI 总结的后半句（旧实现只切前缀会留下它）');
  assert(!cleaned.includes('让我感受'), '清洗后不再出现「让我感受」这类升华句式');
  assert(cleaned.includes('我作为副队长没能处理好'), '用户自己的段落原样保留');

  // 用户真说过的「谢谢你」要留下
  const ownThanks = enforceStoryRules('接住我的人是领队。\n\n谢谢你。', emptyOutline(), ['谢谢你']);
  assert(ownThanks.includes('谢谢你'), '用户自己说过的「谢谢你」不会被误删');

  // 整段都是 AI 总结时：用骨架里用户自己的结尾原话接管
  const outline = emptyOutline();
  outline.ending = { kind: 'quote', text: '后来我说出来了。' };
  const rescued = enforceStoryRules(`我说不出来。\n\n${AI_SUMMARY_PARAGRAPH}`, outline, USER_TEXTS);
  assert(rescued.includes('后来我说出来了'), '整段是 AI 总结时，用用户自己的结尾原话接管');
  assert(!rescued.includes('让我感受'), '接管后不再有 AI 总结');

  // 纯填充词仍然被清掉
  const filler = enforceStoryRules('好吧，我后来才明白合作不容易。', emptyOutline(), USER_TEXTS);
  assert(!filler.includes('好吧'), '聊天口气词被清掉');
}

/* ---------------- 3. 回忆入口：同一个人只问一次 ---------------- */
function testRecall(): void {
  console.log('\n========== 回忆入口：不重复问同一个人 ==========');

  const story = makeStory({
    memory: {
      people: [
        { name: '领队', relationship: '组织者', importance: 5 },
        { name: '队长', relationship: '组织者', importance: 4 },
      ],
      events: [{ description: '去乡村支教', time: '', place: '乡村', importance: 4 }],
      details: [{ detail: '团队闹矛盾的时候我哭了' }],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['那阵子去乡村支教，和一群之前不大熟悉的小伙伴一起。'],
      story_status: 'saved',
    } as Story['memory'],
  });

  const prompts = buildRecallPrompts(story, 3);
  assert(roleKey('领队') === roleKey('队长'), '「领队」和「队长」被判为同一个角色');
  const asksLead = prompts.filter((item) => item.includes('领队') || item.includes('队长'));
  assert(asksLead.length <= 1, `同一个人只问一次（实际：${asksLead.join(' / ')}）`);
  assert(prompts.length >= 1 && prompts.length <= 3, `入口数量 1～3（实际 ${prompts.length}）`);

  // 用户说过「记不清是在哪儿了」→ 不再问地方
  const placeUnknown = makeStory({
    memory: {
      people: [],
      events: [{ description: '去支教', time: '', place: '乡村', importance: 4 }],
      details: [],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['我记不清具体是在哪儿了。'],
      story_status: 'saved',
    } as Story['memory'],
  });
  const placePrompts = buildRecallPrompts(placeUnknown, 3);
  assert(
    !placePrompts.some((item) => item.includes('乡村')),
    `已说记不清地点 → 不再问地点（实际：${placePrompts.join(' / ')}）`,
  );

  // 措辞里不能出现追问时间的说法
  assert(
    !prompts.some((item) => /哪一年|什么时候|哪一天|几几年/.test(item)),
    '回忆入口不追问时间',
  );
}

/* ---------------- 4. 页面红线（静态） ---------------- */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function testPages(): void {
  console.log('\n========== 页面：阅读优先、图标统一 ==========');
  const root = join(process.cwd(), 'src');
  const detail = stripComments(readFileSync(join(root, 'pages/StoryDetailPage.tsx'), 'utf8'));
  const card = stripComments(readFileSync(join(root, 'components/stories/StoryCard.tsx'), 'utf8'));
  const icon = stripComments(readFileSync(join(root, 'components/stories/CategoryIcon.tsx'), 'utf8'));
  const categories = stripComments(readFileSync(join(root, 'data/storyCategories.ts'), 'utf8'));

  assert(/<PhoneShell hideTabBar>/.test(detail), '详情页隐藏了底部导航（阅读时不被打断）');
  assert(/继续讲这段/.test(detail), '详情页保留「继续讲这段」');
  assert(/也许你还记得/.test(detail), '详情页保留「也许你还记得……」');
  assert(/想起来了吗/.test(detail), '详情页保留「想起来了吗？」');
  assert(!/card-paper/.test(detail), '「想起来了吗？」不再做成卡片式 CTA');
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert(!emoji.test(card), '故事卡片里没有 emoji 图标');
  assert(!emoji.test(icon), '类目图标全部是自绘线性图形，没有 emoji');
  assert(!emoji.test(categories), '类目数据里没有 emoji');
  assert(/最近记录/.test(card), '卡片保留「最近记录」');
  assert(/人生片段/.test(card) && /还可以继续讲/.test(card), '卡片保留「人生片段 / 还可以继续讲」（不是完成度）');
}

function main(): void {
  testLint();
  testStrip();
  testRecall();
  testPages();
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
