'use strict';

/**
 * LLM 代理云函数。
 *
 * 存在的唯一理由：网页是纯静态站点，没有任何地方能安全地放密钥。
 * 把密钥放在云函数的环境变量里，浏览器只调用本函数的同源地址，
 * 密钥永远不会下发到前端产物中。
 *
 * 路由：
 *   GET  /api/llm/config  探测密钥是否就绪（只回布尔值，绝不回密钥）
 *   POST /api/llm         转发到 OpenAI 兼容的 /chat/completions
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = 9000;

const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const SERVER_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const UPSTREAM_TIMEOUT_MS = 45000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_TOKENS_CAP = 1200;

/** 允许的浏览器来源。请求没带 Origin（curl / 服务端调用）时不检查。 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

/**
 * 注意：这里刻意 **不** 设置任何 Access-Control-* 响应头。
 *
 * 原因：CloudBase 的 HTTP 网关（tcbgw）自己就会加 CORS 头，而且是
 * 追加而不是覆盖——如果我们也在上游写一份，最终会变成
 *   Access-Control-Allow-Origin: https://xxx.tcloudbaseapp.com,*
 * 这是非法值，浏览器会直接判定跨域失败。
 * 所以 CORS 统一交给网关，我们只保留下面的 Origin 白名单校验做防御。
 */

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return resolve(null);
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch {
        return resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/** 只把模型允许的字段传下去，避免请求体被拿来塞别的东西 */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const cleaned = messages
    .filter((item) => item && typeof item === 'object')
    .slice(-24)
    .map((item) => ({
      role: item.role === 'assistant' || item.role === 'system' ? item.role : 'user',
      content: typeof item.content === 'string' ? item.content.slice(0, 8000) : '',
    }))
    .filter((item) => item.content.length > 0);
  return cleaned.length ? cleaned : null;
}

/** 允许调用方挑 deepseek 系列模型，但只能是模型名，不能借此打别的模型 */
function resolveModel(requested) {
  if (typeof requested === 'string' && /^deepseek-[a-z0-9.-]{1,40}$/.test(requested)) return requested;
  return SERVER_MODEL;
}

function callUpstream(payload) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(`${BASE_URL}/chat/completions`);
    } catch (error) {
      reject(new Error(`BASE_URL 不合法: ${error.message}`));
      return;
    }

    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
          'Content-Length': data.length,
        },
      },
      (upstream) => {
        let raw = '';
        upstream.setEncoding('utf8');
        upstream.on('data', (chunk) => {
          raw += chunk;
        });
        upstream.on('end', () => resolve({ status: upstream.statusCode || 502, text: raw }));
      },
    );

    req.setTimeout(UPSTREAM_TIMEOUT_MS, () => req.destroy(new Error('上游模型响应超时')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    // 预检也交给网关补 CORS 头，这里只给一个干净的空响应
    res.writeHead(204);
    res.end();
    return;
  }

  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
    sendJson(res, 403, { error: 'origin not allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // 只回布尔值：前端据此决定「用真模型」还是「降级演示」
  if (path === '/api/llm/config' && (req.method === 'GET' || req.method === 'POST')) {
    sendJson(res, 200, { ok: true, hasKey: Boolean(API_KEY), model: SERVER_MODEL });
    return;
  }

  if (path === '/' || path === '/api/llm') {
    if (path === '/' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, service: 'llm-proxy' });
      return;
    }
    if (path === '/api/llm' && req.method === 'POST') {
      if (!API_KEY) {
        sendJson(res, 503, { error: '服务端未配置模型密钥' });
        return;
      }

      const body = await readJsonBody(req);
      if (body === null) {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }

      const messages = sanitizeMessages(body.messages);
      if (!messages) {
        sendJson(res, 400, { error: 'messages 不能为空' });
        return;
      }

      const payload = {
        model: resolveModel(body.model),
        messages,
        temperature: typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 2) : 0.7,
        max_tokens: Math.min(
          typeof body.max_tokens === 'number' && body.max_tokens > 0 ? Math.trunc(body.max_tokens) : 800,
          MAX_TOKENS_CAP,
        ),
        stream: false,
      };

      try {
        const upstream = await callUpstream(payload);
        res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(upstream.text);
      } catch (error) {
        sendJson(res, 502, { error: `转发失败: ${error.message}` });
      }
      return;
    }

    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT);

// 启动日志里只打印是否拿到密钥，绝不打印密钥本身
console.log(`[llm-proxy] listening on ${PORT}, hasKey=${Boolean(API_KEY)}, model=${SERVER_MODEL}`);
