/**
 * 用《做了一些事情才发现》这份真实语料的「形状」做离线回归：
 * 把用户贴出的采访脉络重建成原始语料，喂一段「老式的、坏的故事」和一组「老式的、坏的发现」，
 * 验证新的闸门：会拦下拼接口吻、重复信息、凭空心理戏、引用式发现、整句复述、证据不足的推断。
 *
 * 运行：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/storyEditReal.test.ts
 */
import { lintStory } from '../src/services/storyLint';
import { lintDiscoveries } from '../src/services/contentGuard';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
    console.log('  ✓ ' + msg);
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}

// —— 重建《做了一些事情才发现》的原始语料（来自用户贴出的脉络）——
const transcript = [
  '去乡村支教，和一群原本不熟悉的人一起工作。',
  '自己作为副队长，希望帮助大家。',
  '我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚，觉得自己没能做好，我哭了。',
  '接住我的人是领队。',
  '之前在任务中，自己其实也有质疑，但不敢表达。',
  '因为担心别人觉得自己不接受、觉得我不讲理。',
  '领队鼓励自己把想法说出来，还告诉自己有需要帮助的时候，他在。',
  '后来自己真正把想法说出来。',
  '对方有些生气，双方都受到伤害。',
  '每个人思考和处理问题的方式可能不同，需要沟通和理解，双方都需要努力。',
  '即使双方都努力了，结果不一定理想，自己开始可以接受这一点。',
];

// ============ 老式「坏故事」：回答拼接 + 重复 + 凭空心理戏 ============
const badStory = [
  '去乡村支教，和一群原本不熟悉的人一起工作。',
  '自己作为副队长，希望帮助大家。',
  '我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚，觉得自己没能做好，我哭了。',
  '我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚，觉得自己没能做好，我哭了。', // 重复
  '接住我的人是领队。',
  '之前在任务中，自己其实也有质疑，但不敢表达。',
  '因为担心别人觉得自己不接受、不讲理。',
  '领队鼓励自己把想法说出来，还告诉自己有需要帮助的时候，他在。',
  '后来自己真正把想法说出来。',
  '对方有些生气，双方都受到伤害。',
  '我心里想着，原来领队从一开始就一直在默默守护着我。', // 凭空心理戏（无原话支撑）
  '每个人思考和处理问题的方式可能不同，需要沟通和理解，双方都需要努力。',
  '即使双方都努力了，结果不一定理想，自己开始可以接受这一点。',
].join('\n');

const v = lintStory(badStory, transcript);
ok(
  v.some((x) => x.kind === 'repetition' && x.detail.includes('新增的信息')),
  '坏故事：重复出现的「团队闹矛盾…我哭了」被标记为「保留新增信息、重新组织」',
);
ok(
  v.some((x) => x.kind === 'inner_thought'),
  '坏故事：凭空心理戏「我心里想着，原来领队从一开始就一直在默默守护着我」被拦截',
);

// 衔接句：用用户原话串起来的「那次…之后」应当放行
const goodConnect = '那次哭出来之后，我才意识到，原来在这个并不熟悉的团队里，已经有人在接住我了。\n这个人是领队。';
ok(
  !lintStory(goodConnect, transcript).some((x) => x.kind === 'inner_thought'),
  '好故事：用原话串起来的衔接句「那次哭出来之后…」被放行',
);

// ============ 老式「坏发现」：引用式 / 整句复述 / 证据不足 ============
const badDiscoveries = [
  { id: 'a', kind: 'care' as const, text: '你提到，希望自己的想法可以被看到，希望得到一些反馈。', evidence: ['希望自己的想法可以被看到'] },
  { id: 'b', kind: 'care' as const, text: '我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚，觉得自己没能做好，我哭了。', evidence: ['我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚'] },
  { id: 'c', kind: 'refuse' as const, text: '你不想被理解成「不接受别人」或者「不讲理」。', evidence: ['因为担心别人觉得自己不接受、觉得我不讲理'] },
  { id: 'd', kind: 'care' as const, text: '你很在意自己的想法有没有被接住。', evidence: ['后来自己真正把想法说出来'] },
];

const res = lintDiscoveries(
  badDiscoveries,
  transcript,
);
ok(res.dropped.some((d) => d.reason.includes('你提到')), '坏发现：以「你提到」开头的引用式发现被丢弃');
ok(res.dropped.some((d) => d.reason.includes('复述')), '坏发现：整句复述用户原话的发现被丢弃');

// d 是推断（care）、只有 1 条证据、无开放性措辞 → 丢弃
ok(
  res.dropped.some((d) => d.text.includes('被接住') && d.reason.includes('证据')),
  '坏发现：推断类「被接住」只有 1 条证据且无 hedging → 丢弃',
);

// c 是 refuse + 直接引用「怕提出来…」→ 保留
ok(res.kept.some((d) => d.id === 'c'), '好发现：refuse 且直接引用原话（含逐字依据）→ 保留');

// 一条像样的发现：综合 + 2 条证据
const goodDiscoveries = [
  {
    id: 'e',
    kind: 'care' as const,
    text: '自己的想法有没有被真正接住。',
    support: '你一开始并不太敢提出质疑，因为担心对方觉得你「不接受」或者「不讲理」；但后来你还是把自己的想法说了出来，也明确希望自己的想法能够「被看到」。',
    evidence: ['因为担心别人觉得自己不接受、觉得我不讲理', '后来自己真正把想法说出来'],
  },
];
const res2 = lintDiscoveries(goodDiscoveries, transcript);
ok(res2.kept.some((d) => d.id === 'e' && d.support?.includes('敢提出质疑')), '好发现：综合表达 + support + 2 条证据 → 保留并带上 support');

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (fail > 0) process.exit(1);
