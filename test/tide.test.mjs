/**
 * tide.test.mjs — 跑一遍核心逻辑，不用 DSH、不碰真实记忆。
 *
 * 用法：node test/tide.test.mjs
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryPaths, isoDay } from '../src/paths.js';
import { DEFAULTS, loadConfig } from '../src/config.js';
import {
  appendToDay, writeDay, readDay, listDays, listAll, loadUsage, touchHit, appendToDay as add
} from '../src/store.js';
import { rebuildIndex } from '../src/index-gen.js';
import { searchTide } from '../src/search.js';
import { tendTide, formatTend } from '../src/tend.js';
import { lintTide, formatLint } from '../src/lint.js';

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function dayAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-'));
  const paths = memoryPaths(root);
  const config = await loadConfig(paths);
  console.log(`临时根目录：${root}\n`);

  // 1. 默认配置
  console.log('默认配置');
  check('九个键都在', Object.keys(config).length === Object.keys(DEFAULTS).length);

  // 2. 写几天日记
  console.log('\n写日记');
  await appendToDay(paths, dayAgo(0), '今天在写插件', { section: `${new Date().toTimeString().slice(0, 5)} 开工` });
  await appendToDay(paths, dayAgo(1), '昨天在装 SnowLuma', { section: '14:30 装桥' });
  await appendToDay(paths, dayAgo(9), '九天前在焊板子', { section: '20:00 焊板子' });
  await appendToDay(paths, dayAgo(30), '一个月前在改记忆结构', { section: '01:00 记忆' });
  check('热档 4 天', (await listDays(paths, 'hot')).length === 4);
  check('冷档还没东西', (await listDays(paths, 'cold')).length === 0);

  // 3. 搜索
  console.log('\n搜索');
  const hit = await searchTide(paths, { query: '插件' });
  check('搜得到', hit.count > 0, hit.text.slice(0, 80));
  const miss = await searchTide(paths, { query: '不存在的东西xyz' });
  check('搜不到会说没找到', miss.count === 0 && miss.text.includes('没找到'));
  const andQuery = await searchTide(paths, { query: 'Snow Luma' });
  check('多关键词是 AND', andQuery.count > 0);
  const bad = await searchTide(paths, { query: '在', scope: 'nope' }).catch((e) => e.message);
  check('乱传 scope 会报错', typeof bad === 'string' && bad.includes('scope'));

  // 4. 命中会记次数
  console.log('\n调用次数');
  const usage = await loadUsage(paths);
  const today = dayAgo(0);
  check('今天被记了一次', (usage.days[today]?.hits ?? 0) > 0, JSON.stringify(usage.days[today]));

  // 5. 索引
  console.log('\n索引');
  await rebuildIndex(paths, 'hot', await listDays(paths, 'hot'));
  const hotIndex = await fs.readFile(paths.hotIndex, 'utf8');
  check('热档索引写出来了', hotIndex.includes('热档索引'));
  check('索引里有今天的日期', hotIndex.includes(today));
  check('热档索引提到冷档在哪', hotIndex.includes('cold/INDEX.md'));

  // 6. 归纳
  console.log('\n归纳');
  const dry = await tendTide(paths, config, { dryRun: true });
  check('预演会算出要沉的', dry.toCold.length > 0, JSON.stringify(dry.toCold));
  check('预演不动文件', (await listDays(paths, 'cold')).length === 0);
  const real = await tendTide(paths, config, {});
  check('实跑之后冷档有了', (await listDays(paths, 'cold')).length > 0, JSON.stringify(real.toCold));
  check('近 7 天还在热档', (await listDays(paths, 'hot')).includes(today));
  check('报告能读', formatTend(real).includes('归纳完成'));

  // 7. 冷档被查多了会升回
  console.log('\n冷档升回');
  const coldDay = dayAgo(9);
  for (let i = 0; i < config.coldPromoteHits; i += 1) await touchHit(paths, coldDay, { tier: 'cold' });
  await tendTide(paths, config, {});
  check(`${coldDay} 升回热档了`, (await listDays(paths, 'hot')).includes(coldDay));

  // 8. lint
  console.log('\n体检');
  const report = await lintTide(paths, config);
  const noTime = report.problems.untimed.length;
  check('带时间的小节不报', noTime === 0, `报了 ${noTime} 处`);
  await add(paths, today, '这条没有时间标题', { section: '随手一记' });
  const report2 = await lintTide(paths, config);
  check('不带时间的小节会被挑出来', report2.problems.untimed.length > 0);
  check('报告能读', formatLint(report2).includes('标题没带时间'));

  // 9. 死指针
  console.log('\n死指针');
  await fs.writeFile(paths.memoryFile, [
    '# MEMORY.md',
    '',
    `- 有的一天 → ${today}.md【${new Date().toTimeString().slice(0, 5)} 开工】`,
    '- 不存在的一天 → 2020-01-01.md【瞎写】',
    '- 对不上的小节 → ' + `${today}.md` + '【根本没有这个】',
    ''
  ].join('\n'), 'utf8');
  const report3 = await lintTide(paths, config);
  check('抓到不存在的日子', report3.problems.deadPointers.some((item) => item.day === '2020-01-01'));
  check('抓到对不上的小节', report3.problems.deadPointers.some((item) => item.section === '根本没有这个'));
  check('好指针没被误杀', !report3.problems.deadPointers.some((item) => item.day === '2020-01-01' && false));

  console.log(`\n${failed === 0 ? '全部通过' : '有失败'}：${passed} 通过 / ${failed} 失败`);
  await fs.rm(root, { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
