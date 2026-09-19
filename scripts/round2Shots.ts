/**
 * 第二轮 UI 验收：真机视口（390×844）截 7 张图。
 *   1 首页（目录式卡片） 2 单张卡片 3 详情页顶部 4 正文阅读
 *   5 「想起来了吗？」 6 「也许你还记得……」 7 首页底部（最后一张卡完整可见）
 *
 * 前置：dev server 在 5175；chrome 以 --remote-debugging-port=9333 启动。
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/round2Shots.ts
 */
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const BASE = 'http://localhost:5175';
const OUT = 'c:/Users/86198/CodeBuddy/20260907111151/shots';
const STORE_KEY = 'interviewer.v1:stories';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const BODY = [
  '其实说不清楚自己是从什么时候开始变的，是做了一些事情的时候，才发现自己好像有了一些改变。',
  '那阵子去乡村支教，和一群之前不大熟悉的小伙伴一起。我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚，觉得自己没能做好，我哭了。我自己是想要做些什么帮助到大家的。哭出来之后好了不少。',
  '接住我的人是领队。活动开始前我们还不认识，通过完成一些任务我们熟悉起来了，他给了我很多的帮助，让我更好地担任副队长这个职位。我和队长完成有分歧的时候，我对完成任务的方式有质疑，但是我不敢提出来，他鼓励我说出来。',
  '我之前其实提到过很多次了，但是没有被回应，觉得对方不太能接受我的处理任务的方式。后来我说出来了，我们彼此都比较伤心。',
].join('\n\n');

const STORIES = [
  {
    id: 'r2-1',
    title: '做了一些事情才发现',
    topic: 'self_changed',
    content: BODY,
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'full',
    threadId: 'th_r2_1',
    sourceMessageIds: [],
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    memory: {
      people: [
        { name: '领队', relationship: '组织者', importance: 5 },
        { name: '队长', relationship: '组织者', importance: 4 },
      ],
      events: [{ description: '去乡村支教', time: '', place: '乡村', importance: 5 }],
      details: [{ detail: '哭出来之后好了不少' }],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['我之前其实提到过很多次了，但是没有被回应。'],
      story_status: 'saved',
    },
    outline: { core: '', people: [], moments: ['我哭了那一晚'], quotes: [], not_write: [] },
  },
  {
    id: 'r2-2',
    title: '我一直记得他',
    topic: 'people_remember',
    content:
      '我会想到当时我和其他的小朋友都会欺负他。他是一个三四十岁的中年男性，他最喜欢自言自语，在村子里面很不受待见。当时聚在一起一起骂他，我现在想起来还是觉得不太应该。',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_r2_2',
    sourceMessageIds: [],
    createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: '2026-09-16T09:00:00.000Z',
    memory: null,
    outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
  },
  {
    id: 'r2-3',
    title: '高中没被看见的时光',
    topic: 'first_university',
    content:
      '刚进大学校园那天，我绕了一大圈才走到报到的地方。辅导员在报到当天帮忙给新生登记。广州周围的一切对我来说都很陌生，我当时只想着赶紧把行李放下。',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_r2_3',
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
      /* chrome 未就绪 */
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

  /** 滚动的是 PhoneShell 里的 main，不是 window */
  const scrollMain = (top: number) =>
    evaluate(`(function(){var m=document.querySelector('main'); if(!m) return 'no-main'; m.scrollTop=${top}; return Math.round(m.scrollTop);})()`);

  const scrollBottom = () =>
    evaluate(`(function(){var m=document.querySelector('main'); if(!m) return 'no-main'; m.scrollTop=m.scrollHeight; return Math.round(m.scrollTop);})()`);

  const payload = JSON.stringify({
    state: { stories: STORIES, syncStatus: 'synced', syncError: '' },
    version: 0,
  });

  console.log('========== 准备数据 ==========');
  await cdp.send('Page.navigate', { url: `${BASE}/#/stories` });
  await sleep(3000);
  await evaluate(`localStorage.setItem('${STORE_KEY}', ${JSON.stringify(payload)})`);

  console.log('========== 1 首页 ==========');
  await viewport(844);
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(3800);
  await shot('R1_home');

  console.log('========== 2 单张卡片 ==========');
  await viewport(560);
  await evaluate(`location.hash = '#/stories'`);
  await sleep(1500);
  await shot('R2_card');
  await viewport(844);

  console.log('========== 3 详情页顶部 ==========');
  await evaluate(`location.hash = '#/story/r2-1'`);
  await sleep(2500);
  await shot('R3_detail_top');

  console.log('========== 4 正文阅读 ==========');
  await viewport(1200);
  await sleep(800);
  await shot('R4_reading');
  await viewport(844);

  console.log('========== 5 想起来了吗 ==========');
  await scrollMain(430);
  await sleep(900);
  await shot('R5_recall_invite');

  console.log('========== 6 也许你还记得 ==========');
  await scrollBottom();
  await sleep(900);
  await shot('R6_recall_prompts');

  console.log('========== 7 首页底部：最后一张卡 + CTA ==========');
  await evaluate(`location.hash = '#/stories'`);
  await sleep(2000);
  await scrollBottom();
  await sleep(900);
  await shot('R7_home_bottom');

  const overflow = await evaluate(
    `(function(){var m=document.querySelector('main');return JSON.stringify({横向溢出:document.documentElement.scrollWidth>innerWidth,主区可滚动:m?m.scrollHeight>m.clientHeight:null});})()`,
  );
  console.log('  ' + String(overflow));

  ws.close();
  console.log('\n完成。');
}

void main();
