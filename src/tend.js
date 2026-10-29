/**
 * tend.js — 每天跑一次的归纳。
 *
 * 规则（全部来自配置）：
 *   · 距今 <= hotKeepDays 的日子，一定留在热档
 *   · 更早的：被查过 >= promoteHits 次，或者被钉住且没超过 pinMaxDays → 留热档
 *   · 其余 → 沉到冷档
 *   · 冷档里被查过 >= coldPromoteHits 次 → 升回热档，并钉住
 *   · 冷档超过 coldMaxFiles 个 → 按日期从早到晚删
 *   · 热档设了 hotMaxFiles 且超过 → 最老的沉到冷档（钉住的除外）
 *
 * 搬动是**移动**不是删除，内容一个字不改。
 */

import {
  listAll, listDays, moveDay, deleteDay, loadUsage, saveUsage,
  setPinned, ageOf, today
} from './store.js';
import { rebuildIndex } from './index-gen.js';

function pinExpired(entry, config, nowDay) {
  if (!entry.pinnedAt) return true;
  const since = String(entry.pinnedAt).slice(0, 10);
  return ageOf(since, nowDay) > config.pinMaxDays;
}

export async function tendTide(paths, config, { dryRun = false } = {}) {
  const nowDay = today();
  const usage = await loadUsage(paths);
  const all = await listAll(paths);
  const report = {
    day: nowDay,
    scanned: all.length,
    keepHot: [],
    toHot: [],
    toCold: [],
    unpinned: [],
    deleted: [],
    hotBefore: 0,
    coldBefore: 0,
    hotAfter: 0,
    coldAfter: 0,
    dryRun
  };
  report.hotBefore = all.filter((item) => item.tier === 'hot').length;
  report.coldBefore = all.filter((item) => item.tier === 'cold').length;

  for (const { day, tier } of all) {
    const entry = usage.days[day] ?? { hits: 0, pinned: false, pinnedAt: null };
    const age = ageOf(day, nowDay);

    // 钉住失效：太久没被查了
    if (entry.pinned && pinExpired(entry, config, nowDay)) {
      entry.pinned = false;
      entry.pinnedAt = null;
      report.unpinned.push(day);
      if (!dryRun) await setPinned(paths, day, false);
    }

    let want;
    if (age <= config.hotKeepDays) {
      want = 'hot';
    } else if (entry.pinned || entry.hits >= config.promoteHits) {
      want = 'hot';
    } else {
      want = 'cold';
    }

    if (tier === 'cold' && entry.hits >= config.coldPromoteHits && !entry.pinned) {
      want = 'hot';
      entry.pinned = true;
      entry.pinnedAt = new Date().toISOString();
      report.toHot.push(day);
      if (!dryRun) await setPinned(paths, day, true);
    }

    if (want === 'hot' && tier === 'cold') {
      if (!report.toHot.includes(day)) report.toHot.push(day);
      if (!dryRun) await moveDay(paths, day, 'cold', 'hot');
    } else if (want === 'cold' && tier === 'hot') {
      report.toCold.push(day);
      if (!dryRun) await moveDay(paths, day, 'hot', 'cold');
    } else {
      report.keepHot.push({ day, tier });
    }
  }

  // 热档封顶
  if (config.hotMaxFiles > 0) {
    const hot = await listDays(paths, 'hot');
    const over = hot.length - config.hotMaxFiles;
    if (over > 0) {
      const candidates = hot
        .filter((day) => !(usage.days[day]?.pinned))
        .slice(0, over);
      for (const day of candidates) {
        report.toCold.push(day);
        if (!dryRun) await moveDay(paths, day, 'hot', 'cold');
      }
    }
  }

  // 冷档封顶：从最早的删
  let cold = await listDays(paths, 'cold');
  const overflow = cold.length - config.coldMaxFiles;
  if (overflow > 0) {
    // 钉住的不删，从最老的普通记忆开始删
    for (const day of cold) {
      if (report.deleted.length >= overflow) break;
      if (usage.days[day]?.pinned) continue;
      report.deleted.push(day);
      if (!dryRun) await deleteDay(paths, 'cold', day);
    }
    cold = await listDays(paths, 'cold');
  }

  const hot = await listDays(paths, 'hot');
  report.hotAfter = hot.length;
  report.coldAfter = cold.length;

  if (!dryRun) {
    await saveUsage(paths, usage);
    await rebuildIndex(paths, 'hot', hot);
    await rebuildIndex(paths, 'cold', cold);
  }

  return report;
}

/** 人看的报告 */
export function formatTend(report) {
  const lines = [];
  lines.push(`${report.dryRun ? '[预演，没动文件] ' : ''}归纳完成 ${report.day}`);
  lines.push(`热档 ${report.hotBefore} → ${report.hotAfter} 天 · 冷档 ${report.coldBefore} → ${report.coldAfter} 天`);
  if (report.toCold.length) lines.push(`沉到冷档：${report.toCold.join('、')}`);
  if (report.toHot.length) lines.push(`升回热档：${report.toHot.join('、')}`);
  if (report.unpinned.length) lines.push(`解钉：${report.unpinned.join('、')}`);
  if (report.deleted.length) lines.push(`冷档满了，删掉最早的：${report.deleted.join('、')}`);
  if (!report.toCold.length && !report.toHot.length && !report.deleted.length) lines.push('没有需要搬动的');
  return lines.join('\n');
}
