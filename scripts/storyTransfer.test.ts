/**
 * 数据体验修正（B）：导出/导入 + 同步文案。
 *
 * 覆盖：
 *   解析校验（非法 JSON / 缺字段 / 空文件 / 不是导出文件）
 *   追加合并（正常导入 / 重复导入 / 多故事 / 不覆盖已有 / 跨身份签名去重）
 *   落库行（不带 owner_id → 不绕过 RLS；保留 createdAt / updatedAt）
 *   文案红线（不再出现「已保存在本机」；设置页有数据说明与导入入口）
 *
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/storyTransfer.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildInsertRow,
  parseStoryExport,
  planImport,
  storySignature,
} from '../src/services/storyTransfer';
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
    memory: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...patch,
  };
}

/** 现有的导出格式：{ stories: [...] } */
function toExport(list: Story[]): string {
  return JSON.stringify({ stories: list }, null, 2);
}

function throwsMessage(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/* ---------------- 解析校验 ---------------- */
function testParse(): void {
  console.log('\n========== 导入解析：校验必须明确 -=========');

  const ok = parseStoryExport(toExport([makeStory()]));
  assert(ok.length === 1 && ok[0].id === 's1', '正常导出文件能解析出 1 条故事');

  const bare = parseStoryExport(JSON.stringify([makeStory()]));
  assert(bare.length === 1, '兼容顶层直接是数组的旧文件');

  const badJson = throwsMessage(() => parseStoryExport('{ this is not json'));
  assert(badJson.includes('不是有效的 JSON'), `非法 JSON 给出明确错误（实际：${badJson}）`);

  const empty = throwsMessage(() => parseStoryExport('   '));
  assert(empty.includes('空的'), `空文件给出明确错误（实际：${empty}）`);

  const notExport = throwsMessage(() => parseStoryExport('{"a":1}'));
  assert(notExport.includes('stories'), `不是导出文件时明确提示（实际：${notExport}）`);

  const emptyList = throwsMessage(() => parseStoryExport('{"stories":[]}'));
  assert(emptyList.includes('没有故事'), `stories 为空时明确提示（实际：${emptyList}）`);

  for (const field of ['id', 'title', 'content', 'createdAt']) {
    const broken = makeStory() as unknown as Record<string, unknown>;
    delete broken[field];
    const message = throwsMessage(() => parseStoryExport(toExport([broken as unknown as Story])));
    assert(
      message.includes('缺少必要字段') && message.includes(field),
      `缺少 ${field} 时报错并指出字段名（实际：${message}）`,
    );
  }

  const badType = throwsMessage(() => parseStoryExport('{"stories":[123]}'));
  assert(badType.includes('格式不对'), `条目不是对象时明确提示（实际：${badType}）`);

  // 解析结果必须保真：用户文本不被改写
  const source = makeStory({ kind: 'full' });
  const parsed = parseStoryExport(toExport([source]))[0];
  assert(parsed.content === source.content, '导入解析不改写用户正文');
  assert(parsed.title === source.title, '导入解析不改写标题');
  assert(parsed.createdAt === source.createdAt && parsed.updatedAt === source.updatedAt, '保留原来的 createdAt / updatedAt');
  assert(parsed.kind === 'full', 'kind 原样保留');
}

/* ---------------- 追加 / 合并 / 去重 ---------------- */
function testPlan(): void {
  console.log('\n========== 导入计划：追加合并且不重复 -=========');

  const a = makeStory({ id: 'a', title: '第一次来到大学' });
  const b = makeStory({ id: 'b', title: '老师提出了电车难题', createdAt: '2026-09-02T00:00:00.000Z' });
  const c = makeStory({ id: 'c', title: '第一次自己赚钱', createdAt: '2026-09-03T00:00:00.000Z' });

  // 1) 空库 → 全部写入
  const fresh = planImport([], [a, b]);
  assert(fresh.toInsert.length === 2 && fresh.skipped === 0, '空库导入：2 条全部写入');

  // 2) 同一份文件再导一次 → 全部跳过（重复导入不产生重复故事）
  const again = planImport([a, b], [a, b]);
  assert(again.toInsert.length === 0 && again.skipped === 2, '重复导入：2 条全部跳过');

  // 3) 多故事：库里 1 条，导入 3 条 → 只写 2 条
  const partial = planImport([a], [a, b, c]);
  assert(
    partial.toInsert.map((item) => item.id).join(',') === 'b,c' && partial.skipped === 1,
    '多故事导入：已存在的跳过、其余写入',
  );

  // 4) 文件内部重复 → 只写一次
  const dupInFile = planImport([], [a, { ...a }]);
  assert(dupInFile.toInsert.length === 1 && dupInFile.skipped === 1, '文件内重复也只会写入一次');

  // 5) 不覆盖已有故事：已有那条不在待写列表里，且内容不变
  const existing = makeStory({ id: 'a', title: '第一次来到大学', content: '我自己改过的版本。' });
  const incoming = makeStory({ id: 'a', title: '第一次来到大学', content: '导入文件里的旧版本。' });
  const noOverwrite = planImport([existing], [incoming]);
  assert(noOverwrite.toInsert.length === 0, '同 id 的故事不会被再次写入（不覆盖）');
  assert(existing.content === '我自己改过的版本。', '已有故事的内容没有被改动');

  // 6) 跨游客身份：id 变了但「标题+创建时间」相同 → 仍然去重
  const importedBefore = makeStory({ id: 'new-uuid-after-import', title: '第一次来到大学' });
  const crossIdentity = planImport([importedBefore], [a]);
  assert(crossIdentity.toInsert.length === 0 && crossIdentity.skipped === 1, '换过身份再导入同一份文件：靠签名去重，不产生重复');
  assert(
    storySignature(a) === storySignature(importedBefore),
    '去重签名只看标题与创建时间（不受 id 变化影响）',
  );
}

/* ---------------- 落库行：RLS 与时间保真 ---------------- */
function testInsertRow(): void {
  console.log('\n========== 落库行：归属交给 RLS，时间保真 -=========');

  const story = makeStory({ kind: 'fragment', aiDraft: 'AI 整理版', threadId: 'th_9' });

  const withId = buildInsertRow(story, { withId: true });
  assert(!('owner_id' in withId), '写入行不带 owner_id（归属由 auth.uid() 默认值决定，不绕过 RLS）');
  assert(withId.id === 's1', '默认带原 id 写入（便于同身份下重复导入去重）');

  const withoutId = buildInsertRow(story, { withId: false });
  assert(!('owner_id' in withoutId), '去掉 id 重试时同样不带 owner_id');
  assert(!('id' in withoutId), '跨身份冲突重试时不带 id（让数据库分配新 id）');

  assert(withId.created_at === story.createdAt, 'created_at 用原来的值');
  assert(withId.updated_at === story.updatedAt, 'updated_at 用原来的值');
  assert(withId.ai_draft === 'AI 整理版', 'aiDraft 与 content 分开保存');
  assert(withId.thread_id === 'th_9', 'threadId 原样保留');
  assert(withId.kind === 'fragment', 'kind 原样保留（fragment 仍是人生片段）');

  const noUpdatedAt = buildInsertRow(makeStory({ updatedAt: '' }), {});
  assert(noUpdatedAt.updated_at === makeStory().createdAt, '缺 updatedAt 时回落到 createdAt');
}

/* ---------------- 文案红线（静态检查） ---------------- */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function testCopy(): void {
  console.log('\n========== 文案：不再暗示「只存在本机」 -=========');
  const root = join(process.cwd(), 'src');
  const myStories = stripComments(readFileSync(join(root, 'pages/MyStoriesPage.tsx'), 'utf8'));
  const settings = stripComments(readFileSync(join(root, 'pages/SettingsPage.tsx'), 'utf8'));

  assert(!/已保存在本机/.test(myStories), '首页不再出现「已保存在本机」');
  assert(!/已保存在本机/.test(settings), '设置页不再出现「已保存在本机」');
  assert(/已同步到云端/.test(myStories), '首页正常状态表达为「已同步到云端」');
  // 但不许只说「已同步到云端」——那会让人以为换设备也能看到（身份其实与浏览器绑定）
  assert(/已同步到云端 · 这台设备/.test(myStories), '首页状态写明是「这台设备」上的故事');
  assert(/已同步到云端/.test(settings), '设置页正常状态表达为「已同步到云端」');
  assert(/正在同步/.test(myStories) && /离线暂存中/.test(myStories), '仍然保留「正在同步 / 离线暂存中」两种真实状态');

  assert(/数据说明/.test(settings), '设置页有「数据说明」');
  assert(/游客身份，数据会与当前浏览器绑定/.test(settings), '说明游客身份与浏览器绑定');
  assert(/微信/.test(settings) && /都会被当作一台新设备/.test(settings), '说明在微信/换手机/换浏览器都算新设备');
  assert(/换设备前，请先在旧设备「导出 JSON」/.test(settings), '说明换设备前先导出，并给出导入这一步');
  assert(!/数据会丢失|数据将丢失/.test(settings), '不制造恐慌（不写「数据会丢失」）');
  assert(/导入故事/.test(settings), '设置页有「导入故事」入口');
  assert(/导入是追加，不会覆盖/.test(settings), '说明了导入是追加、不覆盖');
}

function main(): void {
  testParse();
  testPlan();
  testInsertRow();
  testCopy();
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
