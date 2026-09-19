/**
 * 线上端到端自检（真实浏览器）：
 *   1) 测试域名中间页能不能穿透、穿透后应用是否正常挂载；
 *   2) 不带 # 的深链是否被改写成 /#/xxx（不再 404）；
 *   3) 云端读写是否真的通（看「我的故事」的同步状态条）；
 *   4) 身份存在哪里（匿名身份绑定浏览器的机制）。
 *
 * 前置：以 --remote-debugging-port=9333 启动 chrome。
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/liveLinkCheck.ts
 */
const PORT = 9333;
const LIVE = 'https://hj-d5ggpl6f9e4e8453b-1484234591.tcloudbaseapp.com';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Reply {
  id?: number;
  result?: { result?: { value?: unknown } };
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  async function evaluate(expression: string): Promise<unknown> {
    const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.result?.value;
  }

  console.log('========== 线上自检 ==========');
  await cdp.send('Page.navigate', { url: `${LIVE}/` });
  await sleep(5000);

  // 测试域名中间页：等 3 秒倒计时后点「确定访问」
  const isNotice = await evaluate(`(document.body.innerText||'').includes('页面访问提示')`);
  console.log('  到达时是否中间页 =', isNotice);
  if (isNotice) {
    await sleep(3500);
    const clicked = await evaluate(
      `(() => { const b = document.getElementById('submitBtn'); if (!b || b.disabled) return 'not-ready'; b.click(); return 'clicked'; })()`,
    );
    console.log('  点「确定访问」=', clicked);
    await sleep(6000);
  }

  const state = await evaluate(
    `(function(){var t=document.body.innerText||'';var sync=t.match(/已保存在本机|正在同步|云端已同步|离线暂存中/);var cnt=t.match(/已经留下[^，。]*个故事/);return JSON.stringify({title:document.title,mounted:(document.getElementById('root')||{children:[]}).children.length>0,sync:sync?sync[0]:'none',count:cnt?cnt[0]:'none',idKeys:Object.keys(localStorage).filter(function(k){return /auth|tcb|cloudbase|token/i.test(k);}).slice(0,6)});})()`,
  );
  console.log('  HOME: ' + String(state));

  // 深链（不带 #）应被改写成 /#/stories
  await cdp.send('Page.navigate', { url: `${LIVE}/stories` });
  await sleep(5000);
  const deep = await evaluate(
    `(function(){var t=document.body.innerText||'';var sync=t.match(/已保存在本机|正在同步|云端已同步|离线暂存中/);var cnt=t.match(/已经留下[^，。]*个故事/);return JSON.stringify({href:location.href,mounted:(document.getElementById('root')||{children:[]}).children.length>0,is404:t.indexOf('NoSuchKey')>=0,sync:sync?sync[0]:'none',count:cnt?cnt[0]:'none',idKeys:Object.keys(localStorage).filter(function(k){return /auth|tcb|cloudbase|token/i.test(k);}).slice(0,6)});})()`,
  );
  console.log('  DEEP: ' + String(deep));
  // 再等一会，确认云端读完之后的状态
  await sleep(4000);
  const after = await evaluate(
    `(function(){var t=document.body.innerText||'';var sync=t.match(/已保存在本机|正在同步|云端已同步|离线暂存中/);var cnt=t.match(/已经留下[^，。]*个故事/);return JSON.stringify({sync:sync?sync[0]:'none',count:cnt?cnt[0]:'none'});})()`,
  );
  console.log('  DEEP(稍后): ' + String(after));

  ws.close();
}

void main();
