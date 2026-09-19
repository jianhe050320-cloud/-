/**
 * 故事结构性质检的确定性单测（不依赖模型，直接喂字符串）。
 * 只验证「新加的四类结构检查」有没有正确命中——这是本次改造的硬保证。
 */
import { lintStory } from '../src/services/storyLint';

let failed = 0;
function expect(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function kinds(content: string, userTexts: string[]): string[] {
  return lintStory(content, userTexts).map((item) => item.kind);
}

console.log('\n================ 故事结构性质检单测 ================\n');

/* 1) flat_structure：平铺叙述、没有任何变化标记 → 必须命中 */
{
  const flat = '我去乡村支教。和一群不大熟悉的小伙伴一起。团队闹矛盾的时候，我作为副队长没能处理好，我哭了。我很愧疚。';
  const ks = kinds(flat, ['我去乡村支教。和一群不大熟悉的小伙伴一起。团队闹矛盾。']);
  expect('平铺叙述被标记为 flat_structure', ks.includes('flat_structure'), JSON.stringify(ks));
}

/* 2) 有「后来才…」的变化线 → 不应再报 flat_structure */
{
  const withShift = '团队闹矛盾，我作为副队长没处理好，我哭了。后来才明白，如果双方都努力了，结果没那么好我也能接受。';
  const ks = kinds(withShift, ['后来才明白，如果双方都努力了']);
  expect('有变化线的故事不报 flat_structure', !ks.includes('flat_structure'), JSON.stringify(ks));
}

/* 3) ai_summary_ending：结尾是「这让我…」式总结 → 必须命中
      注意：用户原话里**没有**这句总结 —— 区分「用户自己说的」和「AI 补上去的」
      正是这条规则的关键（如果用户真的这么说，就该允许保留）。 */
{
  const aiEnd = '我作为副队长没处理好，我哭了。后来才明白合作不容易。这让我明白，合作需要彼此的努力。';
  const ks = kinds(aiEnd, ['我作为副队长没处理好，我哭了', '后来才明白合作不容易']);
  expect('AI 式总结结尾被标记为 ai_summary_ending', ks.includes('ai_summary_ending'), JSON.stringify(ks));

  // 用户自己说过的同一句话 → 不算 AI 总结
  const own = kinds('这让我明白，合作需要彼此的努力。', ['这让我明白，合作需要彼此的努力']);
  expect('用户自己说过的话不判为 AI 总结', !own.includes('ai_summary_ending'), JSON.stringify(own));
}

/* 4) chatty_tone：聊天的口气词被搬进成稿 → 必须命中 */
{
  const chatty = '团队闹矛盾我哭了。好吧，后来我才明白合作不容易。';
  const ks = kinds(chatty, ['好吧，后来我才明白']);
  expect('聊天口气词被标记为 chatty_tone', ks.includes('chatty_tone'), JSON.stringify(ks));
}

/* 5) repetition：同一意思说两遍 → 必须命中 */
{
  const repeat = '我们彼此都比较伤心。这件事我们彼此都比较受伤。';
  const ks = kinds(repeat, ['我们彼此都比较伤心。这件事我们彼此都比较受伤。']);
  expect('重复表述被标记为 repetition', ks.includes('repetition'), JSON.stringify(ks));
}

/* 6) 结构型违规绝不触发「编造」降级判定 */
{
  const messy = '谢谢你，这让我明白合作不容易。我们彼此都比较伤心。这件事我们彼此都比较受伤。';
  const ks = kinds(messy, ['谢谢你', '我们彼此都比较伤心']);
  const hasFabrication =
    ks.includes('uncertainty') ||
    ks.includes('invented_dialogue') ||
    ks.includes('inner_thought') ||
    ks.includes('literary');
  expect('结构型违规不会被判为编造（不会降级成流水账）', !hasFabrication, JSON.stringify(ks));
}

console.log('\n================ 结论 ================');
if (failed === 0) {
  console.log('✓ 四类结构检查全部按预期命中，且不会误触发降级。');
} else {
  console.log(`✗ 有 ${failed} 项断言失败。`);
  process.exit(1);
}
