/**
 * run-on-home.mjs — 对着真实的工作空间跑一次：建索引、体检、归纳。
 *
 * 用法：node test/run-on-home.mjs [root] [--tend]
 */

import { memoryPaths, resolveRoot } from '../src/paths.js';
import { loadFor } from '../src/config.js';
import { listDays } from '../src/store.js';
import { rebuildIndex } from '../src/index-gen.js';
import { lintTide, formatLint } from '../src/lint.js';
import { tendTide, formatTend } from '../src/tend.js';

const args = process.argv.slice(2);
const doTend = args.includes('--tend');
const root = resolveRoot(args.find((arg) => !arg.startsWith('--')));
const paths = memoryPaths(root);
const { config } = await loadFor(paths.root, { createIfMissing: true });

console.log(`根目录：${paths.root}\n`);

for (const tier of ['hot', 'cold']) {
  const days = await listDays(paths, tier);
  const info = await rebuildIndex(paths, tier, days);
  console.log(`${tier === 'hot' ? '热档' : '冷档'}索引：${info.days} 天 / ${info.bytes} 字节 → ${info.file}`);
}

if (doTend) {
  console.log('\n--- 归纳（预演）---');
  const dry = await tendTide(paths, config, { dryRun: true });
  console.log(formatTend(dry));
  console.log('\n--- 归纳（实跑）---');
  const real = await tendTide(paths, config, {});
  console.log(formatTend(real));
  for (const tier of ['hot', 'cold']) {
    const days = await listDays(paths, tier);
    const info = await rebuildIndex(paths, tier, days);
    console.log(`${tier === 'hot' ? '热档' : '冷档'}索引重建：${info.days} 天`);
  }
}

console.log('\n--- 体检 ---');
const report = await lintTide(paths, config);
console.log(formatLint(report));
