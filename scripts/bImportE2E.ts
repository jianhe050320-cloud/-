/**
 * B 的核心端到端验收（真实浏览器 + 真实云端）：
 *   用全新的浏览器 profile（= 新的游客身份，模拟「换了设备/清了数据」），
 *   在设置页真的选一个导出的 JSON 文件 → 走完「导入故事」→ 看是否恢复；
 *   紧接着再导入一次同一份文件 → 看是否被去重（不产生重复故事）。
 *
 * 注意：本次不屏蔽云端，导入会真的写进 CloudBase（归当前游客身份）。
 * 前置：dev server 跑在 5175；chrome 以 --remote-debugging-port=9333 启动。
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/bImportE2E.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 9333;
const BASE = 'http://localhost:5175';
const TMP_DIR = 'c:/Users/86198/CodeBuddy/20260907111151/shots';
const IMPORT_FILE = `${TMP_DIR}/_import_test.json`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 导出格式与现有实现一致：{ stories: [...] }；id 用真 uuid（PG 列是 uuid 类型） */
const EXPORT = {
  stories: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: '导入验证：学校门口的那场雨',
      topic: 'small_night',
      content: '那天下了很大的雨，我在校门口站了挺久。具体多久我也不记得了。',
      storyType: 'life_moment',
      storyStatus: 'saved',
      kind: 'fragment',
      threadId: 'th_import_1',
      sourceMessageIds: [],
      memory: {
        people: [],
        events: [{ description: '在校门口站了很久', time: '', place: '学校门口', importance: 4 }],
        details: [{ detail: '下了很大的雨' }],
        emotions: [],
        turning_points: [],
        meaning: [],
        user_quotes: ['具体多久我也不记得了。'],
        story_status: 'saved',
      },
      outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
      createdAt: '2026-08-11T10:00:00.000Z',
      updatedAt: '2026-08-12T10:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      title: '导入验证：宿舍里那个晚上',
      topic: 'first_university',
      content: '那天晚上宿舍灯关了之后，我们聊了很久。',
      storyType: 'life_moment',
      storyStatus: 'saved',
      kind: 'full',
      threadId: 'th_import_2',
      sourceMessageIds: [],
      memory: null,
      outline: { core: '', people: [], moments: [], quotes: [], not_write: [] },
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    },
  ],
};

interface Reply {
  id?: number;
  result?: { result?: { value?: unknown }; nodeId?: number; root?: { nodeId: number } };
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
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(IMPORT_FILE, JSON.stringify(EXPORT, null, 2), 'utf8');
  console.log(`  已生成待导入文件：${IMPORT_FILE}`);

  const ws = new WebSocket(await findPageWs());
  await new Promise<void>((resolve) => {
    ws.onopen = () => resolve();
  });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 900,
    deviceScaleFactor: 2,
    mobile: true,
  });

  const evaluate = async (expression: string): Promise<unknown> =>
    (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

  const pickFile = async (): Promise<string> => {
    const doc = await cdp.send('DOM.getDocument', { depth: -1 });
    const rootId = doc.result?.root?.nodeId;
    if (!rootId) return 'no-root';
    const found = await cdp.send('DOM.querySelector', {
      nodeId: rootId,
      selector: 'input[type=file]',
    });
    const nodeId = found.result?.nodeId;
    if (!nodeId) return 'no-input';
    await cdp.send('DOM.setFileInputFiles', { nodeId, files: [IMPORT_FILE] });
    return 'picked';
  };

  /** 从设置页里取出导入结果那一段文字 */
  const readNote = async (): Promise<string> =>
    String(
      await evaluate(
        `(function(){var t=(document.body.innerText||'');var m=t.match(/(已导入[^\\n]*|这 \\d+ 个故事已经在[^\\n]*|暂时连不上云端[^\\n]*|这个文件[^\\n]*)/);return m?m[1]:'（没有找到结果文案）';})()`,
      ),
    );

  const storyCount = async (): Promise<string> =>
    String(
      await evaluate(
        `(function(){var t=(document.body.innerText||'');var m=t.match(/已经留下[^，。]*个故事/);return m?m[0]:'（没看到计数）';})()`,
      ),
    );

  console.log('\n========== 1. 全新身份打开设置页（模拟换设备/清数据） ==========');
  await cdp.send('Page.navigate', { url: `${BASE}/#/settings` });
  await sleep(6000);
  console.log('  ' + String(await storyCount()));
  const identity = await evaluate(
    `(function(){var t=(document.body.innerText||'');var m=t.match(/当前是游客身份（([^）]*)）/);return m?m[1]:'（未显示身份）';})()`,
  );
  console.log('  游客身份：' + String(identity));

  console.log('\n========== 2. 导入故事（第一次） ==========');
  console.log('  选择文件 = ' + (await pickFile()));
  await sleep(12000);
  console.log('  结果：' + (await readNote()));
  console.log('  ' + (await storyCount()));

  console.log('\n========== 3. 去「我的故事」看是否真的恢复 ==========');
  await evaluate(`location.hash = '#/stories'`);
  await sleep(6000);
  const listed = await evaluate(
    `(function(){var t=(document.body.innerText||'');return JSON.stringify({计数:(t.match(/已经留下[^，。]*个故事/)||['none'])[0],含导入故事1:t.indexOf('学校门口的那场雨')>=0,含导入故事2:t.indexOf('宿舍里那个晚上')>=0});})()`,
  );
  console.log('  ' + String(listed));

  console.log('\n========== 4. 再次导入同一份文件（去重） ==========');
  await evaluate(`location.hash = '#/settings'`);
  await sleep(4000);
  console.log('  选择文件 = ' + (await pickFile()));
  await sleep(12000);
  console.log('  结果：' + (await readNote()));
  console.log('  ' + (await storyCount()));

  ws.close();
  console.log('\n完成。');
}

void main();
