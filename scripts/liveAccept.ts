/**
 * 线上验收（只读，不点击任何会写库的按钮）。
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/liveAccept.ts
 */
import { writeFileSync } from 'node:fs';

const PORT = 9333;
const LIVE = 'https://hj-d5ggpl6f9e4e8453b-1484234591.tcloudbaseapp.com';
const OUT = 'c:/Users/86198/CodeBuddy/20260907111151/shots';
const STORY_ID = process.argv[2] ?? 'd72e4933-d141-4502-84c0-df35ec7364cd';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (v: { result?: { result?: { value?: unknown }; data?: string } }) => void>();
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as { id?: number };
      if (typeof m.id === 'number') {
        const r = this.pending.get(m.id);
        if (r) {
          this.pending.delete(m.id);
          r(m as never);
        }
      }
    };
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    return new Promise<{ result?: { result?: { value?: unknown }; data?: string } }>((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main(): Promise<void> {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl?: string;
  }[];
  const page = list.find((i) => i.type === 'page' && i.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error('无可用调试页');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => {
    ws.onopen = () => r();
  });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  // 无头 Chrome 的 UA 里带 HeadlessChrome，会命中 CDN 的风险提醒页；换成真机 UA
  const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  await cdp.send('Network.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await cdp.send('Network.setExtraHTTPHeaders', {
    headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });

  const viewport = (h: number) =>
    cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: h, deviceScaleFactor: 2, mobile: true });
  const evaluate = async (expr: string): Promise<unknown> =>
    (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  const text = async (): Promise<string> => String(await evaluate(`(document.body.innerText||'').replace(/\\s+/g,' ')`));
  const overflow = async (): Promise<boolean> =>
    Boolean(await evaluate(`document.documentElement.scrollWidth > innerWidth`));
  const shot = async (name: string) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  };

  /** CloudBase 默认域名会先弹一个「页面访问提示」，点掉它才能看到应用本身 */
  const dismiss = async (): Promise<boolean> => {
    const t = await text();
    if (!t.includes('页面访问提示')) return false;
    const clicked = await evaluate(
      `(() => { const els = [...document.querySelectorAll('button,a,div,span')].filter(x => { const s=(x.textContent||'').trim(); return s.length > 0 && s.length < 14 && /继续访问|继续|我知道了/.test(s); }); const el = els[els.length-1]; if (!el) return 'none'; el.click(); return (el.textContent||'').trim(); })()`,
    );
    console.log('  [提示页] 点击 =', clicked);
    await sleep(2500);
    return true;
  };

  const goto = async (url: string, wait = 5000): Promise<void> => {
    await cdp.send('Page.navigate', { url });
    await sleep(wait);
    if (await dismiss()) await sleep(wait);
  };

  await viewport(844);

  console.log('===== 1. 首页 =====');
  await goto(`${LIVE}/?t=${Date.now()}`);
  console.log('  title =', await evaluate('document.title'));
  console.log('  #root 子元素 =', await evaluate(`document.getElementById('root')?.children.length ?? -1`));
  console.log('  可见文字 =', (await text()).slice(0, 70));
  console.log('  横向溢出 =', await overflow());
  await shot('LIVE_1_home');

  console.log('===== 2. /#/stories（我的故事） =====');
  await evaluate(`location.hash = '#/stories'`);
  await sleep(3500);
  const stories = await text();
  console.log('  含「我的故事」 =', stories.includes('我的故事'));
  console.log('  含「已经留下」 =', stories.includes('已经留下'));
  console.log('  含「继续讲一个故事」 =', stories.includes('继续讲一个故事'));
  console.log('  含空状态文案 =', stories.includes('想起一件事了吗') || stories.includes('开始讲一件事'));
  console.log('  卡片数 =', await evaluate(`document.querySelectorAll('article,a[href*="#/story/"]').length`));
  console.log('  横向溢出 =', await overflow());
  await shot('LIVE_2_stories');

  console.log('===== 3. SPA 深链（整页直接打开详情） =====');
  await goto(`${LIVE}/#/story/${STORY_ID}`, 5000);
  const detail = await text();
  console.log('  #root 有内容 =', (await evaluate(`document.getElementById('root')?.children.length ?? -1`)) !== 0);
  console.log('  含「继续讲这段」 =', detail.includes('继续讲这段'));
  console.log('  含「也许你还记得」 =', detail.includes('也许你还记得'));
  console.log('  含「想起来了吗」 =', detail.includes('想起来了吗'));
  console.log('  含「人生片段」 =', detail.includes('人生片段'));
  console.log('  正文片段 =', detail.slice(0, 60));
  console.log('  横向溢出 =', await overflow());
  await shot('LIVE_3_detail');

  console.log('===== 4. 确认页（只读，不点击保存） =====');
  await goto(`${LIVE}/#/story/${STORY_ID}/confirm`, 4500);
  const confirm = await text();
  console.log('  含「你的故事」 =', confirm.includes('你的故事'));
  console.log('  含「保存这个故事」 =', confirm.includes('保存这个故事'));
  console.log('  含「刚才你讲到的」 =', confirm.includes('刚才你讲到的'));
  console.log('  横向溢出 =', await overflow());
  console.log('  页面文字 =', confirm.slice(0, 70));
  await shot('LIVE_4_confirm');

  console.log('===== 5. 404 回退到 SPA =====');
  await goto(`${LIVE}/some/deep/path`, 4000);
  console.log('  #root 子元素 =', await evaluate(`document.getElementById('root')?.children.length ?? -1`));
  console.log('  可见文字 =', (await text()).slice(0, 50));

  ws.close();
  console.log('\n完成。');
}

void main();
