/**
 * 跨设备身份提示的回归测试（方案 A）。
 *
 * 背景：同一链接在电脑 / 手机浏览器 / 微信里显示不同故事，是因为当前是**游客身份**，
 * 故事归属由 auth.uid() 决定，与浏览器绑定。真正的修法是绑定账号（方案 B），
 * 在做到之前，产品必须如实告诉用户，并给出可用的搬运办法。
 *
 * 这个测试防止「已同步到云端」这类过度承诺的文案再回来。
 *
 * 用法：node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/deviceIdentityCopy.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    fail += 1;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');

function main(): void {
  const stories = read('src/pages/MyStoriesPage.tsx');
  const settings = read('src/pages/SettingsPage.tsx');

  console.log('\n========== 1. 「我的故事」不再过度承诺 ==========');
  {
    assert(
      stories.includes('已同步到云端 · 这台设备'),
      '同步文案写明「这台设备」，不再让人以为换设备也能看到',
    );
    assert(
      !/synced: '已同步到云端',/.test(stories),
      '旧的裸文案「已同步到云端」不会再回来',
    );
    assert(
      stories.includes('换设备？先导出再导入'),
      '有故事的页面上给出跨设备搬运入口',
    );
    assert(/navigate\('\/settings'\)/.test(stories), '搬运入口指向设置页（导出/导入在那里）');
  }

  console.log('\n========== 2. 设置页把「什么算新设备」说清楚 ==========');
  {
    assert(settings.includes('微信'), '明确点出「在微信里打开」也算新设备');
    assert(settings.includes('导出 JSON') && settings.includes('导入故事'), '导出/导入入口都在');
    assert(
      /换设备前，请先在旧设备「导出 JSON」/.test(settings),
      '给出可执行的两步搬运办法（旧设备导出 → 新设备导入）',
    );
    assert(/导入是追加，不会覆盖/.test(settings), '说明导入不会覆盖已有故事（降低操作顾虑）');
  }

  console.log('\n========== 3. 文案不制造焦虑 ==========');
  {
    assert(!/数据(可能)?丢失|危险|警告/.test(stories + settings), '不使用「丢失/危险/警告」这类词');
    // 只看用户能看到的文案：注释里出现「完成度」是在说明"不做成完成度管理器"，不算违规
    const visible = stories.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert(!/完成度|进度|还差 \d+/.test(visible), '用户可见文案里不出现完成度/进度');
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  if (fail > 0) {
    console.log('失败项：\n' + failures.map((item) => '  - ' + item).join('\n'));
    process.exit(1);
  }
  console.log('全部通过。');
}

main();
