import type { Topic, TopicCategory, TopicCategoryId } from '../types/models';

/**
 * 首页六大分类。话题都刻意做得「轻」——
 * 目标是让用户觉得「我可以随便讲一件自己的事情」，而不是「我要完成一份人生档案」。
 */
export const TOPIC_CATEGORIES: TopicCategory[] = [
  {
    id: 'first',
    name: '第一次',
    emoji: '✨',
    topics: [
      {
        id: 'first_leave_home',
        category: 'first',
        icon: '🧳',
        label: '第一次离开家',
        seed: '用户第一次离开家（去外地工作或上学），可以从「那时候家里和外面分别是什么样子」开始',
      },
      {
        id: 'first_university',
        category: 'first',
        icon: '🎒',
        label: '第一次来到大学',
        seed: '用户第一次来到大学，可以从「刚进校门那天最记得的一个画面」开始',
      },
      {
        id: 'first_earn',
        category: 'first',
        icon: '🪙',
        label: '第一次自己赚钱',
        seed: '用户第一次自己赚到钱，可以从「拿到钱那一刻最先想到的人或事」开始',
      },
      {
        id: 'first_love',
        category: 'first',
        icon: '💌',
        label: '第一次真正喜欢一个人',
        seed: '用户第一次真正喜欢一个人，可以从「意识到自己动心了的那个瞬间」开始',
      },
      {
        id: 'first_grown',
        category: 'first',
        icon: '🪴',
        label: '第一次觉得自己长大了',
        seed: '用户第一次觉得自己长大了，可以从「那一天发生了什么」开始',
      },
    ],
  },
  {
    id: 'people',
    name: '那些人',
    emoji: '🧑‍🤝‍🧑',
    topics: [
      {
        id: 'people_friend',
        category: 'people',
        icon: '🫂',
        label: '一个改变过我的朋友',
        seed: '一个改变过用户的朋友，可以从「这个人做了什么让你一直记得」开始',
      },
      {
        id: 'people_teacher',
        category: 'people',
        icon: '📖',
        label: '一个影响过我的老师',
        seed: '一个影响过用户的老师，可以从「老师说过或做过的一件具体的事」开始',
      },
      {
        id: 'people_lost',
        category: 'people',
        icon: '🍂',
        label: '一个后来走散的人',
        seed: '一个后来和用户走散的人，可以从「你们以前经常一起做什么」开始',
      },
      {
        id: 'people_remember',
        category: 'people',
        icon: '🕯️',
        label: '一个我一直记得的人',
        seed: '一个用户一直记得的人，可以从「为什么是这个人」开始',
      },
    ],
  },
  {
    id: 'small',
    name: '那些小事',
    emoji: '🌙',
    topics: [
      {
        id: 'small_night',
        category: 'small',
        icon: '🌌',
        label: '一个难忘的凌晨',
        seed: '一个难忘的凌晨，可以从「那天夜里你在哪里、在做什么」开始',
      },
      {
        id: 'small_meal',
        category: 'small',
        icon: '🍚',
        label: '一顿一直记得的饭',
        seed: '一顿用户一直记得的饭，可以从「是什么场合、和谁一起」开始',
      },
      {
        id: 'small_message',
        category: 'small',
        icon: '💬',
        label: '一条没舍得删的消息',
        seed: '一条用户没舍得删的消息，可以从「这条消息来自谁、为什么留着」开始',
      },
      {
        id: 'small_laugh',
        category: 'small',
        icon: '😄',
        label: '一件现在想起来还会笑的事情',
        seed: '一件用户现在想起来还会笑的事情，可以从「当时发生了什么」开始',
      },
    ],
  },
  {
    id: 'self',
    name: '关于我',
    emoji: '🪞',
    topics: [
      {
        id: 'self_changed',
        category: 'self',
        icon: '🔄',
        label: '我什么时候开始变了？',
        seed: '用户感觉自己开始变了，可以从「哪段时间之后你觉得自己不太一样了」开始',
      },
      {
        id: 'self_like',
        category: 'self',
        icon: '✨',
        label: '我真正喜欢做什么？',
        seed: '用户真正喜欢做什么，可以从「最近一次做这件事时的感觉」开始',
      },
      {
        id: 'self_dislike',
        category: 'self',
        icon: '🌫️',
        label: '我不太喜欢现在的自己',
        seed: '用户不太喜欢现在的自己，要先接住情绪，不急着找原因，也不做任何定性',
      },
      {
        id: 'self_cando',
        category: 'self',
        icon: '💪',
        label: '一件让我发现自己可以做到的事',
        seed: '一件让用户发现自己可以做到的事，可以从「当时你原本以为自己做不到什么」开始',
      },
    ],
  },
  {
    id: 'regret',
    name: '遗憾与选择',
    emoji: '💭',
    topics: [
      {
        id: 'regret_again',
        category: 'regret',
        icon: '↩️',
        label: '如果重新来一次',
        seed: '如果重新来一次，可以从「你最想改动的是哪一步」开始',
      },
      {
        id: 'regret_undecided',
        category: 'regret',
        icon: '🚪',
        label: '一个没有做的决定',
        seed: '一个用户没有做的决定，可以从「当时你停在什么地方」开始',
      },
      {
        id: 'regret_gaveup',
        category: 'regret',
        icon: '🪁',
        label: '我曾经放弃过什么',
        seed: '用户曾经放弃过什么，可以从「放弃的那一刻你在想什么」开始',
      },
      {
        id: 'regret_sorry',
        category: 'regret',
        icon: '🌧️',
        label: '一件我一直有点遗憾的事情',
        seed: '一件用户一直有点遗憾的事情，要温和，不追问细节也不做评价',
      },
    ],
  },
  {
    id: 'future',
    name: '关于未来',
    emoji: '🧭',
    topics: [
      {
        id: 'future_grad',
        category: 'future',
        icon: '🎓',
        label: '我不知道毕业以后怎么办',
        seed: '用户不知道毕业以后怎么办，要先承认这种不确定是正常的，不要给建议',
      },
      {
        id: 'future_life',
        category: 'future',
        icon: '🏡',
        label: '我真正想过怎样的生活？',
        seed: '用户真正想过怎样的生活，可以从「想象里的一天是怎么过的」开始',
      },
      {
        id: 'future_adult',
        category: 'future',
        icon: '🫥',
        label: '我害怕成为怎样的大人？',
        seed: '用户害怕成为怎样的大人，可以从「你见过哪个大人让你警觉」开始',
      },
      {
        id: 'future_money',
        category: 'future',
        icon: '🪄',
        label: '如果不用考虑钱，我想做什么？',
        seed: '如果不用考虑钱用户想做什么，可以从「第一件想去做的事」开始',
      },
    ],
  },
];

/** 「随机问我一个」的问题池：比话题更开放，用来把用户直接推到一段回忆里 */
export const RANDOM_QUESTIONS: string[] = [
  '有没有一个瞬间，你突然发现自己已经不是以前的那个自己了？',
  '有没有一条路，你现在路过还会想起某个人？',
  '你上一次在夜里睡不着的时候，脑子里在想什么？',
  '有没有一件小事，你到现在都没跟别人说过？',
  '如果可以回到某一个下午，你会选哪一天？',
  '你手机里有没有一条一直没舍得删的消息？',
  '有没有一个人，你其实一直想跟他说一句谢谢？',
  '你最近一次觉得自己「还挺不错的」，是什么时候？',
  '有没有一顿饭，你到现在还记得味道？',
  '你有没有做过一个别人都觉得没必要、但你自己很在意的决定？',
  '说到「家」，你最先想到的是什么画面？',
  '有没有一件事，你以为自己早就忘了，结果某天突然全想起来了？',
];

export function getTopicCategories(): TopicCategory[] {
  return TOPIC_CATEGORIES;
}

export function allTopics(): Topic[] {
  return TOPIC_CATEGORIES.flatMap((category) => category.topics);
}

export function findTopic(id: string | null | undefined): Topic | undefined {
  if (!id) return undefined;
  return allTopics().find((topic) => topic.id === id);
}

export function findCategory(id: TopicCategoryId | undefined): TopicCategory | undefined {
  return TOPIC_CATEGORIES.find((category) => category.id === id);
}

export function pickRandomTopic(): Topic {
  const topics = allTopics();
  return topics[Math.floor(Math.random() * topics.length)];
}

/** 抽一个随机问题；避免和上一次重复 */
export function pickRandomQuestion(exclude?: string): string {
  const pool = RANDOM_QUESTIONS.filter((question) => question !== exclude);
  const list = pool.length > 0 ? pool : RANDOM_QUESTIONS;
  return list[Math.floor(Math.random() * list.length)];
}
