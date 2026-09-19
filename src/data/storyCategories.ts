import type { Story } from '../types/models';
import { findTopic } from './topics';

/**
 * 故事卡片上的「类目」。
 *
 * 只做两件事：
 *   1. 每个话题都**显式**归到一个类目（求学 / 工作 / 家人 / 朋友 / 某个人 / 某个地方 / 某段经历 / 关于自己）；
 *   2. 认不出的话题一律落到通用类目「某段经历」。
 *
 * 明确禁止：
 *   - **绝不把话题问句当类目**（例如「我什么时候开始变了？」）。
 *     卡片上那行小字是「这是一段什么经历」，不是又抛给用户一个问题；
 *   - 不使用另一个产品（fuyuan）的「困扰 / 在意 / 开心 / 小习惯」；
 *   - 不让 AI 编造类别。
 */

/** 极简线性图标的 id（真正的图形在 components/stories/CategoryIcon.tsx） */
export type CategoryIconId =
  | 'study'
  | 'work'
  | 'family'
  | 'friend'
  | 'person'
  | 'place'
  | 'moment'
  | 'self'
  | 'book';

export interface StoryCategory {
  icon: CategoryIconId;
  /** 卡片上的类目名 */
  label: string;
}

const GENERIC: StoryCategory = { icon: 'book', label: '某段经历' };

const STUDY: StoryCategory = { icon: 'study', label: '求学' };
const WORK: StoryCategory = { icon: 'work', label: '工作' };
const FAMILY: StoryCategory = { icon: 'family', label: '家人' };
const FRIEND: StoryCategory = { icon: 'friend', label: '朋友' };
const PERSON: StoryCategory = { icon: 'person', label: '某个人' };
const PLACE: StoryCategory = { icon: 'place', label: '某个地方' };
const MOMENT: StoryCategory = { icon: 'moment', label: '某段经历' };
const SELF: StoryCategory = { icon: 'self', label: '关于自己' };

/** 话题 → 类目（覆盖 topics.ts 里的全部话题，不留"猜"的余地） */
const CATEGORY_BY_TOPIC: Record<string, StoryCategory> = {
  // 第一次
  first_university: STUDY,
  first_leave_home: FAMILY,
  first_earn: WORK,
  first_love: PERSON,
  first_grown: SELF,
  // 那些人
  people_friend: FRIEND,
  people_teacher: STUDY,
  people_lost: PERSON,
  people_remember: PERSON,
  // 那些小事
  small_night: MOMENT,
  small_meal: PLACE,
  small_message: MOMENT,
  small_laugh: MOMENT,
  // 关于我
  self_changed: SELF,
  self_like: SELF,
  self_dislike: SELF,
  self_cando: SELF,
  // 遗憾与选择
  regret_again: MOMENT,
  regret_undecided: MOMENT,
  regret_gaveup: MOMENT,
  regret_sorry: MOMENT,
  // 关于未来
  future_grad: SELF,
  future_life: SELF,
  future_adult: SELF,
  future_money: SELF,
};

export function storyCategory(story: Pick<Story, 'topic'>): StoryCategory {
  return CATEGORY_BY_TOPIC[story.topic] ?? GENERIC;
}

/**
 * 排序：最近被重新讲过的故事回到最前面。
 * 一个旧故事被用户又讲了一次，它就应该重新出现在前面 —— 故事会随着记忆继续生长。
 */
export function sortStoriesByRecency<T extends { updatedAt?: string; createdAt?: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
    return tb - ta;
  });
}

/**
 * 标题：优先用 Story.title；没有就用话题名；再没有就用「一段人生片段」。
 * 绝不生成文学化标题（如「青春的答案」「命运的转折」）。
 */
export function storyTitle(story: Pick<Story, 'title' | 'topic'>): string {
  const title = (story.title ?? '').trim();
  if (title) return title;
  const topic = findTopic(story.topic);
  if (topic?.label) return topic.label;
  return '一段人生片段';
}
