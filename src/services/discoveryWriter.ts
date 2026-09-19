import { parseJsonSafe } from '../lib/json';
import { uid } from '../lib/storage';
import { DISCOVERIES_SYSTEM_PROMPT, renderMemoryDigest } from '../data/prompts';
import { isDiscoveryKind, type Discovery } from '../types/discovery';
import type { StoryMemory } from '../types/interview';
import { RealLlmEngine } from './llmGateway';
import { lintDiscoveries, type DiscoveryDrop } from './contentGuard';
import { buildDemoDiscoveries } from './demoInterviewer';
import { renderTranscriptForModel } from './storySource';

/**
 * 「关于你」（私享版专属栏目）的生成。
 *
 * 与故事正文的关键区别：**它只吃原始采访语料**。
 * 绝不把 AI 写的故事正文喂进来——那样等于让模型二次解释自己的措辞，
 * 迟早会滑向心理分析，而这是这个产品的红线。
 */

export interface DiscoveryWriteInput {
  /** 原始采访语料（Source of Truth） */
  lines: { role: 'user' | 'assistant'; text: string }[];
  /** 结构化记忆只作为「说到过哪些人/事」的索引，不作为事实来源 */
  memory: StoryMemory | null;
  engine: 'llm' | 'demo';
}

export interface DiscoveryWriteResult {
  discoveries: Discovery[];
  /** 被确定性闸门丢掉的条目：只用于排查，不展示给用户 */
  dropped: DiscoveryDrop[];
}

function sanitize(candidates: Discovery[], userTexts: string[]): DiscoveryWriteResult {
  const { kept, dropped } = lintDiscoveries(candidates, userTexts);
  // 不再静默：被闸门拦下的条目落日志（哪条、为什么），排查「关于你为空」时一目了然
  if (dropped.length > 0) {
    console.warn(
      `[interviewer] 「关于你」${dropped.length}/${candidates.length} 条被闸门拦下：`,
      dropped.map((item) => `「${item.text.slice(0, 24)}」→ ${item.reason}`),
    );
  }
  return { discoveries: kept, dropped };
}

function parseCandidates(parsed: { discoveries?: unknown } | null): Discovery[] {
  const list = Array.isArray(parsed?.discoveries) ? parsed.discoveries : [];
  const out: Discovery[] = [];
  list.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const row = item as Record<string, unknown>;
    if (!isDiscoveryKind(row.kind)) return;
    out.push({
      id: uid('d'),
      kind: row.kind,
      text: typeof row.text === 'string' ? row.text : '',
      support: typeof row.support === 'string' && row.support.trim() ? row.support.trim() : undefined,
      evidence: (Array.isArray(row.evidence) ? row.evidence : []).filter(
        (entry): entry is string => typeof entry === 'string',
      ),
    });
  });
  return out;
}

export async function writeDiscoveries(input: DiscoveryWriteInput): Promise<DiscoveryWriteResult> {
  const userTexts = input.lines
    .filter((line) => line.role === 'user')
    .map((line) => line.text.trim())
    .filter(Boolean);

  // 没有用户自己的话，就没有任何可以「指回给他看」的东西：宁可不显示
  if (userTexts.length === 0) return { discoveries: [], dropped: [] };

  if (input.engine === 'demo') {
    return sanitize(buildDemoDiscoveries(userTexts), userTexts);
  }

  const engine = new RealLlmEngine();
  const raw = await engine.complete(
    [
      { role: 'system', content: DISCOVERIES_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          '【对话原文（唯一事实来源，只有这里出现过的才能用）】',
          renderTranscriptForModel(input.lines, 60),
          input.memory ? `【我已记下的索引（仅供定位说过的人/事，不得当作新事实）】\n${renderMemoryDigest(input.memory)}` : '',
          '【本次任务】输出「关于你」的 JSON。',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
    { temperature: 0.5, maxTokens: 1200, timeoutMs: 50_000 },
  );

  return sanitize(parseCandidates(parseJsonSafe<{ discoveries?: unknown }>(raw)), userTexts);
}
