/**
 * 故事编辑 / 发现生成 的确定性闸门。
 * 运行：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/storyEdit.test.ts
 */
import { lintStory } from '../src/services/storyLint';
import { lintDiscoveries } from '../src/services/contentGuard';
import { OUTLINE_SYSTEM_PROMPT, STORY_SYSTEM_PROMPT } from '../src/data/prompts';
import type { Discovery } from '../src/types/discovery';

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

const run = (raw: Discovery[], corpus: string[]) => lintDiscoveries(raw, corpus);

// ============ 1. 故事编辑：衔接句放行，纯编造心理活动仍拦 ============
const userTexts = [
  '团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚，我哭了。',
  '接住我的人是领队。',
  '原来在这个并不熟悉的团队里，已经有人在接住我了。',
];

const connecting =
  '那次哭出来之后，我才意识到，原来在这个并不熟悉的团队里，已经有人在接住我了。\n这个人是领队。';
ok(
  !lintStory(connecting, userTexts).some((v) => v.kind === 'inner_thought'),
  '以「那次」开头的衔接句不再判为心理活动',
);

const fabricated = '后来我才意识到自己其实是一个很脆弱的人。';
ok(
  lintStory(fabricated, ['我就是有点累。']).some((v) => v.kind === 'inner_thought'),
  '借「后来」开头却没有原话支撑的编造仍被拦截',
);

ok(
  lintStory('他走过来对我说：「你别管了。」', ['我们聊了会儿。']).some(
    (v) => v.kind === 'invented_dialogue',
  ),
  '凭空出现带引号的对话仍被拦截',
);

const rep = lintStory(
  '我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚。' +
    '我们团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚。',
  userTexts,
);
ok(
  rep.some((v) => v.kind === 'repetition' && v.detail.includes('新增的信息')),
  '重复信息提示改为「保留新增信息、重新组织」',
);

// ============ 2. 发现生成：复述 / 你提到 / 推断证据 ============
const corpus = [
  '希望自己的想法可以被看到',
  '怕提出来对方觉得不接受、觉得我不讲理',
  '还是把自己的想法说出来了',
  '领队鼓励我说出来',
  '有需要帮助的时候，他在',
  '团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚',
];

const r1 = run(
  [{ id: 'a', kind: 'care', text: '你提到，希望自己的想法可以被看到。', evidence: ['希望自己的想法可以被看到'] }],
  corpus,
);
ok(r1.dropped.some((d) => d.reason.includes('你提到')), '「你提到」开头的发现被丢弃（那是引用不是发现）');

const r2 = run(
  [
    {
      id: 'b',
      kind: 'care',
      text: '团队闹矛盾的时候，我作为副队长没能处理好，我很愧疚。',
      evidence: ['团队闹矛盾的时候'],
    },
  ],
  corpus,
);
ok(r2.dropped.some((d) => d.reason.includes('复述')), '整句复述用户原话的发现被丢弃');

const r3 = run(
  [{ id: 'c', kind: 'care', text: '你很在意自己的想法有没有被接住。', evidence: ['还是把自己的想法说出来了'] }],
  corpus,
);
ok(r3.dropped.length > 0, '推断类发现：只有 1 条证据且无开放性措辞 → 丢弃');

const r4 = run(
  [
    {
      id: 'd',
      kind: 'care',
      text: '你很在意自己的想法有没有被接住。',
      evidence: ['怕提出来对方觉得不接受、觉得我不讲理', '还是把自己的想法说出来了'],
    },
  ],
  corpus,
);
ok(r4.kept.length === 1, '推断类发现：有 ≥2 条证据 → 保留');

const r5 = run(
  [{ id: 'e', kind: 'care', text: '你似乎很在意自己的想法有没有被接住。', evidence: ['还是把自己的想法说出来了'] }],
  corpus,
);
ok(r5.kept.length === 1, '推断类发现：带「似乎」开放性措辞 → 保留');

const r6 = run(
  [
    {
      id: 'f',
      kind: 'refuse',
      text: '你不想被理解成「不接受别人」。',
      evidence: ['怕提出来对方觉得不接受'],
    },
  ],
  corpus,
);
ok(r6.kept.length === 1, '直接引用原话（含「」）→ 保留');

// ============ 3. 提示词契约 ============
ok(OUTLINE_SYSTEM_PROMPT.includes('storyline'), 'OUTLINE 提示词要求产出叙事线 storyline');
ok(OUTLINE_SYSTEM_PROMPT.includes('谁在这个过程中出现'), 'OUTLINE 提示词含叙事线 8 问');
ok(STORY_SYSTEM_PROMPT.includes('那次哭出来之后'), 'STORY 提示词给出「哭了→接住我」衔接示例');
ok(STORY_SYSTEM_PROMPT.includes('禁止添加的事实'), 'STORY 提示词列明禁止添加的事实红线');
ok(STORY_SYSTEM_PROMPT.includes('叙事线 storyline'), 'STORY 提示词要求先按叙事线组织');

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (fail > 0) process.exit(1);
