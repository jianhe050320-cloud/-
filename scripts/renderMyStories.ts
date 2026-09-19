/**
 * 渲染验证：把「我的故事」相关组件真的渲染成 HTML，检查新界面元素是否存在。
 *
 * 技术说明（重要，否则会误判）：
 *  - src/lib/cloudbase.ts 在模块顶层读 import.meta.env，直接用 tsx 在 Node 加载会崩，
 *    所以用 Vite 的 ssrLoadModule（它会注入 import.meta.env）。
 *  - zustand 在 SSR 时用「创建时的初始状态」当快照（getServerSnapshot），
 *    因此 Node 里渲染不出「已保存的故事」——那是渲染机制，不是产品缺陷。
 *    所以本脚本验证两类**可确定性验证**的东西：
 *      1) 我的故事首页在无数据时的空状态（含文案红线）；
 *      2) 故事卡片在有数据时的字段（图标 / 标题 / 摘录 / 状态 / 时间）。
 *    详情页的正文/回忆入口由 myStoriesAcceptance.test.ts（源码断言 + 纯函数）覆盖，
 *    并在浏览器里人工确认。
 *
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/renderMyStories.ts
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createServer } from 'vite';

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

const STORY = {
  id: 's1',
  title: '老师提出了电车难题',
  topic: 'people_teacher',
  content:
    '大一的时候，有一位给我上思政课的老师，课上会分享很多学习资料。后来老师提出了电车难题，让我们自己去思考。',
  storyType: 'life_moment',
  storyStatus: 'saved',
  kind: 'fragment',
  threadId: 'th_1',
  sourceMessageIds: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  memory: {
    people: [{ name: '老师', relationship: '老师', importance: 4 }],
    events: [],
    details: [],
    emotions: [],
    turning_points: [],
    meaning: [],
    user_quotes: [],
    story_status: 'saved',
  },
  outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
};

async function main(): Promise<void> {
  const server = await createServer({
    root: process.cwd(),
    configFile: 'vite.config.ts',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  try {
    const { MyStoriesPage } = await server.ssrLoadModule('/src/pages/MyStoriesPage.tsx');
    const { StoryDetailPage } = await server.ssrLoadModule('/src/pages/StoryDetailPage.tsx');
    const { StoryCard } = await server.ssrLoadModule('/src/components/stories/StoryCard.tsx');

    const page = (path: string, route: string, Component: unknown): string =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: route, element: createElement(Component as never) }),
          ),
        ) as never,
      );

    console.log('\n========== 我的故事首页（空状态，/stories） ==========');
    const empty = page('/stories', '/stories', MyStoriesPage);
    assert(empty.includes('我的故事'), '顶部标题「我的故事」渲染出来了');
    assert(empty.includes('已经留下 0 个故事'), '「已经留下 N 个故事」渲染出来了');
    assert(empty.includes('这里会放下你想留下的人生片段'), '空状态文案渲染出来了');
    assert(empty.includes('想起一件事了吗'), '空状态提问渲染出来了');
    assert(empty.includes('不用准备，也不用讲完整'), '空状态安抚文案渲染出来了');
    assert(empty.includes('开始讲一件事'), '空状态按钮「开始讲一件事」渲染出来了');
    assert(!empty.includes('暂无数据'), '不出现「暂无数据」');
    assert(!empty.includes('完成度') && !empty.includes('未完成'), '不出现完成焦虑文案');
    assert(!/MemoryEntry|threadId|maturity/.test(empty), '不出现内部概念');

    console.log('\n========== 故事卡片（有数据） ==========');
    const card = renderToStaticMarkup(createElement(StoryCard, { story: STORY, onClick: () => undefined }) as never);
    assert(card.includes('老师提出了电车难题'), '卡片显示故事标题');
    assert(card.includes('大一的时候，有一位给我上思政课的老师'), '卡片显示真实摘录（来自正文）');
    assert(card.includes('人生片段'), 'fragment 显示为「人生片段」');
    assert(card.includes('还可以继续讲'), 'fragment 提示「还可以继续讲」');
    assert(card.includes('最近记录'), '卡片显示最近记录时间');
    assert(!card.includes('完成度') && !card.includes('未完成'), '卡片不出现完成焦虑');
    assert(!/MemoryEntry|threadId|kind=|maturity/.test(card), '卡片不出现技术字段');

    console.log('\n========== 故事详情（无数据时不崩，/story/:id） ==========');
    const detail = page('/story/missing', '/story/:id', StoryDetailPage);
    assert(detail.length > 0, '详情页可以正常渲染（不抛异常）');
    assert(detail.includes('我的故事'), '详情页有返回「我的故事」的出口');
    assert(!/MemoryEntry|threadId|maturity/.test(detail), '详情页不出现内部概念');
  } finally {
    await server.close();
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

void main();
