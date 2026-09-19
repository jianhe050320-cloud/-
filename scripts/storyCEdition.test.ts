/**
 * C 版「私人杂志」正文生成的确定性闸门验收（离线、不调模型）。
 *
 * 覆盖本次重构引入的纯函数行为：
 *   - flattenChapters：章节展平为单一 content 事实源
 *   - resolvePullQuote：重点句必须逐字出自用户原话，否则回退/留空
 *   - lintStory 新门类：跨阶段桥接 / 正文 AI 替用户分析 / 章节标题虚构 / 拼接检测
 *   - enforceStoryRulesOnChapters：逐章节确定性清洗
 *
 * 用法（在 interviewer 目录下）：npx tsx scripts/storyCEdition.test.ts
 */
import { lintStory } from '../src/services/storyLint';
import { flattenChapters, resolvePullQuote, enforceStoryRulesOnChapters } from '../src/services/storyWriter';
import { emptyOutline } from '../src/services/storyOutline';
import type { StoryChapter } from '../src/types/interview';

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

console.log('\n========== flattenChapters ==========');
{
  const chapters: StoryChapter[] = [
    { title: '', paragraphs: ['A 段。', 'B 段。'] },
    { title: '标题', paragraphs: ['C 段。'] },
  ];
  assert(flattenChapters(chapters) === 'A 段。\n\nB 段。\n\nC 段。', '章节展平为双换行连接的段落');
  assert(flattenChapters(undefined) === '', '空章节展平为空串');
  assert(flattenChapters([]) === '', '空数组展平为空串');
}

console.log('\n========== resolvePullQuote 溯源 ==========');
{
  const userTexts = ['我觉得我做得挺好的，所以能够来到这里。', '父母要回去了。'];
  const content = '那时候我觉得我做得挺好的，所以能够来到这里。\n\n父母要回去了。';
  const ok = resolvePullQuote('我觉得我做得挺好的，所以能够来到这里。', content, userTexts);
  assert(ok.length > 0, '用户原话（可在原话里回溯）可成为 pullQuote');

  const fake = resolvePullQuote('你其实一直都在寻找一种被认可的感觉。', content, userTexts);
  assert(!/寻找一种被认可/.test(fake), 'AI 解释句不得作为重点句（回退为空）');
}

console.log('\n========== lintStory 新门类 ==========');
{
  const userTexts = ['高中时候大家看重成绩。', '大学里我过得挺自在。'];

  const bridge = '高中毕业后我来到大学，一切都不一样了。';
  assert(lintStory(bridge, userTexts).some((v) => v.kind === 'life_stage_mix'), '跨人生阶段桥接被拦截');

  const singleStage = '高中那时候大家比较看重成绩。';
  assert(
    !lintStory(singleStage, userTexts).some((v) => v.kind === 'life_stage_mix'),
    '单纯提及某一阶段不误判为桥接',
  );

  const analysis = '这说明你其实是一个缺乏安全感的人。';
  assert(
    lintStory(analysis, ['别的']).some((v) => v.kind === 'ai_analysis_in_body'),
    '正文里的 AI 替用户分析被拦截',
  );

  const outline = emptyOutline();
  outline.chapters = [{ title: '与自我和解', paragraphs: ['今天天气不错。'] }];
  assert(
    lintStory('今天天气不错。', [], outline).some((v) => v.kind === 'chapter_title_fabrication'),
    '虚构（正文无依据）的章节标题被拦截',
  );
}

console.log('\n========== flat_structure 放松为拼接检测 ==========');
{
  const answers = ['就是那个下雨天我在校门口站着', '站了很久也没想那么多', '最后还是慢慢走回去了'];
  const concatenated = `${answers.join('，')}。`;
  assert(
    lintStory(concatenated, answers).some((v) => v.kind === 'flat_structure'),
    '按采访顺序逐字拼接被判 flat',
  );

  const edited = '那天下了很大的雨，我在校门口站了很久。后来雨小了，我才慢慢走回去。';
  assert(
    !lintStory(edited, ['校门口', '雨']).some((v) => v.kind === 'flat_structure'),
    '有编辑痕迹（变化线/衔接词）不再误判为 flat',
  );
}

console.log('\n========== enforceStoryRulesOnChapters 清洗 ==========');
{
  const outline = emptyOutline();
  const chapters: StoryChapter[] = [
    { title: '', paragraphs: ['谢谢你，那时候我真的很开心。', '后来我才明白这件事的意义。'] },
  ];
  const cleaned = enforceStoryRulesOnChapters(chapters, outline, []);
  assert(
    !cleaned[0].paragraphs.some((paragraph) => paragraph.includes('谢谢你')),
    '聊天口气词被确定性清除',
  );
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (fail > 0) {
  console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
  process.exit(1);
}
console.log('全部通过。');
