/**
 * 第三轮：内容来源（contentSource）的数据契约验收。
 *
 * 覆盖用户点名的 9 条：
 *   1 首次保存（未编辑）→ content = AI 整理版，source = ai
 *   2 用户编辑 → source = user
 *   3 用户编辑后重新整理 → content 不被覆盖、aiDraft 更新
 *   4 用户主动采用 AI 版 → content = aiDraft，source = ai
 *   5 legacy + 有 aiDraft → displayContent = aiDraft
 *   6 legacy + 无 aiDraft → displayContent = content
 *   7 首页/详情页用同一个 displayContent
 *   8 重新整理不能把旧 AI 稿当唯一事实来源
 *   9 导出/导入保留 contentSource，老文件按 legacy
 *
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/storyContent.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { displayContent, resolveSaveContent } from '../src/services/storyContent';
import { buildInsertRow, parseStoryExport } from '../src/services/storyTransfer';
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

/** 用户原始讲述（流水账）与 AI 整理版，两者明显不同 */
const RAW = '就是那个下雨天，我在校门口站着，然后也没干嘛，站了一会儿就走了。';
const DRAFT = '那天下了很大的雨，我在校门口站了很久。\n\n后来雨小了，我才慢慢走回去。';

function makeStory(patch: Partial<Story> = {}): Story {
  return {
    id: 's1',
    title: '学校门口的那场雨',
    topic: 'small_night',
    content: RAW,
    aiDraft: DRAFT,
    contentSource: 'legacy',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_1',
    sourceMessageIds: [],
    memory: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...patch,
  } as Story;
}

function main(): void {
  console.log('\n========== 1. 首次保存（用户没改） ==========');
  {
    const saved = resolveSaveContent({ aiDraft: DRAFT, userContent: DRAFT, userTouched: false });
    assert(saved.content === DRAFT, 'content 落库的是 AI 整理版（不是原始流水账）');
    assert(saved.contentSource === 'ai', "contentSource = 'ai'");
    assert(!saved.content.includes('然后也没干嘛'), '流水账不会进入最终故事');
  }

  console.log('\n========== 2. 用户编辑 ==========');
  {
    const mine = '那天雨特别大，我在校门口站了很久，后来雨小了才走。';
    const saved = resolveSaveContent({
      aiDraft: DRAFT,
      userContent: mine,
      userTouched: true,
      previousSource: 'ai',
    });
    assert(saved.content === mine, 'content = 用户版本');
    assert(saved.contentSource === 'user', "contentSource = 'user'");
  }

  console.log('\n========== 3. 用户编辑后重新整理 ==========');
  {
    const mine = '我自己写的那一版。';
    const newDraft = '重新整理后的一版。';
    const saved = resolveSaveContent({
      aiDraft: newDraft,
      userContent: mine,
      userTouched: false,
      previousSource: 'user',
    });
    assert(saved.content === mine, '用户版本没有被新的整理稿覆盖');
    assert(saved.contentSource === 'user', "contentSource 仍然是 'user'");
    // aiDraft 由页面另行更新（与 content 分开落库）
    const row = buildInsertRow(makeStory({ aiDraft: newDraft, content: mine, contentSource: 'user' }));
    assert(row.ai_draft === newDraft, 'aiDraft 更新为新整理稿');
    assert(row.content === mine, '同一次写入里 content 仍是用户版本');
  }

  console.log('\n========== 4. 用户主动采用 AI 整理版 ==========');
  {
    const saved = resolveSaveContent({
      aiDraft: DRAFT,
      userContent: '旧的自写版本。',
      userTouched: false,
      previousSource: 'user',
      adoptedAiDraft: true,
    });
    assert(saved.content === DRAFT, 'content = aiDraft');
    assert(saved.contentSource === 'ai', "contentSource 回到 'ai'");
  }

  console.log('\n========== 5/6/7. displayContent 是唯一阅读入口 ==========');
  {
    assert(displayContent(makeStory({ contentSource: 'legacy' })) === DRAFT, 'legacy + 有 aiDraft → 显示 aiDraft');
    assert(
      displayContent(makeStory({ contentSource: 'legacy', aiDraft: undefined })) === RAW,
      'legacy + 无 aiDraft → 显示 content',
    );
    assert(
      displayContent(makeStory({ contentSource: 'user', content: '我写的。' })) === '我写的。',
      'user → 永远显示用户版本',
    );
    assert(displayContent(makeStory({ contentSource: 'ai' })) === DRAFT, 'ai → 显示整理稿');

    // 落库的 content 与阅读内容一致（不再出现"库里是流水账、页面读 aiDraft"的断层）
    const legacyRow = buildInsertRow(makeStory({ contentSource: 'legacy', aiDraft: undefined }));
    assert(legacyRow.content === RAW, '导入/写入不会篡改 legacy 的 content');

    const src = readFileSync(join(process.cwd(), 'src/components/stories/StoryCard.tsx'), 'utf8');
    const detail = readFileSync(join(process.cwd(), 'src/pages/StoryDetailPage.tsx'), 'utf8');
    assert(/displayContent\(/.test(src), '首页卡片用 displayContent');
    assert(/displayContent\(/.test(detail), '详情页用 displayContent');
    assert(!/excerptOf\(story\.content\)/.test(src), '首页不再直接截取 story.content');
  }

  console.log('\n========== 8. 重新整理的事实来源优先级 ==========');
  {
    const writer = readFileSync(join(process.cwd(), 'src/services/storyWriter.ts'), 'utf8');
    const confirm = readFileSync(join(process.cwd(), 'src/pages/StoryConfirmPage.tsx'), 'utf8');
    // 重新整理走 writeStory（原始对话 + memory + outline），不拿旧 AI 稿继续加工
    assert(/renderTranscript\(input\.messages/.test(writer), '写手以原始对话为素材');
    assert(/renderMemoryDigest\(input\.memory\)/.test(writer), '写手以 Story Memory 为事实地图');
    assert(/renderOutline\(/.test(writer), '写手以 Story Outline 为结构');
    assert(
      !/content[\s\S]{0,60}!==[\s\S]{0,30}aiDraft/.test(confirm),
      '确认页不再用 content !== aiDraft 判断用户是否编辑过',
    );
    assert(/contentSource/.test(confirm), '确认页用显式 contentSource 决定保存语义');
  }

  console.log('\n========== 9. 导出 / 导入 ==========');
  {
    const mine = makeStory({ contentSource: 'user', content: '我写的。' });
    const legacy = makeStory({ id: 's2', contentSource: 'legacy' });
    const parsed = parseStoryExport(JSON.stringify({ stories: [mine, legacy] }, null, 2));
    assert(parsed[0].contentSource === 'user', '导出文件里的 user 来源被正确读回');
    assert(parsed[1].contentSource === 'legacy', 'legacy 原样保留');

    // 老文件（没有 contentSource 字段）→ legacy
    const oldFile = JSON.stringify({
      stories: [{ ...makeStory(), contentSource: undefined }],
    });
    assert(parseStoryExport(oldFile)[0].contentSource === 'legacy', '老导出文件按 legacy 处理');

    const row = buildInsertRow(mine);
    assert(row.content_source === 'user', '写入行带上 content_source');
    const legacyRow = buildInsertRow(legacy);
    assert(legacyRow.content_source === 'legacy', 'legacy 写入时也标 legacy');
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

main();
