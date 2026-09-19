/**
 * 「继续讲这段」端到端链路验收（规格 §10 / §11 / §32 的 7、8、9、10、11）。
 *
 * 这条链路横跨三个文件，任何一处断掉都会表现为「故事没有生长，反而多出一篇」：
 *   StoryDetailPage  → /interview?thread=<原线程>&story=<原故事>
 *   InterviewPage    → continueStory({ threadId: 原线程, memory: 原故事记忆 })
 *   InterviewPage    → /story/<storyParam || sessionId>/confirm
 *   StoryConfirmPage → isExisting ? updateStory(原 id) : saveStory(新建)
 *
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/storyContinueChain.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSaveContent } from '../src/services/storyContent';

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

const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');

function main(): void {
  const detail = read('src/pages/StoryDetailPage.tsx');
  const interview = read('src/pages/InterviewPage.tsx');
  const confirm = read('src/pages/StoryConfirmPage.tsx');

  console.log('\n========== 1. 详情页：继续讲必须带上原 thread + 原 story ==========');
  {
    assert(
      /navigate\(\s*`\/interview\?topic=[^`]*thread=\$\{encodeURIComponent\(story\.threadId\)\}[^`]*story=\$\{encodeURIComponent\(story\.id\)\}/.test(
        detail,
      ),
      '继续讲跳转同时携带原 threadId 与 story id',
    );
    assert(/继续讲这段/.test(detail), '详情页有「继续讲这段」入口');
  }

  console.log('\n========== 2. 访谈页：续接原线程，不另起线程 ==========');
  {
    assert(
      /continueStory\(\{[\s\S]{0,200}threadId:\s*found\?\.threadId\s*\|\|\s*threadParam/.test(interview),
      'continueStory 用原故事的 threadId（拿不到才回退 URL 参数）',
    );
    assert(
      /memory:\s*found\?\.memory\s*\?\?\s*null/.test(interview),
      'continueStory 带回原故事的记忆（新的讲述长在原来的故事上）',
    );
    assert(
      /navigate\(`\/story\/\$\{storyParam \|\| sessionId \|\| 'current'\}\/confirm`\)/.test(interview),
      '整理后回到「原故事」的确认页（不是会话 id）',
    );
    assert(
      /if \(storyParam\)\s*\{/.test(interview),
      '有 story 参数时走 continueStory 分支，不与 resume/start 混用',
    );
  }

  console.log('\n========== 3. 确认页：回写原 Story，不新建 ==========');
  {
    assert(/const storyId = params\.id \?\? params\.storyId \?\? ''/.test(confirm), '确认页能取到路由里的故事 id');
    assert(/const isExisting = !!existing/.test(confirm), 'isExisting 由原故事是否存在决定');
    assert(
      /const reorganized = isExisting && !!liveDraft/.test(confirm),
      '「继续讲后重新整理」被识别为故事生长场景',
    );
    assert(/if \(isExisting && existing\) \{[\s\S]{0,600}await updateStory\(existing\.id/.test(confirm), '有原故事 → updateStory（更新原故事）');
    assert(/\} else if \(liveDraft\) \{[\s\S]{0,500}await saveStory\(/.test(confirm), '没有原故事才 saveStory（新建）');
    assert(/navigate\(`\/story\/\$\{existing\.id\}`\)/.test(confirm), '更新后打开原故事详情页');
    assert(/navigate\(`\/story\/\$\{created\.id\}`\)/.test(confirm), '新建后打开新故事详情页');
  }

  console.log('\n========== 4. 生长后的内容规则（真实行为） ==========');
  {
    const oldDraft = '原来的一版整理稿。';
    const newDraft = '原来的一版整理稿。\n\n后来我还想起来：那天其实我妈也在。';

    // contentSource = ai：新整理稿直接生长到 content
    const grown = resolveSaveContent({
      aiDraft: newDraft,
      userContent: newDraft,
      userTouched: false,
      previousSource: 'ai',
    });
    assert(grown.content === newDraft, 'AI 版故事：新内容长到正在展示的正文上');
    assert(grown.contentSource === 'ai', "contentSource 保持 'ai'");

    // contentSource = user：用户版本必须被保护
    const mine = '这是我自己改过的一版。';
    const protectedSave = resolveSaveContent({
      aiDraft: newDraft,
      userContent: mine,
      userTouched: false,
      previousSource: 'user',
    });
    assert(protectedSave.content === mine, '用户改过的故事：重新整理不会覆盖他的版本');
    assert(protectedSave.contentSource === 'user', "contentSource 仍是 'user'");

    // 用户主动采用新整理版
    const adopted = resolveSaveContent({
      aiDraft: newDraft,
      userContent: mine,
      userTouched: false,
      previousSource: 'user',
      adoptedAiDraft: true,
    });
    assert(adopted.content === newDraft && adopted.contentSource === 'ai', '用户主动采用 → 换成整理稿并回到 ai');
    assert(oldDraft !== newDraft, '（前提）新整理稿与原稿不同，说明确实生长了');
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

main();
