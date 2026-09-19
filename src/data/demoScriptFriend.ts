import type { DemoBeat } from './demoScript';

/**
 * 演示剧本 test_conversation_03《一个改变过我的朋友》。
 *
 * 这个剧本刻意和另外两个不同：它讲的是「关系如何改变了用户」，
 * 用来演示状态机怎么在 TURNING_POINT 上停下来，而不是继续挖事实。
 */

const U1 = '我们高中同桌。他成绩比我好很多，但从来不嫌我笨，我有不会的题他都讲到我听懂为止。';
const U2 =
  '他特别有耐心。有一次一道数学题，他给我讲了三遍我还是不懂，他就换了个说法，拿笔在草稿纸上画图，最后我终于明白了。那天晚自习下课，他比我还高兴。';
const U3 =
  '我们每天一起骑车回家，路上会聊很久。他老说以后想去西北，说他在地理课本上看到过一片湖，特别想去看看。';
const U4 = '就跟平时不太一样，特别认真。后来他还把那张地图贴在课桌上。';
const U5 = '我那时候没什么想法，就想考个离家近的学校。是他老拉着我看地图，我才第一次觉得外面好像也挺大的。';
const U6 = '应该就是那段时间吧。以前我觉得留在家里就挺好，后来我第一次开始想，我也可以去远一点的地方。';
const U7 = '对。后来我填志愿报到了这边，其实也是被他带的。';
const U8 = '高考以后就慢慢少了。他去西北读的，我来了这边。刚开始还发消息，后来就没什么话了。';
const U9 = '会。我有时候看到地图还是会想起他。我一直没跟他说过，其实是他让我觉得我也可以走出去。';
const U10 = '好，你整理吧。';

export const FRIEND_BEATS: DemoBeat[] = [
  {
    /* k=0 · 开场白 */
    ai: '您想讲的那个朋友，你们是怎么认识的？',
    sampleUser: U1,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '一个改变过用户的朋友',
  },
  {
    /* k=1 */
    ai: '他会一直讲到您听懂为止。您还记得他讲题的时候是什么样子吗？',
    sampleUser: U2,
    newClues: [
      { kind: 'person', text: '高中同桌', importance: 5, evidence: '我们高中同桌' },
      { kind: 'detail', text: '成绩好很多，但从来不嫌我笨', importance: 4, evidence: '他成绩比我好很多，但从来不嫌我笨' },
      { kind: 'detail', text: '有不会的题都讲到我听懂为止', importance: 5, evidence: '我有不会的题他都讲到我听懂为止' },
    ],
    memoryPatch: {
      people: [{ name: '高中同桌', relationship: '高中同桌，成绩比用户好', importance: 5 }],
      details: [
        { detail: '成绩好很多，但从来不嫌用户笨', importance: 4 },
        { detail: '有不会的题都讲到用户听懂为止', importance: 5 },
      ],
      user_quotes: ['他成绩比我好很多，但从来不嫌我笨，我有不会的题他都讲到我听懂为止'],
    },
    selectedTarget: '有不会的题都讲到我听懂为止',
  },
  {
    /* k=2 */
    ai: '您终于明白的时候，他比您还高兴。那时候你们除了学习，平时还一起做什么？',
    sampleUser: U3,
    newClues: [
      {
        kind: 'event',
        text: '一道数学题讲了三遍，换说法、画图，最后终于听懂',
        importance: 5,
        evidence: '他给我讲了三遍我还是不懂，他就换了个说法，拿笔在草稿纸上画图',
      },
      { kind: 'emotion', text: '（他）比我还高兴', importance: 5, evidence: '那天晚自习下课，他比我还高兴' },
    ],
    memoryPatch: {
      events: [
        {
          description: '一道数学题他讲了三遍，换说法、在草稿纸上画图，用户终于听懂',
          time: '高中',
          place: '教室',
          importance: 5,
        },
      ],
      emotions: [{ emotion: '（他）为我的进步高兴', evidence: '那天晚自习下课，他比我还高兴', confidence: 0.8 }],
      details: [{ detail: '拿笔在草稿纸上画图讲题', importance: 4 }],
      user_quotes: ['他给我讲了三遍我还是不懂，他就换了个说法，拿笔在草稿纸上画图，最后我终于明白了'],
    },
    selectedTarget: '一道题讲三遍，最后他终于把用户讲懂',
    highValueClues: ['⭐ 用户终于听懂的时候，他比用户还高兴'],
    extraReasons: ['存在情绪变化'],
  },
  {
    /* k=3 */
    ai: '一个想去西北看湖的人。您还记得他说起那片湖的时候是什么样子吗？',
    sampleUser: U4,
    newClues: [
      { kind: 'event', text: '每天一起骑车回家，路上聊很久', importance: 4, evidence: '我们每天一起骑车回家，路上会聊很久' },
      { kind: 'detail', text: '他说以后想去西北，看地理课本上那片湖', importance: 5, evidence: '他老说以后想去西北' },
    ],
    memoryPatch: {
      events: [{ description: '两人每天一起骑车回家，路上聊很久', time: '高中', place: '放学路上', importance: 4 }],
      details: [{ detail: '他说以后想去西北，看地理课本上看到过的那片湖', importance: 5 }],
      user_quotes: ['他老说以后想去西北，说他在地理课本上看到过一片湖，特别想去看看'],
    },
    selectedTarget: '他说以后想去西北看那片湖',
  },
  {
    /* k=4 */
    ai: '他把那张地图贴在课桌上，您一直记得这个。那时候您自己有想过以后要去哪儿吗？',
    sampleUser: U5,
    newClues: [
      { kind: 'detail', text: '把那张地图贴在课桌上', importance: 5, evidence: '后来他还把那张地图贴在课桌上' },
      { kind: 'emotion', text: '说起那片湖时特别认真', importance: 4, evidence: '就跟平时不太一样，特别认真' },
    ],
    memoryPatch: {
      details: [{ detail: '把那张地图贴在课桌上', importance: 5 }],
      emotions: [{ emotion: '（他）说起那片湖时格外认真', evidence: '就跟平时不太一样，特别认真', confidence: 0.75 }],
      user_quotes: ['就跟平时不太一样，特别认真。后来他还把那张地图贴在课桌上'],
    },
    selectedTarget: '他把那张地图贴在课桌上',
    highValueClues: ['⭐ 那张地图被贴在课桌上——一个具体的、一直记得的细节'],
  },
  {
    /* k=5 · 关系带来的变化 */
    ai: '您说了一句我很在意的话——“是他拉着我看地图，我才第一次觉得外面好像也挺大的”。这个变化，大概是从什么时候开始的？',
    sampleUser: U6,
    newClues: [
      { kind: 'emotion', text: '（此前）没什么想法，只想考个离家近的学校', importance: 4, evidence: '我那时候没什么想法，就想考个离家近的学校' },
      { kind: 'meaning', text: '是他拉着我看地图，我才第一次觉得外面挺大的', importance: 5, evidence: '是他老拉着我看地图，我才第一次觉得外面好像也挺大的' },
    ],
    memoryPatch: {
      meaning: [{ interpretation: '是他拉着我看地图，我才第一次觉得外面好像也挺大的', confirmed_by_user: false }],
      user_quotes: ['我那时候没什么想法，就想考个离家近的学校。是他老拉着我看地图，我才第一次觉得外面好像也挺大的'],
    },
    selectedTarget: '是他拉着我看地图，我才第一次觉得外面挺大的',
    highValueClues: ['⭐ 「是他拉着我看地图，我才第一次觉得外面挺大的」——朋友带来的变化'],
    extraReasons: ['用户主动提及', '是故事中的意义转折'],
  },
  {
    /* k=6 · 意义转折 */
    ai: '所以真正让您开始想「我也可以去远一点的地方」的，不是哪一堂课，而是他每天拉着您看地图的那段时间——这样理解对吗？',
    sampleUser: U7,
    newClues: [
      {
        kind: 'turning_point',
        text: '以前觉得留在家里就挺好 → 第一次想「我也可以去远一点的地方」',
        importance: 5,
        evidence: '以前我觉得留在家里就挺好，后来我第一次开始想，我也可以去远一点的地方',
      },
    ],
    memoryPatch: {
      turning_points: [
        {
          before: '觉得留在家里就挺好',
          after: '第一次开始想「我也可以去远一点的地方」',
          trigger: '他每天拉着用户一起看地图的那段时间',
        },
      ],
      user_quotes: ['以前我觉得留在家里就挺好，后来我第一次开始想，我也可以去远一点的地方'],
    },
    selectedTarget: '从「留在家里就挺好」到「我也可以去远一点的地方」',
    highValueClues: ['⭐ 从「留在家里挺好」到「我也可以去远一点的地方」'],
    extraReasons: ['是故事中的意义转折', '能连接多个已有事件'],
  },
  {
    /* k=7 */
    ai: '您说填志愿其实也是被他带的。后来你们还有联系吗？',
    sampleUser: U8,
    newClues: [
      { kind: 'event', text: '填志愿报到了这边，也是被他带的', importance: 4, evidence: '后来我填志愿报到了这边，其实也是被他带的' },
    ],
    memoryPatch: {
      events: [{ description: '填志愿报到这边，也是受他的影响', time: '高考后', place: '', importance: 4 }],
      user_quotes: ['对。后来我填志愿报到了这边，其实也是被他带的'],
    },
    selectedTarget: '填志愿也受了他的影响',
    extraReasons: ['能连接多个已有事件'],
  },
  {
    /* k=8 */
    ai: '听起来你们是慢慢走散的，不是发生了什么。您现在还会想起他吗？',
    sampleUser: U9,
    newClues: [
      { kind: 'event', text: '高考以后联系慢慢变少', importance: 3, evidence: '高考以后就慢慢少了' },
      { kind: 'emotion', text: '（想到他时）会想起', importance: 4, evidence: '我有时候看到地图还是会想起他' },
    ],
    memoryPatch: {
      events: [{ description: '高考后他去西北读书，用户来了这边，联系慢慢变少', time: '高考以后', place: '', importance: 3 }],
      emotions: [{ emotion: '还会想起他', evidence: '我有时候看到地图还是会想起他', confidence: 0.85 }],
      user_quotes: ['我有时候看到地图还是会想起他'],
    },
    selectedTarget: '高考以后联系慢慢变少',
    highValueClues: ['⭐ 「我有时候看到地图还是会想起他」'],
    extraReasons: ['存在情绪变化'],
  },
  {
    /* k=9 · 故事已完整，主动收尾 */
    ai: '谢谢您把这个人讲给我听。我觉得今天这个故事已经很完整了——从同桌、一张贴在课桌上的地图，到您后来真的来到了一个更远的地方。我先替您整理下来，您看看是不是您想留下来的样子？',
    sampleUser: U10,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '一直没跟他说过，其实是他让我觉得我也可以走出去',
    highValueClues: ['⭐ 他带来的变化', '⭐ 「是他让我觉得我也可以走出去」'],
    extraReasons: ['是故事中的意义转折', '能连接多个已有事件', '当前风险低'],
  },
];

/** 最终故事：只用用户说过的事 */
export const FRIEND_STORY = {
  title: '那个把地图贴在课桌上的同桌',
  content: `我们高中是同桌。他成绩比我好很多，但从来不嫌我笨。我有不会的题，他都讲到我听懂为止。

他特别有耐心。有一次一道数学题，他给我讲了三遍我还是不懂，他就换了个说法，拿笔在草稿纸上画图，最后我终于明白了。那天晚自习下课，他比我还高兴。

我们每天一起骑车回家，路上会聊很久。他老说以后想去西北，说他在地理课本上看到过一片湖，特别想去看看。后来他还把那张地图贴在课桌上。

我那时候没什么想法，就想考个离家近的学校。是他老拉着我看地图，我才第一次觉得外面好像也挺大的。再后来，我第一次开始想，我也可以去远一点的地方。

后来我填志愿报到了这边，其实也是被他带的。

高考以后我们就慢慢少了联系。他去西北读的，我来了这边。刚开始还发消息，后来就没什么话了。

我有时候看到地图还是会想起他。我一直没跟他说过，其实是他让我觉得，我也可以走出去。`,
  literary: false,
};

/** 剧本里已经确认过的理解 */
export const FRIEND_CONFIRMED_MEANINGS = ['朋友带来的变化：是他让我觉得我也可以去远一点的地方'];
