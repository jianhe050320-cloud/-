import { RealLlmEngine } from './llmGateway';
import { ANSWER_SYSTEM_PROMPT, renderTranscript } from '../data/prompts';

/**
 * LLM0 · 直接回答（只在「用户在问 AI，而不是在讲故事」时调用一次）。
 *
 * 为什么要独立这一层：
 *   产品问答表是穷举的，总有没覆盖的问题（「你是谁」之外的追问、对 AI 本身的好奇）。
 *   以前表没命中就会把用户的提问当成采访内容继续追问——用户会觉得「它没在听我说话」。
 *   所以：只要判定为 ASK_AI / ASK_PRODUCT，就先老老实实回答，再回到故事。
 *
 * 成本纪律：
 *   - 只在需要时调用（绝大多数回合不会走到这里）；
 *   - 短输出、低温度、短超时；失败就降级成一句诚实的兜底，绝不阻塞采访。
 */

export interface AnswerInput {
  userText: string;
  /** 最近几轮对话，只用来理解语境 */
  messages: { role: 'user' | 'assistant'; text: string }[];
  topicLabel: string;
}

const FALLBACK =
  '这个我不太确定，不想乱猜。你要是愿意，我们可以接着刚才那件事往下讲。';

export async function answerUserQuestion(input: AnswerInput): Promise<string> {
  const engine = new RealLlmEngine();
  try {
    const raw = await engine.complete(
      [
        { role: 'system', content: ANSWER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `【这次访谈的方向】${input.topicLabel}`,
            `【最近对话】\n${renderTranscript(input.messages.slice(-6), 12)}`,
            `【用户刚才问的】${input.userText}`,
            '【本次任务】只输出你的回答。',
          ].join('\n\n'),
        },
      ],
      { temperature: 0.4, maxTokens: 220, timeoutMs: 20_000 },
    );
    const text = raw.trim().replace(/^["「]/, '').replace(/["」]$/, '').slice(0, 120);
    return text || FALLBACK;
  } catch (error) {
    console.error('[interviewer] 直接回答失败，降级为诚实兜底：', error);
    return FALLBACK;
  }
}
