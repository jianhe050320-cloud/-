/**
 * B（数据体验修正）的真实浏览器验证：
 *   1) 「我的故事」同步状态条是否已改成「已同步到云端」；
 *   2) 设置页是否有「数据说明」四条 + 「导入故事」入口，且不再出现「已保存在本机」。
 *
 * 前置：dev server 跑在 5175；chrome 以 --remote-debugging-port=9333 启动。
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/bCheck.ts
 */
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const BASE = 'http://localhost:5175';
const OUT = 'c:/Users/86198/CodeBuddy/20260907111151/shots';
const STORE_KEY = 'interviewer.v1:stories';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FIXTURE = [
  {
    id: 's1',
    title: '第一次来到大学',
    topic: 'first_university',
    content: '第一次来大学的时候，我觉得一切都特别神奇。发现这里的树特别特别高。',
    storyType: 'life_moment',
    storyStatus: 'saved',
    kind: 'fragment',
    threadId: 'th_1',
    sourceMessageIds: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
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

  const payload = JSON.stringify({
    state: { stories: FIXTURE, syncStatus: 'synced', syncError: '' },
    version: 0,
  });

  console.log('========== B 验证 ==========');
  await cdp.send('Page.navigate', { url: `${BASE}/#/stories` });
  await sleep(3000);
  await evaluate(`localStorage.setItem('${STORE_KEY}', ${JSON.stringify(payload)})`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(3500);

  const list = await evaluate(
    `(function(){var t=document.body.innerText||'';var s=t.match(/已保存在本机|已同步到云端|正在同步|离线暂存中/);return JSON.stringify({同步状态:s?s[0]:'none',有已保存在本机:t.indexOf('已保存在本机')>=0});})()`,
  );
  console.log('  我的故事：' + String(list));
  await shot('B1_my_stories_sync');

  await evaluate(`location.hash = '#/settings'`);
  await sleep(2500);
  await viewport(1400);
  const settings = await evaluate(
    `(function(){var t=document.body.innerText||'';return JSON.stringify({
      有数据说明:t.indexOf('数据说明')>=0,
      有游客绑定说明:t.indexOf('数据会与当前浏览器绑定')>=0,
      有换设备提示:t.indexOf('更换设备或清除浏览器数据')>=0,
      有后续账号说明:t.indexOf('后续会支持绑定账号')>=0,
      有导入故事:t.indexOf('导入故事')>=0,
      有导出JSON:t.indexOf('导出 JSON')>=0,
      有已保存在本机:t.indexOf('已保存在本机')>=0,
      有数据会丢失:t.indexOf('数据会丢失')>=0,
      同步文案:(t.match(/已同步到云端|正在同步|离线暂存中/)||['none'])[0]
    });})()`,
  );
  console.log('  设置页：' + String(settings));
  await shot('B2_settings_data');

  async function viewport(height: number): Promise<void> {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    });
  }

  ws.close();
  console.log('\n完成。');
}

void main();
