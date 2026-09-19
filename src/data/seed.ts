import type { LlmProvider, LlmSettings } from '../types/llm';

export const INTERVIEWER = {
  name: 'AI 人生采访者',
  title: '我的故事',
  subtitle: '不用写下来，讲给我听就好。',
  honestNote: 'AI 整理自您的讲述，没有添加您没有说过的经历。',
};

export const PROVIDER_PRESETS: Record<
  Exclude<LlmProvider, 'custom'>,
  { label: string; baseUrl: string; model: string }
> = {
  // deepseek-chat 是"直接回答"的模型，适合我们这种每回合两次 JSON 调用。
  // 注意 deepseek-flash / deepseek-v4-pro 是推理模型：会先吐一大段 reasoning_content，
  // 在 max_tokens 较小时 content 会是空的，且慢很多，不适合本产品的节奏。
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
};

export const DEFAULT_LLM: LlmSettings = {
  provider: 'deepseek',
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  apiKey: '',
  model: PROVIDER_PRESETS.deepseek.model,
  mode: 'auto',
};

/** 「我不知道怎么说」时给出的 2~3 条很轻的提示，不催促、不施压 */
export const SOFT_HINTS: string[] = [
  '可以从那天发生的一件小事讲起。',
  '你还记得当时身边有谁吗？',
  '也可以不回答这个问题，想讲什么都可以。',
];

/** 采访页 AI 停顿的等待区间（毫秒）——像一个人停顿了一下再回答 */
export const THINKING_DELAY = { min: 700, max: 1200 };

/** 用户可能故意输入的 10 种测试输入：观察面板提供一键注入 */
export const BADCASE_INPUTS: { id: string; label: string; text: string }[] = [
  { id: 'bc1', label: '不记得了', text: '我也不太记得了。' },
  { id: 'bc2', label: '不想说', text: '这个我不想说。' },
  { id: 'bc3', label: '突然跑题', text: '说到这里我突然想起另外一件事。' },
  { id: 'bc4', label: '后悔', text: '其实那时候我挺后悔的。' },
  { id: 'bc5', label: '说不清难过', text: '我不知道为什么，就是觉得很难过。' },
  { id: 'bc6', label: '妈妈很辛苦', text: '我妈那时候其实特别辛苦。' },
  { id: 'bc7', label: '算了不聊了', text: '算了，不聊这个了。' },
  { id: 'bc8', label: '没什么特别的', text: '我觉得也没什么特别的。' },
  { id: 'bc9', label: '不知从哪讲', text: '后来发生的事情太多了，我不知道从哪里讲。' },
  { id: 'bc10', label: '你说得不对', text: '你说得不对。' },
];

/** 观察面板的推荐理由清单：AI 逐条判断是否命中 */
export const REASON_CATALOG: string[] = [
  '用户主动提及',
  '存在情绪变化',
  '是故事中的意义转折',
  '能连接多个已有事件',
  '当前风险低',
];
