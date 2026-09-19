/**
 * 「我的故事」真实浏览器截图（Chrome DevTools Protocol）。
 *
 * 为什么用 CDP 而不是 `chrome --screenshot`：
 *   1. 能精确控制 deviceMetrics（真机视口 390x844），避免缩放口径不一致导致截图右侧被裁；
 *   2. 能注入点击（用来截「编辑状态」）；
 *   3. 能按内容高度调视口，一屏看全一页。
 *
 * 前置：先以 --remote-debugging-port=9333 启动 chrome，再运行本脚本。
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/cdpShots.ts
 *
 * 产出：<工作区>/shots/*.png
 */
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const BASE = 'http://localhost:5175';
const OUT = 'c:/Users/86198/CodeBuddy/20260907111151/shots';
const STORE_KEY = 'interviewer.v1:stories';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 截图用的样例故事：刻意写成大学生语境，且内容全部来自「用户说过的话」 */
const FIXTURE = [
  {
    id: 's1',
    title: '第一次来到大学',
    topic: 'first_university',
    content:
      '第一次来大学的时候，我觉得一切都特别神奇。发现这里的树特别特别高，比我以前见过的都高。\n\n那天我爸帮我扛着行李，走到宿舍楼下的时候，他说了一句「以后就靠你自己了」。\n\n具体是哪一年我已经不记得了。',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_seed_1',
    sourceMessageIds: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    memory: {
      people: [{ name: '爸爸', relationship: '爸爸', importance: 4 }],
      events: [{ description: '第一次来大学', time: '', place: '宿舍楼下', importance: 4 }],
      details: [{ detail: '这里的树特别特别高' }],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['第一次来大学的时候，我觉得一切都特别神奇。'],
      story_status: 'saved',
    },
    outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
  },
  {
    id: 's2',
    title: '老师提出了电车难题',
    topic: 'people_teacher',
    content:
      '大一的时候，有一位给我上思政课的老师，课上会分享很多学习资料。\n\n后来老师提出了电车难题，让我们自己去思考。\n\n我并没有想出答案，只是很享受这个过程。',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_seed_2',
    sourceMessageIds: [],
    createdAt: '2026-09-05T20:00:00.000Z',
    updatedAt: '2026-09-15T20:00:00.000Z',
    memory: {
      people: [{ name: '思政课老师', relationship: '老师', importance: 4 }],
      events: [{ description: '老师提出电车难题', time: '', place: '教室', importance: 4 }],
      details: [{ detail: '课上会分享很多学习资料' }],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['我并没有想出答案，只是很享受这个过程。'],
      story_status: 'saved',
    },
    outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
  },
  {
    id: 's3',
    title: '第一次自己赚钱',
    topic: 'first_earn',
    content:
      '大二下学期，我接了第一份兼职，是在学校旁边的一家咖啡店做兼职。\n\n第一个月拿到工资的时候是晚上，我站在路边把手机银行打开看了好几遍，确认那串数字是真的。\n\n我先给妈妈转了一半，剩下的给自己买了一直没舍得买的耳机。\n\n那天下班路上，我记得风挺大的，但我一直低着头在笑。',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'full',
    threadId: 'th_seed_3',
    sourceMessageIds: [],
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    memory: {
      people: [{ name: '妈妈', relationship: '妈妈', importance: 4 }],
      events: [
        { description: '第一份兼职', time: '大二下学期', place: '学校旁边的咖啡店', importance: 5 },
      ],
      details: [{ detail: '给妈妈转了一半工资' }, { detail: '买了一只耳机' }],
      emotions: [],
      turning_points: [],
      meaning: [],
      user_quotes: ['我把手机银行打开看了好几遍，确认那串数字是真的。'],
      story_status: 'saved',
    },
    outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
  },
];

interface CdpReply {
  id?: number;
  result?: { result?: { value?: unknown }; data?: string };
}

class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (value: CdpReply) => void>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data)) as CdpReply;
      if (typeof msg.id === 'number') {
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpReply> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function findPageWs(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[];
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* chrome 还没起来 */
    }
    await sleep(500);
  }
  throw new Error('无法连接到 Chrome 调试端口');
}

async function main(): Promise<void> {
  const ws = new WebSocket(await findPageWs());
  await new Promise<void>((resolve) => {
    ws.onopen = () => resolve();
  });

  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // 屏蔽云端读接口，否则线上故事会覆盖本地样例数据。
  // 注意：不要写 *cloudbase*，那会把应用自身的 /src/lib/cloudbase.ts 一起拦掉，导致页面不挂载。
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

  async function evaluate(expression: string): Promise<unknown> {
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.result?.value;
  }

  async function shot(name: string): Promise<void> {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (!res.result?.data) throw new Error(`截图失败：${name}`);
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.result.data, 'base64'));
    console.log(`  ✓ ${name}.png`);
  }

  async function state(label: string): Promise<void> {
    const info = await evaluate(
      `JSON.stringify({url: location.href.slice(0, 55), 视口: innerWidth + 'x' + innerHeight, 横向溢出: document.documentElement.scrollWidth > innerWidth, 故事数: (JSON.parse(localStorage.getItem('${STORE_KEY}')||'{}').state||{}).stories?.length ?? null, 已挂载: (document.getElementById('root')?.children.length ?? 0) > 0, 文本前40字: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 40)})`,
    );
    console.log(`  [${label}] ${info}`);
  }

  const payload = JSON.stringify({
    state: { stories: FIXTURE, syncStatus: 'synced', syncError: '' },
    version: 0,
  });

  console.log('========== 0. 写入样例故事并加载 ==========');
  await cdp.send('Page.navigate', { url: `${BASE}/#/stories` });
  await sleep(3000);
  await evaluate(`localStorage.setItem('${STORE_KEY}', ${JSON.stringify(payload)})`);
  await viewport(844);
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(3800);
  await state('home');
  await shot('1_home_cards');

  await viewport(1100);
  await sleep(700);
  await shot('2_home_full');

  console.log('========== 2. 故事详情 ==========');
  await viewport(844);
  await sleep(400);
  await evaluate(`location.hash = '#/story/s1'`);
  await sleep(2200);
  await state('detail');
  await shot('3_detail_top');

  await viewport(1500);
  await sleep(900);
  await shot('4_detail_full');

  console.log('========== 2.5 继续讲这段 → 是否续接原 Thread ==========');
  const continueClicked = await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '继续讲这段'); if (!b) return 'not-found'; b.click(); return 'clicked'; })()`,
  );
  await sleep(2000);
  const afterContinue = await evaluate('location.href');
  console.log('  点击 =', continueClicked);
  console.log('  跳转 =', String(afterContinue).replace(BASE, ''));

  // 回到详情页，继续截编辑状态
  await evaluate(`location.hash = '#/story/s1'`);
  await sleep(1800);

  console.log('========== 3. 编辑状态 ==========');
  const clicked = await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === '编辑'); if (!b) return 'not-found'; b.click(); return 'clicked'; })()`,
  );
  console.log('  点击编辑 =', clicked);
  await sleep(1200);
  await shot('5_edit_state');

  console.log('========== 4. 空状态 ==========');
  await evaluate(`localStorage.removeItem('${STORE_KEY}')`);
  await evaluate(`location.hash = '#/stories'`);
  await sleep(300);
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(3500);
  await viewport(844);
  await sleep(900);
  await state('empty');
  await shot('6_empty_state');

  ws.close();
  console.log('\n完成。');
}

void main();
