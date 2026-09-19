import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 给构建产物打「版本戳」。
 *
 * 为什么需要它：
 *   线上是 CloudBase 静态托管，用户看的一直是同一个地址。部署之后，
 *   若浏览器或 CDN 还留着旧的 index.html，就完全不知道自己看的是哪一版。
 *   这里把「构建时间 + 产物哈希」写进 index.html，
 *   于是任何人都能一眼确认「线上是不是我刚改的那一版」。
 *
 * 写进去的三样东西：
 *   1. <meta name="build-time"> —— 格式化到本地时区的时间；
 *   2. <meta name="build-id">   —— 本次产物 JS 的哈希（如 CAZ3RGX5），与文件名对应；
 *   3. 一条 HTML 注释 —— 右键「查看源代码」也能直接看见。
 *
 * 幂等：每次构建都重写，不会无限追加（先剥掉上一次写的同名标记）。
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const indexFile = join(dist, 'index.html');

/** 本地时间补零，避免到处都看到 UTC */
function pad(value) {
  return String(value).padStart(2, '0');
}

function stamp() {
  const now = new Date();
  const time = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-');
  const clock = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join(':');
  return { time, clock, iso: now.toISOString() };
}

/** 取本次产物的 JS 哈希，作为 build-id（哈希变化 = 代码确实变了） */
function buildId() {
  try {
    const assets = readdirSync(join(dist, 'assets'));
    const main = assets.find((name) => name.startsWith('index-') && name.endsWith('.js'));
    if (!main) return 'unknown';
    return main.replace(/^index-/, '').replace(/\.js$/, '');
  } catch {
    return 'unknown';
  }
}

let html = readFileSync(indexFile, 'utf8');
const { time, clock, iso } = stamp();
const id = buildId();

// 先剥掉上一次的标记，保证幂等
html = html
  .replace(/\s*<meta name="build-time"[^>]*>/g, '')
  .replace(/\s*<meta name="build-id"[^>]*>/g, '')
  .replace(/\s*<!-- build:[^>]*-->/g, '');

const inject = [
  '',
  `    <meta name="build-time" content="${time} ${clock}">`,
  `    <meta name="build-id" content="${id}">`,
  `    <!-- build: ${time} ${clock} · id=${id} · iso=${iso} -->`,
].join('\n');

html = html.replace('</head>', `${inject}\n  </head>`);

writeFileSync(indexFile, html, 'utf8');

console.log(`[stamp] 版本戳已写入：${time} ${clock} · build-id=${id}`);
