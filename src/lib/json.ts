/**
 * LLM 结构化输出的容错解析。
 * 约定：理解器 / 候选问题生成器 / 故事生成器都只输出 JSON。
 * 但真实模型经常附带解释文字或 markdown 围栏，因此这里一律「找第一个平衡的 JSON 片段」，
 * 解析失败就返回 null 让调用方静默降级——绝不让一次脏输出打断整条采访链路。
 */

/** 去掉 markdown 围栏与前后说明文字，取出最外层 JSON 片段 */
export function extractJsonText(raw: string): string | null {
  const text = (raw || '').trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;

  const start = body.search(/[[{]/);
  if (start < 0) return null;

  const openChar = body[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i += 1) {
    const char = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

export function parseJsonSafe<T>(raw: string): T | null {
  const jsonText = extractJsonText(raw);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}
