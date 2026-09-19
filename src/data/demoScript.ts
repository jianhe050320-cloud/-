import type { MemoryPatch } from '../services/memoryService';
import type { ClueKind } from '../types/interview';
import {
  FRIEND_BEATS,
  FRIEND_CONFIRMED_MEANINGS,
  FRIEND_STORY,
} from './demoScriptFriend';
import {
  UNIVERSITY_BEATS,
  UNIVERSITY_CONFIRMED_MEANINGS,
  UNIVERSITY_STORY,
} from './demoScriptUniversity';

/**
 * 测试集 test_conversation_01《第一次离开家》。
 *
 * 这是产品规格里那套真实跑过的老人对话数据，完整保留下来作为「AI 采访能力」的测试集：
 * 故事更长、线索更多，也更容易暴露 badcase。
 *
 * beats[k].ai  = 用户已经说了 k 轮之后，采访者该说的那一句（k=0 是开场白）
 * beats[k].sampleUser = 用户在第 k 轮说的那句话（可作为「用剧本台词回答」按钮）
 */

export interface DemoClueSeed {
  kind: ClueKind;
  text: string;
  importance: number;
  evidence: string;
}

export interface DemoBeat {
  /** 采访者这句 */
  ai: string;
  /** 剧本里用户这一轮的原话 */
  sampleUser?: string;
  newClues: DemoClueSeed[];
  memoryPatch: MemoryPatch;
  /** 本轮推荐追问针对的线索 */
  selectedTarget: string;
  /** 高价值线索（观察面板带 ⭐） */
  highValueClues?: string[];
  /** 额外的推荐理由 */
  extraReasons?: string[];
}

const U1 =
  '怎么不记得呢。那是我二十岁出头的时候吧，我记得那时候我们村里很多年轻人都出去，我也就跟着一起去了。那时候其实也没想那么多，年轻嘛，就觉得外面的世界肯定比家里好。';
const U2 =
  '家嘛，就是从小长大的地方，什么都熟悉。谁家有几口人都知道。外面就不一样了，什么都新鲜。刚出去的时候其实挺兴奋的，但是到了晚上突然就想家了。';
const U3 =
  '就想起我妈。她那时候也没说什么，我走之前她给我煮了几个鸡蛋，偷偷放我包里。晚上我饿了拿出来吃，就突然特别想家。';
const U4 = '她就说，出去好好干，别饿着。其实她这个人不太会说那些肉麻的话，但她总是会做这些事情。';
const U5 = '对，就是这样。';
const U6 =
  '有啊，第一天上班就出问题了。我什么都不会，被师傅骂了一顿。当时特别没面子。我下班以后一个人坐在河边，甚至想过第二天就回家。';
const U7 =
  '差不多吧。我觉得自己什么都不会，又被人骂，觉得自己挺没用的。还有人笑我。我妈临走的时候还跟我说，好好干，别没干几天就回来。我也不想灰溜溜地回去，而且回去也没什么事情做。';
const U8 = '对。我第二天还是去了。';
const U9 = '说来也奇怪，他后来反而帮了我很多。他下班以后还教我，慢慢教我怎么做。后来我一直挺感谢他的。';
const U10 =
  '有一次他下班以后留下来教我，我后来想谢谢他，就买了两瓶酒。但是我也没好意思跟他说谢谢，就放他那里了。';
const U11 = '嗯，差不多吧。';
const U12 = '有啊，我们那时候住一个宿舍，晚上经常聊天。虽然大家都没多少钱，但是关系特别好。';
const U13 =
  '就讲家里的事情，讲各地方的方言，有时候也打牌下棋。过年的时候还一起包饺子。现在想起来，那时候虽然离家很远，但那些人慢慢也像家人一样了。';
const U14 = '这个还真说不上来。可能就是大家一起过年包饺子的时候吧。那时候虽然人在外面，但是一群人围在那里，也觉得挺温暖的。';

export const LEAVING_HOME_BEATS: DemoBeat[] = [
  {
    /* k=0 · 开场白 */
    ai: '您还记得第一次离开家，去外地工作的时候吗？',
    sampleUser: U1,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '第一次离开家去外地工作',
  },
  {
    /* k=1 */
    ai: '听起来，二十岁出头的时候，家里还是您最熟悉的地方，而外面的世界既陌生又让人有点期待。那时候您眼里的家，和外面的世界，分别是什么样子的？',
    sampleUser: U2,
    newClues: [
      {
        kind: 'event',
        text: '第一次外出打工（二十岁出头跟着村里人一起出去）',
        importance: 5,
        evidence: '那是我二十岁出头的时候吧，我记得那时候我们村里很多年轻人都出去，我也就跟着一起去了',
      },
      {
        kind: 'emotion',
        text: '期待',
        importance: 3,
        evidence: '年轻嘛，就觉得外面的世界肯定比家里好',
      },
    ],
    memoryPatch: {
      events: [
        { description: '第一次外出打工，二十岁出头跟着村里人一起出去', time: '二十岁出头', place: '', importance: 5 },
      ],
      emotions: [{ emotion: '期待', evidence: '就觉得外面的世界肯定比家里好', confidence: 0.7 }],
      user_quotes: ['那时候其实也没想那么多，年轻嘛，就觉得外面的世界肯定比家里好'],
    },
    selectedTarget: '第一次外出打工（二十岁出头跟着村里人一起出去）',
  },
  {
    /* k=2 */
    ai: '您说到晚上突然想家，我有点好奇，那时候一想起家，最先想到的是什么？',
    sampleUser: U3,
    newClues: [
      { kind: 'emotion', text: '想家', importance: 5, evidence: '到了晚上突然就想家了' },
      { kind: 'event', text: '刚出去那几天白天兴奋，晚上开始想家', importance: 4, evidence: '刚出去的时候其实挺兴奋的，但是到了晚上突然就想家了' },
    ],
    memoryPatch: {
      emotions: [{ emotion: '想家', evidence: '到了晚上突然就想家了', confidence: 0.9 }],
      events: [{ description: '刚出去时白天兴奋，到了晚上开始想家', time: '', place: '', importance: 4 }],
    },
    selectedTarget: '想家',
    extraReasons: ['存在情绪变化'],
  },
  {
    /* k=3 · 规格里明确标注「此时 AI 应该识别」的一轮 */
    ai: '您妈妈当时没有说太多话，却提前给您包里放了几个鸡蛋。您还记得她把鸡蛋放进去的时候，有没有跟您说些什么吗？',
    sampleUser: U4,
    newClues: [
      { kind: 'person', text: '妈妈', importance: 5, evidence: '就想起我妈' },
      { kind: 'detail', text: '临走前煮了几个鸡蛋，偷偷放进包里', importance: 5, evidence: '我走之前她给我煮了几个鸡蛋，偷偷放我包里' },
      { kind: 'emotion', text: '想家', importance: 5, evidence: '晚上我饿了拿出来吃，就突然特别想家' },
    ],
    memoryPatch: {
      people: [{ name: '妈妈', relationship: '母亲', importance: 5 }],
      details: [{ detail: '走之前煮了几个鸡蛋，偷偷放进包里', importance: 5 }],
      events: [{ description: '晚上饿了，拿出妈妈煮的鸡蛋，突然特别想家', time: '', place: '', importance: 4 }],
      user_quotes: ['她那时候也没说什么，我走之前她给我煮了几个鸡蛋，偷偷放我包里'],
    },
    selectedTarget: '临走前煮了几个鸡蛋，偷偷放进包里',
    highValueClues: ['母亲表达关心的方式（不说，只做）'],
    extraReasons: ['能连接多个已有事件'],
  },
  {
    /* k=4 */
    ai: '我好像有点明白您说的那种感觉了。她可能不太会直接表达，但会把关心放在这些小事情里面。不知道我这样理解对不对？',
    sampleUser: U5,
    newClues: [
      { kind: 'meaning', text: '妈妈不太说肉麻的话，但总是用做事来表达关心', importance: 5, evidence: '她这个人不太会说那些肉麻的话，但她总是会做这些事情' },
      { kind: 'quote', text: '出去好好干，别饿着', importance: 4, evidence: '她就说，出去好好干，别饿着' },
    ],
    memoryPatch: {
      meaning: [{ interpretation: '妈妈不太说肉麻的话，但总是用做事来表达关心', confirmed_by_user: false }],
      user_quotes: ['她就说，出去好好干，别饿着', '她这个人不太会说那些肉麻的话，但她总是会做这些事情'],
    },
    selectedTarget: '妈妈不太说肉麻的话，但总是用做事来表达关心',
    extraReasons: ['是故事中的意义转折'],
  },
  {
    /* k=5 · 用户确认 → L4 升级为 L5 */
    ai: '那后来到了外面工作以后，有没有哪件事情，让您第一次觉得“出去也没有想象中那么容易”？',
    sampleUser: U6,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '第一次外出打工（二十岁出头跟着村里人一起出去）',
  },
  {
    /* k=6 */
    ai: '听起来第一天对您来说挺难受的。您当时坐在河边的时候，是真的已经想好要回家了吗？',
    sampleUser: U7,
    newClues: [
      { kind: 'event', text: '第一天工作失败：什么都不会，被师傅骂了一顿', importance: 5, evidence: '第一天上班就出问题了。我什么都不会，被师傅骂了一顿' },
      { kind: 'emotion', text: '委屈', importance: 4, evidence: '当时特别没面子' },
      { kind: 'detail', text: '下班后一个人坐在河边', importance: 5, evidence: '我下班以后一个人坐在河边，甚至想过第二天就回家' },
    ],
    memoryPatch: {
      events: [{ description: '第一天工作失败，什么都不会被师傅骂了一顿', time: '第一天上班', place: '', importance: 5 }],
      emotions: [{ emotion: '委屈', evidence: '当时特别没面子', confidence: 0.85 }],
      details: [{ detail: '下班后一个人坐在河边，想过第二天就回家', importance: 5 }],
      user_quotes: ['我下班以后一个人坐在河边，甚至想过第二天就回家'],
    },
    selectedTarget: '下班后一个人坐在河边',
    highValueClues: ['下班后一个人坐在河边'],
    extraReasons: ['存在情绪变化'],
  },
  {
    /* k=7 · 转折点：想回家 → 决定留下 */
    ai: '所以最后真正让您第二天又回去上班的，好像不只是舍不得那份工作，也有一点不想让自己就这样回去。这样理解对吗？',
    sampleUser: U8,
    newClues: [
      {
        kind: 'turning_point',
        text: '想回家 → 决定留下',
        importance: 5,
        evidence: '我也不想灰溜溜地回去，而且回去也没什么事情做',
      },
      { kind: 'detail', text: '妈妈临走前的话：好好干，别没干几天就回来', importance: 4, evidence: '我妈临走的时候还跟我说，好好干，别没干几天就回来' },
      { kind: 'emotion', text: '犹豫', importance: 4, evidence: '觉得自己挺没用的' },
    ],
    memoryPatch: {
      turning_points: [
        {
          before: '想第二天就回家',
          after: '第二天还是回去上班了',
          trigger: '妈妈临走前的话 + 不想灰溜溜地回去 + 回去也没什么事情做',
        },
      ],
      details: [{ detail: '妈妈临走前说「好好干，别没干几天就回来」', importance: 4 }],
      emotions: [{ emotion: '犹豫', evidence: '觉得自己挺没用的', confidence: 0.7 }],
      user_quotes: ['我也不想灰溜溜地回去，而且回去也没什么事情做'],
    },
    selectedTarget: '想回家 → 决定留下',
    highValueClues: ['想回家 → 决定留下'],
    extraReasons: ['是故事中的意义转折', '能连接多个已有事件'],
  },
  {
    /* k=8 · 用户确认转折 */
    ai: '那个第一天骂您的师傅，后来和您之间怎么样了？',
    sampleUser: U9,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '想回家 → 决定留下',
  },
  {
    /* k=9 */
    ai: '您刚才说“挺感谢他的”。后来有没有一件具体的事情，让您特别记住他的帮助？',
    sampleUser: U10,
    newClues: [
      { kind: 'person', text: '师傅', importance: 5, evidence: '他后来反而帮了我很多' },
      { kind: 'turning_point', text: '师傅与用户关系发生变化：骂他 → 帮他', importance: 5, evidence: '说来也奇怪，他后来反而帮了我很多。他下班以后还教我' },
      { kind: 'emotion', text: '感激', importance: 4, evidence: '后来我一直挺感谢他的' },
    ],
    memoryPatch: {
      people: [{ name: '师傅', relationship: '带自己的前辈', importance: 5 }],
      turning_points: [
        { before: '第一天被师傅骂', after: '师傅下班后留下来教他', trigger: '师傅主动留下来教' },
      ],
      emotions: [{ emotion: '感激', evidence: '后来我一直挺感谢他的', confidence: 0.9 }],
    },
    selectedTarget: '师傅与用户关系发生变化：骂他 → 帮他',
    highValueClues: ['师傅与用户关系发生变化'],
    extraReasons: ['是故事中的意义转折'],
  },
  {
    /* k=10 */
    ai: '我注意到，您一直记得他当时帮您的事情，后来还专门买了两瓶酒，只是没有直接说谢谢。我在想，这可能就是您表达感谢的方式，不知道我理解得对不对？',
    sampleUser: U11,
    newClues: [
      { kind: 'detail', text: '买了两瓶酒放在师傅那里，没好意思说谢谢', importance: 5, evidence: '就买了两瓶酒。但是我也没好意思跟他说谢谢，就放他那里了' },
      { kind: 'meaning', text: '用行动而不是语言表达感谢', importance: 5, evidence: '没好意思跟他说谢谢，就放他那里了' },
    ],
    memoryPatch: {
      details: [{ detail: '买了两瓶酒放到师傅那里，没好意思当面说谢谢', importance: 5 }],
      meaning: [{ interpretation: '习惯用行动而不是语言表达感谢', confirmed_by_user: false }],
      user_quotes: ['我也没好意思跟他说谢谢，就放他那里了'],
    },
    selectedTarget: '用行动而不是语言表达感谢',
    highValueClues: ['用行动而不是语言表达感谢'],
    extraReasons: ['是故事中的意义转折'],
  },
  {
    /* k=11 · 用户确认 → L5 */
    ai: '除了师傅，那时候一起在外面工作的那些人，后来有没有慢慢变成您很重要的朋友？',
    sampleUser: U12,
    newClues: [],
    memoryPatch: {},
    selectedTarget: '师傅与用户关系发生变化：骂他 → 帮他',
  },
  {
    /* k=12 */
    ai: '您刚才说了一句话我挺喜欢的——“虽然没多少钱，但是关系特别好。”那时候大家晚上一般都会聊些什么？',
    sampleUser: U13,
    newClues: [
      { kind: 'person', text: '工友', importance: 4, evidence: '我们那时候住一个宿舍，晚上经常聊天' },
      { kind: 'event', text: '住一个宿舍，晚上经常聊天，关系特别好', importance: 4, evidence: '虽然大家都没多少钱，但是关系特别好' },
      { kind: 'emotion', text: '温暖', importance: 4, evidence: '关系特别好' },
      { kind: 'quote', text: '虽然大家都没多少钱，但是关系特别好', importance: 5, evidence: '虽然大家都没多少钱，但是关系特别好' },
    ],
    memoryPatch: {
      people: [{ name: '工友', relationship: '一起在外地干活、同住一个宿舍的人', importance: 4 }],
      events: [{ description: '和工友住一个宿舍，晚上经常聊天，关系特别好', time: '', place: '外地宿舍', importance: 4 }],
      emotions: [{ emotion: '温暖', evidence: '关系特别好', confidence: 0.75 }],
      user_quotes: ['虽然大家都没多少钱，但是关系特别好'],
    },
    selectedTarget: '虽然大家都没多少钱，但是关系特别好',
    extraReasons: ['存在情绪变化', '能连接多个已有事件'],
  },
  {
    /* k=13 · 规格里明确标注「极高价值线索」的一轮 */
    ai: '您刚才说了一句话，我特别有感觉——“那些人慢慢也像家人一样了。”您还记得是什么时候开始，您第一次觉得外面的地方也有一点像“家”了吗？',
    sampleUser: U14,
    newClues: [
      { kind: 'detail', text: '晚上讲家里的事、讲各地方言，打牌下棋，过年一起包饺子', importance: 4, evidence: '过年的时候还一起包饺子' },
      { kind: 'meaning', text: '外面的地方慢慢也变成了一个家', importance: 5, evidence: '那时候虽然离家很远，但那些人慢慢也像家人一样了' },
    ],
    memoryPatch: {
      details: [{ detail: '过年的时候大家一起包饺子', importance: 4 }],
      meaning: [
        { interpretation: '外面的地方慢慢也变成了一个家', confirmed_by_user: false },
      ],
      user_quotes: ['那时候虽然离家很远，但那些人慢慢也像家人一样了'],
    },
    selectedTarget: '外面的地方慢慢也变成了一个家',
    highValueClues: ['外面的地方慢慢也变成了一个家'],
    extraReasons: ['是故事中的意义转折', '存在情绪变化', '能连接多个已有事件'],
  },
  {
    /* k=14 · 故事已完整，主动收尾 */
    ai: '我觉得今天这个故事已经很完整了。从刚开始第一次离开家，到后来想回去，再到师傅和工友慢慢让那个陌生的地方有了一点家的感觉。这里面有很多您自己的经历。我先替您整理下来，您看看是不是您想留下来的样子？',
    sampleUser: '好呀，你整理吧。',
    newClues: [
      { kind: 'meaning', text: '第一次离开家，不是从想家变成不想家，而是在陌生地方慢慢又有了让那里像家的人', importance: 5, evidence: '一群人围在那里，也觉得挺温暖的' },
      { kind: 'emotion', text: '温暖', importance: 4, evidence: '一群人围在那里，也觉得挺温暖的' },
    ],
    memoryPatch: {
      meaning: [
        {
          interpretation: '第一次离开家，不是从想家变成不想家，而是在一个原本陌生的地方，慢慢又有了一些人，让那里也变成了一个家',
          confirmed_by_user: false,
        },
      ],
      emotions: [{ emotion: '温暖', evidence: '一群人围在那里，也觉得挺温暖的', confidence: 0.85 }],
    },
    selectedTarget: '外面的地方慢慢也变成了一个家',
    highValueClues: ['师傅与用户关系发生变化', '外面的地方慢慢也变成了一个家'],
    extraReasons: ['是故事中的意义转折', '能连接多个已有事件', '当前风险低'],
  },
];

/** 最终故事（规格 §三十二 原文，一字不改） */
export const LEAVING_HOME_STORY = {
  title: '第一次离开家',
  content: `二十岁出头的时候，村里很多年轻人都出去打工，我也跟着一起去了。那时候年轻，总觉得外面的世界肯定比家里好。

刚出去的时候其实挺兴奋，可到了晚上，却突然开始想家。

我想起了我妈。她不太会说那些肉麻的话，我走之前，她只是煮了几个鸡蛋，偷偷放进我的包里。晚上饿了，我拿出来吃，就特别想她。

可真正让我觉得外面的世界没那么容易，是第一天上班。我什么都不会，被师傅骂了一顿，还被人笑。下班以后，我一个人坐在河边，甚至想过第二天就回家。

但我最后还是去了。

一方面是因为我妈临走前跟我说，好好干，别没干几天就回来；另一方面，我也不想灰溜溜地回去。

后来那个第一天骂我的师傅，反而成了帮助我很多的人。他下班以后还留下来教我。我一直挺感谢他，后来还买了两瓶酒给他，只是没好意思当面说谢谢。

那时候一起工作的工友，也慢慢成了朋友。大家晚上聊天、打牌、下棋，过年的时候一起包饺子。虽然大家都没多少钱，但关系特别好。

现在回头看，我第一次离开家，并不是从“想家”变成“不想家”，而是在一个原本陌生的地方，慢慢又有了一些人，让那里也变成了一个家。`,
  literary: false,
};

/** 剧本里已经确认过的理解（对话中用户说过「对，就是这样」「嗯，差不多吧」） */
export const LEAVING_HOME_CONFIRMED_MEANINGS = [
  '妈妈不太说肉麻的话，但总是用做事来表达关心',
  '习惯用行动而不是语言表达感谢',
];

/* ---------------- 剧本注册表 ----------------
 * 没有模型密钥时，只有带手写剧本的话题才能演示出「像样的采访」。
 * 其余话题会退化成泛泛追问——所以这里多放几个高频话题。
 */

export interface DemoTopicScript {
  topicId: string;
  beats: DemoBeat[];
  story: { title: string; content: string; literary: boolean };
  /** 剧本中已经被用户确认过的理解 */
  confirmedMeanings: string[];
}

export const DEMO_SCRIPTS: Record<string, DemoTopicScript> = {
  first_leave_home: {
    topicId: 'first_leave_home',
    beats: LEAVING_HOME_BEATS,
    story: LEAVING_HOME_STORY,
    confirmedMeanings: LEAVING_HOME_CONFIRMED_MEANINGS,
  },
  first_university: {
    topicId: 'first_university',
    beats: UNIVERSITY_BEATS,
    story: UNIVERSITY_STORY,
    confirmedMeanings: UNIVERSITY_CONFIRMED_MEANINGS,
  },
  people_friend: {
    topicId: 'people_friend',
    beats: FRIEND_BEATS,
    story: FRIEND_STORY,
    confirmedMeanings: FRIEND_CONFIRMED_MEANINGS,
  },
};

export function findDemoScript(topicId: string | null | undefined): DemoTopicScript | undefined {
  if (!topicId) return undefined;
  return DEMO_SCRIPTS[topicId];
}
