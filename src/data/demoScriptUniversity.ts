import type { DemoBeat } from './demoScript';

/**
 * 演示剧本 test_conversation_02《第一次来到大学》。
 *
 * 为什么需要第二个剧本：没有模型密钥时，非剧本话题只能走「泛泛追问」，
 * 用户会看到一个很笨的采访者。这个剧本是学生向话题里最常用的一个，
 * 手写台词能让零配置的体验也像回事。
 *
 * 结构约定与《第一次离开家》完全一致：
 *   beats[k].ai        = 用户已经说了 k 轮之后，采访者该说的那一句（k=0 是开场白）
 *   beats[k].sampleUser = 用户在第 k+1 轮说的话（「用剧本台词回答」按钮用）
 *   beats[k].newClues  = 从用户第 k 轮那句话里抽出来的线索
 */

const U1 =
  '记得。我是自己一个人来的，家里人送我到镇上车站就回去了。我拎着两个编织袋，坐了一夜的绿皮火车，天亮才到。';
const U2 =
  '出站以后我就懵了。我从来没来过这么大的地方。我爸妈教过我问路要有礼貌，我就一路问过去，绕了一大圈才找到学校。';
const U3 = '有点想哭，又有点兴奋。反正就是站在那儿看了很久才进去。';
const U4 = '宿舍里六个人，天南地北的都有，说话我听不太懂。第一天晚上特别安静，谁也不熟。';
const U5 = '大概军训吧。一起晒太阳一起被骂，慢慢地就熟了。';
const U6 =
  '有个从云南来的，他普通话特别差，我们一开始都笑他。后来他每天教我说他们那儿的方言，我也教他。';
const U7 =
  '具体哪句忘了，就记得他说他们那儿山特别多，早上起来能看到雾在山上飘。他说的时候眼睛特别亮。';
const U8 =
  '说过。有一次我们聊到半夜，我说我其实特别怕读不下去，怕给家里丢脸。他说他也怕。那天说完之后我好像就轻了一点。';
const U9 = '对，差不多是这样。';
const U10 = '好呀，你整理吧。';

export const UNIVERSITY_BEATS: DemoBeat[] = [
  {
    /* k=0 · 开场白 */
    ai: '您还记得第一次来到大学的那天吗？',
    sampleUser: U1,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '第一次来到大学的那一天',
  },
  {
    /* k=1 · 从 U1 抽线索 */
    ai: '一个人拎着两个编织袋坐了一整夜火车。到了以后，第一件让您觉得「这里跟我想的不一样」的事，是什么？',
    sampleUser: U2,
    newClues: [
      {
        kind: 'event',
        text: '第一次独自去大学报到（一个人来的）',
        importance: 5,
        evidence: '我是自己一个人来的，家里人送我到镇上车站就回去了',
      },
      { kind: 'detail', text: '两个编织袋', importance: 4, evidence: '我拎着两个编织袋' },
      { kind: 'detail', text: '坐了一夜绿皮火车，天亮才到', importance: 4, evidence: '坐了一夜的绿皮火车，天亮才到' },
    ],
    memoryPatch: {
      events: [
        {
          description: '第一次独自坐绿皮火车去大学报到，坐了一夜',
          time: '大学开学时',
          place: '',
          importance: 5,
        },
      ],
      details: [
        { detail: '一个人拎着两个编织袋', importance: 4 },
        { detail: '坐了一夜绿皮火车，天亮才到', importance: 4 },
      ],
      user_quotes: ['我是自己一个人来的，家里人送我到镇上车站就回去了'],
    },
    selectedTarget: '一个人坐了一夜绿皮火车来报到',
  },
  {
    /* k=2 */
    ai: '您一路问着路找过去，绕了一大圈才到。终于站在校门口的时候，您心里是什么感觉？',
    sampleUser: U3,
    newClues: [
      {
        kind: 'emotion',
        text: '不知所措',
        importance: 4,
        evidence: '出站以后我就懵了，我从来没来过这么大的地方',
      },
      { kind: 'event', text: '一路问路，绕了一大圈才找到学校', importance: 4, evidence: '我就一路问过去，绕了一大圈才找到学校' },
      { kind: 'detail', text: '爸妈教过我问路要有礼貌', importance: 4, evidence: '我爸妈教过我问路要有礼貌' },
    ],
    memoryPatch: {
      emotions: [{ emotion: '不知所措', evidence: '出站以后我就懵了，我从来没来过这么大的地方', confidence: 0.8 }],
      events: [{ description: '出站后一路问路，绕了一大圈才找到学校', time: '', place: '', importance: 4 }],
      details: [{ detail: '爸妈教过我问路要有礼貌', importance: 4 }],
      user_quotes: ['我爸妈教过我问路要有礼貌，我就一路问过去，绕了一大圈才找到学校'],
    },
    selectedTarget: '绕了一大圈才找到学校',
  },
  {
    /* k=3 */
    ai: '站在校门口看了很久——那种感觉应该挺复杂的。那天接下来还有什么是您一直记得的？',
    sampleUser: U4,
    newClues: [
      { kind: 'emotion', text: '想哭', importance: 5, evidence: '有点想哭' },
      { kind: 'emotion', text: '兴奋', importance: 4, evidence: '又有点兴奋' },
      { kind: 'detail', text: '在校门口站了很久才进去', importance: 4, evidence: '就是站在那儿看了很久才进去' },
    ],
    memoryPatch: {
      emotions: [
        { emotion: '想哭', evidence: '有点想哭，又有点兴奋', confidence: 0.8 },
        { emotion: '兴奋', evidence: '有点想哭，又有点兴奋', confidence: 0.7 },
      ],
      details: [{ detail: '在校门口站了很久才进去', importance: 4 }],
      user_quotes: ['有点想哭，又有点兴奋。反正就是站在那儿看了很久才进去'],
    },
    selectedTarget: '站在校门口看了很久',
    highValueClues: ['站在校门口那一刻，情绪是混在一起的（想哭 + 兴奋）'],
    extraReasons: ['存在情绪变化'],
  },
  {
    /* k=4 */
    ai: '六个人一开始谁也不熟，那种安静其实挺难熬的。后来是什么时候开始变得不一样的？',
    sampleUser: U5,
    newClues: [
      { kind: 'person', text: '室友（六个人，天南地北的都有）', importance: 3, evidence: '宿舍里六个人，天南地北的都有' },
      { kind: 'emotion', text: '拘谨', importance: 4, evidence: '第一天晚上特别安静，谁也不熟' },
      { kind: 'event', text: '住进六人宿舍的第一晚', importance: 4, evidence: '第一天晚上特别安静，谁也不熟' },
    ],
    memoryPatch: {
      people: [{ name: '室友', relationship: '同宿舍同学（六人）', importance: 3 }],
      emotions: [{ emotion: '拘谨', evidence: '第一天晚上特别安静，谁也不熟', confidence: 0.7 }],
      events: [{ description: '住进六人宿舍的第一晚，谁也不熟，特别安静', time: '开学第一天晚上', place: '宿舍', importance: 4 }],
      user_quotes: ['第一天晚上特别安静，谁也不熟'],
    },
    selectedTarget: '第一晚谁也不熟的那种安静',
  },
  {
    /* k=5 · 关系开始变化 */
    ai: '一起挨过晒的人确实容易熟一点。那时候有没有哪个人，后来跟您最要好？',
    sampleUser: U6,
    newClues: [
      { kind: 'event', text: '军训时一起晒太阳、一起被骂', importance: 4, evidence: '一起晒太阳一起被骂' },
      {
        kind: 'turning_point',
        text: '六个人谁也不熟 → 慢慢熟了',
        importance: 5,
        evidence: '慢慢地就熟了',
      },
    ],
    memoryPatch: {
      events: [{ description: '军训时一起晒太阳一起被骂，和室友慢慢熟起来', time: '军训期间', place: '', importance: 4 }],
      turning_points: [
        {
          before: '六个人谁也不熟，第一晚特别安静',
          after: '和室友慢慢熟了',
          trigger: '军训时一起晒太阳、一起被骂',
        },
      ],
      user_quotes: ['大概军训吧。一起晒太阳一起被骂，慢慢地就熟了'],
    },
    selectedTarget: '军训让室友关系发生变化',
    highValueClues: ['室友关系从「谁也不熟」到「慢慢熟了」'],
    extraReasons: ['是故事中的意义转折'],
  },
  {
    /* k=6 · 高价值关系线索 */
    ai: '你们互相教对方说话——这件事我挺感兴趣的。您还记得他教您的第一句是什么吗？',
    sampleUser: U7,
    newClues: [
      { kind: 'person', text: '云南来的室友', importance: 5, evidence: '有个从云南来的' },
      { kind: 'event', text: '和云南室友互相教对方说自己家乡的方言', importance: 5, evidence: '他每天教我说他们那儿的方言，我也教他' },
      {
        kind: 'turning_point',
        text: '一开始大家都笑他普通话差 → 两个人互相教对方说话',
        importance: 4,
        evidence: '我们一开始都笑他。后来他每天教我说他们那儿的方言，我也教他',
      },
    ],
    memoryPatch: {
      people: [{ name: '云南来的室友', relationship: '室友，后来最要好', importance: 5 }],
      events: [{ description: '和云南来的室友互相教对方说自己家乡的方言', time: '', place: '宿舍', importance: 5 }],
      turning_points: [
        {
          before: '一开始大家都笑他普通话差',
          after: '他每天教我他们那儿的方言，我也教他',
          trigger: '两个人开始互相教对方说话',
        },
      ],
      user_quotes: ['后来他每天教我说他们那儿的方言，我也教他'],
    },
    selectedTarget: '和云南室友互相教对方说家乡话',
    highValueClues: ['⭐ 云南室友：从「被大家笑」变成「互相教语言」的关系变化'],
    extraReasons: ['是故事中的意义转折', '能连接多个已有事件'],
  },
  {
    /* k=7 */
    ai: '他说起自己家的时候眼睛特别亮，您一直记得这个。后来您有没有跟他说过您自己家的事？',
    sampleUser: U8,
    newClues: [
      { kind: 'detail', text: '他说家乡山特别多，早上能看到雾在山上飘', importance: 5, evidence: '他说他们那儿山特别多，早上起来能看到雾在山上飘' },
      { kind: 'emotion', text: '（他）说起家乡时眼睛特别亮', importance: 5, evidence: '他说的时候眼睛特别亮' },
    ],
    memoryPatch: {
      details: [{ detail: '他说家乡山特别多，早上能看到雾在山上飘', importance: 5 }],
      emotions: [{ emotion: '说起家乡时的明亮', evidence: '他说的时候眼睛特别亮', confidence: 0.7 }],
      user_quotes: ['就记得他说他们那儿山特别多，早上起来能看到雾在山上飘。他说的时候眼睛特别亮'],
    },
    selectedTarget: '他说起家乡时眼睛特别亮',
    highValueClues: ['⭐ 「他说的时候眼睛特别亮」——用户记住了对方的情绪细节'],
    extraReasons: ['能连接多个已有事件'],
  },
  {
    /* k=8 · 故事的意义转折 */
    ai: '怕读不下去这件事，您在那天之前一直自己扛着；说出口以后，心里轻了一点——这样理解对吗？',
    sampleUser: U9,
    newClues: [
      { kind: 'event', text: '有天夜里聊到半夜，第一次说出自己怕读不下去', importance: 5, evidence: '有一次我们聊到半夜，我说我其实特别怕读不下去' },
      { kind: 'emotion', text: '害怕（怕读不下去、怕给家里丢脸）', importance: 5, evidence: '我其实特别怕读不下去，怕给家里丢脸' },
      { kind: 'emotion', text: '轻了一点', importance: 5, evidence: '那天说完之后我好像就轻了一点' },
      {
        kind: 'turning_point',
        text: '怕读不下去一直自己扛着 → 说出口以后轻了一点',
        importance: 5,
        evidence: '他说他也怕。那天说完之后我好像就轻了一点',
      },
    ],
    memoryPatch: {
      events: [{ description: '有天夜里和室友聊到半夜，说出了自己怕读不下去', time: '大一', place: '宿舍', importance: 5 }],
      emotions: [
        { emotion: '害怕', evidence: '我其实特别怕读不下去，怕给家里丢脸', confidence: 0.9 },
        { emotion: '轻松了一点', evidence: '那天说完之后我好像就轻了一点', confidence: 0.8 },
      ],
      turning_points: [
        {
          before: '怕读不下去这件事一直自己扛着',
          after: '说出来之后心里轻了一点',
          trigger: '那天夜里跟室友说了实话，他说他也怕',
        },
      ],
      meaning: [{ interpretation: '把怕的事说出口，比一个人扛着要轻一些', confirmed_by_user: false }],
      user_quotes: ['我说我其实特别怕读不下去，怕给家里丢脸。他说他也怕。那天说完之后我好像就轻了一点'],
    },
    selectedTarget: '说出口之后心里轻了一点',
    highValueClues: ['⭐ 「那天说完之后我好像就轻了一点」——故事的意义转折'],
    extraReasons: ['是故事中的意义转折', '存在情绪变化', '能连接多个已有事件'],
  },
  {
    /* k=9 · 故事已完整，主动收尾 */
    ai: '我觉得今天这个故事已经很完整了。从一个拎着两个编织袋、绕了一大圈才找到校门的人，到那天夜里第一次跟人说了实话、心里轻了一点。我先替您整理下来，您看看是不是您想留下来的样子？',
    sampleUser: U10,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '说出口之后心里轻了一点',
    highValueClues: ['站在校门口那一刻情绪是混的', '⭐ 「说出来之后我好像就轻了一点」'],
    extraReasons: ['是故事中的意义转折', '能连接多个已有事件', '当前风险低'],
  },
];

/** 最终故事：只用用户说过的事，没有添加任何没被讲过的经历 */
export const UNIVERSITY_STORY = {
  title: '第一次来到大学',
  content: `我是自己一个人来报到的。家里人送我到镇上车站就回去了。我拎着两个编织袋，坐了一夜的绿皮火车，天亮才到。

出站以后我就懵了——我从来没来过这么大的地方。我爸妈教过我问路要有礼貌，我就一路问过去，绕了一大圈才找到学校。站在校门口的时候，我有点想哭，又有点兴奋，就那样看了很久才进去。

宿舍里六个人，天南地北的都有，说话我听不太懂。第一天晚上特别安静，谁也不熟。

大概是从军训开始不一样的。一起晒太阳，一起被骂，慢慢地就熟了。

有个从云南来的室友，普通话特别差，我们一开始都笑他。后来他每天教我说他们那儿的方言，我也教他。具体哪句我忘了，就记得他说他们那儿山特别多，早上起来能看到雾在山上飘。他说的时候眼睛特别亮。

有一次我们聊到半夜。我说我其实特别怕读不下去，怕给家里丢脸。他说他也怕。那天说完之后，我好像就轻了一点。

这些年过去了，我一直记得两件事：那两个编织袋，和那天夜里说完话之后，心里轻了一点的感觉。`,
  literary: false,
};

/** 剧本里已经确认过的理解 */
export const UNIVERSITY_CONFIRMED_MEANINGS = ['把怕的事说出口，比一个人扛着要轻一些'];
