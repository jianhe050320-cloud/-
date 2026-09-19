/**
 * 每个话题的第一句话（用户看到的开场白）。
 * 与 topics.ts 里的 seed 不同：seed 是给 AI 看的采访方向，这里是直接说给用户听的。
 */
export const TOPIC_OPENINGS: Record<string, string> = {
  first_leave_home: '您还记得第一次离开家，去外地工作的时候吗？',
  first_university: '您还记得第一次来到大学的那天吗？那时候是什么样子的？',
  first_earn: '您还记得第一次靠自己赚到钱，是什么时候吗？',
  first_love: '您还记得第一次真正喜欢上一个人的时候吗？',
  first_grown: '有没有一个瞬间，您突然觉得自己已经长大了？',

  people_friend: '有没有一个朋友，真的改变过您？',
  people_teacher: '有没有一位老师，到现在您还会突然想起？',
  people_lost: '有没有一个人，你们后来慢慢就走散了？',
  people_remember: '有一个人您一直记得。今天就聊聊他吧——您最先想到的是什么？',

  small_night: '有没有一个凌晨，您到现在还记得？',
  small_meal: '有没有一顿饭，您到现在还记得那个味道？',
  small_message: '您手机里有没有一条一直没舍得删的消息？',
  small_laugh: '有没有一件事，您现在想起来还会笑？',

  self_changed: '您有没有觉得，自己是从某个时候开始变的？',
  self_like: '您真正喜欢做的事情，是什么？',
  self_dislike: '您说不太喜欢现在的自己——这句话是什么时候开始有的？',
  self_cando: '有没有一件事，让您发现自己其实可以做到？',

  regret_again: '如果能重新来一次，您最想改动的是哪一步？',
  regret_undecided: '有没有一个决定，您当时没有做？',
  regret_gaveup: '您曾经放弃过什么？',
  regret_sorry: '有没有一件事，您现在想起来还有点遗憾？',

  future_grad: '毕业以后怎么办——您想到这件事的时候，心里是什么感觉？',
  future_life: '您真正想过的生活，是什么样子的？',
  future_adult: '您害怕自己成为怎样的大人？',
  future_money: '如果完全不用考虑钱，您最想去做的一件事是什么？',
};

export function openingFor(topicId: string, topicLabel: string, question?: string | null): string {
  if (question && question.trim()) return question.trim();
  return TOPIC_OPENINGS[topicId] ?? `关于「${topicLabel}」，想到哪儿就说到哪儿，我在这儿听着。`;
}
