/**
 * 第三轮真机验收（390×844）：确认「我的故事」读到的是**整理后的故事**。
 *
 * 关键夹具：
 *   legacy 故事：content = 原始流水账，aiDraft = 整理稿 → 页面必须显示整理稿
 *   user 故事：content = 用户自己写的 → 页面必须显示用户版本
 *
 * 前置：dev server 5175；chrome --remote-debugging-port=9333
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/round3Shots.ts
 */
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const BASE = 'http://localhost:5175';
const OUT = 'c:/Users/86198/CodeBuddy/20260907111151/shots';
const STORE_KEY = 'interviewer.v1:stories';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 原始讲述（流水账，口语、无分段） */
const RAW =
  '就是那个凌晨，我自己看了一部动漫番剧，叫做《我的青春恋爱物语果然有问题》，看完之后我迟迟不能入睡，然后我就躺在床上想东西，脑子特别清晰，想了很多很多的问题，然后感觉特别舒适，然后就觉得很多人际问题都想清楚了。';

/** AI 整理版（自然、分段、与原始讲述用词不同） */
const DRAFT = [
  '我自己看了一部动漫番剧，叫做《我的青春恋爱物语果然有问题》。看完之后，我迟迟不能入睡。',
  '那天凌晨，我躺在床上，脑子特别清晰地思考着很多很多的问题，觉得特别舒适。关于很多人际问题，都想得更加清楚了。',
  '想到的确实是一件具体的事：我愿意承认自己过去一些事情做得不好，而不是一直觉得「明明我这么优秀，却没能把事情做好」。',
].join('\n\n');

const USER_VERSION = [
  '那个凌晨我睡不着，躺着想了很多。',
  '我想明白了一件事：别人的评价只是一种参考，不是决定性的。',
].join('\n\n');

const STORIES = [
  {
    id: 'r3-1',
    title: '那个凌晨想清楚的事',
    topic: 'small_night',
    content: RAW,
    aiDraft: DRAFT,
    contentSource: 'legacy',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_r3_1',
    sourceMessageIds: [],
    createdAt: '2026-09-12T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
    memory: null,
    outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
  },
  {
    id: 'r3-2',
    title: '我一直记得他',
    topic: 'people_remember',
    content: USER_VERSION,
    aiDraft: '（AI 整理版，不应被显示）',
    contentSource: 'user',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_r3_2',
    sourceMessageIds: [],
    createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: '2026-09-16T09:00:00.000Z',
    memory: null,
    outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
  },
  {
    id: 'r3-3',
    title: '高中没被看见的时光',
    topic: 'first_university',
    content: '刚进大学校园那天，我绕了一大圈才走到报到的地方。',
    aiDraft: '刚进大学校园那天，我绕了一大圈才走到报到的地方。',
    contentSource: 'ai',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_r3_3',
    sourceMessageIds: [],
    createdAt: '2026-09-06T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    memory: null,
    outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
  },
];

interface Reply {
  id?: number;
  result?: { result?: { value?: unknown }; data?: string };
}

class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (value: Reply) => void>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data)) as Reply;
      if (typeof msg.id === 'number') {
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Reply> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function findPageWs(): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[];
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 未就绪 */
    }
    await sleep(500);
  }
  throw new Error('无法连接 Chrome 调试端口');
}

async function main(): Promise<void> {
  const ws = new WebSocket(await findPageWs());
  await new Promise<void>((resolve) => {
    ws.onopen = () => resolve();
  });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', {
    urls: ['*tcloudbase*', '*tcloudbasegateway*', '*tencentcloudapi*', '*tcb-api*'],
  });

  const viewport = (height: number) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    });

  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

  const shot = async (name: string): Promise<void> => {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (!res.result?.data) throw new Error(`截图失败：${name}`);
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.result.data, 'base64'));
    console.log(`  ✓ ${name}.png`);
  };

  const bodyText = async (): Promise<string> =>
    String(await evaluate(`(document.body.innerText||'').replace(/\\s+/g,' ')`));

  const scrollBottom = () =>
    evaluate(`(function(){var m=document.querySelector('main'); if(!m) return -1; m.scrollTop=m.scrollHeight; return Math.round(m.scrollTop);})()`);

  const payload = JSON.stringify({
    state: { stories: STORIES, syncStatus: 'synced', syncError: '' },
    version: 0,
  });

  console.log('========== 准备数据 ==========');
  await cdp.send('Page.navigate', { url: `${BASE}/#/stories` });
  await sleep(3000);
  await evaluate(`localStorage.setItem('${STORE_KEY}', ${JSON.stringify(payload)})`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(3800);

  console.log('========== 1/2 首页 + 卡片 ==========');
  await viewport(844);
  await shot('R3_1_home');
  const home = await bodyText();
  console.log('  首页含整理稿句子 =', home.includes('迟迟不能入睡'));
  console.log('  首页含流水账原句 =', home.includes('然后我就躺在床上想东西'));
  // 杂志化：章节编号 + 杂志式日期 + 封面语
  console.log('  首页含章节编号 NO. 01 =', home.includes('NO. 01'));
  console.log('  首页含杂志式日期 =', /20\d\d · \d\d · \d\d/.test(home));
  console.log('  首页含封面语 =', home.includes('我把那些值得记住的时刻'));
  console.log('  首页出现卡片圆角容器 =', await evaluate(`document.querySelectorAll('.card-paper').length`));

  await viewport(560);
  await sleep(600);
  await shot('R3_2_card');
  await viewport(844);

  console.log('========== 3/4/5 详情页 ==========');
  await evaluate(`location.hash = '#/story/r3-1'`);
  await sleep(2500);
  await shot('R3_3_detail_top');
  const detail = await bodyText();
  console.log('  详情含整理稿段落 =', detail.includes('想到的确实是一件具体的事'));
  console.log('  详情含流水账原句 =', detail.includes('然后我就躺在床上想东西'));
  console.log('  详情不含 AI 括注 =', !detail.includes('不应被显示'));
  console.log('  详情含章节编号 =', /NO\. \d\d/.test(detail));
  console.log('  详情含杂志式日期 =', /20\d\d · \d\d · \d\d/.test(detail));
  // 「编辑」必须完整显示（曾经被长标题挤扁截断）
  console.log(
    '  编辑按钮几何 =',
    await evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '编辑'); if (!b) return 'not-found'; const r = b.getBoundingClientRect(); return JSON.stringify({右边界: Math.round(r.right), 视口宽: innerWidth, 宽: Math.round(r.width), 完整显示: r.right <= innerWidth - 2 && r.width >= 20}); })()`,
    ),
  );

  await viewport(1200);
  await sleep(800);
  await shot('R3_4_reading');
  await viewport(844);
  await scrollBottom();
  await sleep(900);
  await shot('R3_5_detail_bottom');

  console.log('========== 6 确认页 ==========');
  await evaluate(`location.hash = '#/story/r3-1/confirm'`);
  await sleep(2600);
  const confirm = await bodyText();
  console.log('  确认页标题为「你的故事」=', confirm.includes('你的故事'));
  console.log('  确认页正文是整理稿 =', confirm.includes('迟迟不能入睡'));
  console.log('  确认页含「保存这个故事」=', confirm.includes('保存这个故事'));
  await shot('R3_6_confirm');

  console.log('========== 7 编辑状态 ==========');
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '编辑'); if (b) b.click(); return Boolean(b); })()`,
  );
  await sleep(1200);
  await shot('R3_7_edit');

  console.log('========== 8 设置页（跨设备搬运说明） ==========');
  await evaluate(`location.hash = '#/settings'`);
  await sleep(2200);
  const settingsText = await bodyText();
  console.log('  含「这台设备」 =', settingsText.includes('这台设备'));
  console.log('  含「微信」 =', settingsText.includes('微信'));
  console.log('  含「都要被当作一台新设备」 =', settingsText.includes('都会被当作一台新设备'));
  await viewport(1000);
  await sleep(700);
  await shot('R3_8_settings');

  await viewport(844);
  await evaluate(`location.hash = '#/stories'`);
  await sleep(1500);
  const homeText = await bodyText();
  console.log('  首页含「已同步到云端 · 这台设备」 =', homeText.includes('已同步到云端 · 这台设备'));
  console.log('  首页含「换设备？先导出再导入」 =', homeText.includes('换设备？先导出再导入'));

  const overflow = await evaluate(
    `JSON.stringify({横向溢出: document.documentElement.scrollWidth > innerWidth})`,
  );
  console.log('  ' + String(overflow));

  ws.close();
  console.log('\n完成。');
}

void main();
