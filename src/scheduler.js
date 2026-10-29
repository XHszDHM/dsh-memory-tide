/**
 * scheduler.js — 插件自带的每日归纳。
 *
 * 为什么要有它：`memory_tend` 只是一个工具，没人调热档就一直堆着。
 * 装插件的人不可能每天记得喊一句「跑一次 tend」，所以这里挂一个定时器，
 * 每个用过记忆的工作空间，一天自动归纳一次。
 *
 * 做法很朴素：
 *   · 每半小时醒一次（`TICK_MS`），醒了看今天跑过没有
 *   · 跑没跑过记在 `$DSH_HOME/integrations/dsh-memory-tide/tend-state.json`
 *   · 只归纳「已经有 memory 目录」的工作空间 —— 没记忆的地方不凭空造目录
 *   · 单个工作空间出错不影响别的，也不影响下次
 *
 * 定时器优先用宿主的 `ctx.setInterval`（插件卸载时会跟着清掉）；
 * 宿主没有就退回全局 `setInterval` + `unref()`，至少不会拖着进程不放。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadFor } from './config.js';
import { memoryPaths, isoDay } from './paths.js';
import { tendTide } from './tend.js';
import { readRegistry, dataDirectory } from './server.js';

/** 醒来看看的间隔：半小时。真正的「一天一次」由 tend-state.json 把关。 */
export const TICK_MS = 30 * 60 * 1000;

function stateFile() {
  return path.join(dataDirectory(), 'tend-state.json');
}

async function readState() {
  try {
    const parsed = JSON.parse((await fs.readFile(stateFile(), 'utf8')).replace(/^\uFEFF/, ''));
    const runs = parsed !== null && typeof parsed === 'object' && parsed.runs !== null
      && typeof parsed.runs === 'object' && !Array.isArray(parsed.runs) ? parsed.runs : {};
    return { version: 1, runs };
  } catch {
    return { version: 1, runs: {} };
  }
}

async function writeState(state) {
  await fs.mkdir(dataDirectory(), { recursive: true });
  await fs.writeFile(stateFile(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** 该归纳哪些工作空间：插件记过账的 + 当前默认的，去掉重复和没有记忆的 */
async function collectRoots(defaultRoot) {
  const registry = await readRegistry();
  const candidates = [];
  if (typeof defaultRoot === 'string' && defaultRoot.trim()) candidates.push(defaultRoot.trim());
  for (const item of registry.roots) candidates.push(item.root);

  const seen = new Set();
  const roots = [];
  for (const candidate of candidates) {
    const key = path.resolve(candidate).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const paths = memoryPaths(path.resolve(candidate));
    if (await isDirectory(paths.memoryDir)) roots.push(paths.root);
  }
  return roots;
}

/**
 * 立刻归纳一轮（给定时器用，测试里也能直接调）。
 * @returns 本轮真的跑过的工作空间：[{ root, day, moved }]
 */
export async function runOnce({ defaultRoot, force = false, now = new Date() } = {}) {
  const day = isoDay(now);
  const state = await readState();
  const roots = await collectRoots(defaultRoot);
  const done = [];

  for (const root of roots) {
    if (!force && state.runs[root] === day) continue;
    try {
      const { paths, config } = await loadFor(root, { createIfMissing: false });
      if (config.autoTend === false) {
        state.runs[root] = day;
        continue;
      }
      const report = await tendTide(paths, config);
      const moved = report.toCold.length + report.toHot.length + report.unpinned.length + report.deleted.length;
      state.runs[root] = day;
      done.push({ root, day, moved });
    } catch {
      // 这个工作空间出问题不该拖累下一个，也不该让定时器反复重试到卡死
      state.runs[root] = day;
    }
  }

  await writeState(state).catch(() => {});
  return done;
}

/** 注册定时器：优先宿主提供的 ctx.setInterval，没有就退回全局 */
function schedule(ctx, tick, intervalMs) {
  if (ctx !== null && typeof ctx?.setInterval === 'function') {
    try {
      const dispose = ctx.setInterval(tick, intervalMs);
      return typeof dispose === 'function' ? dispose : () => {};
    } catch {
      /* 落到全局 */
    }
  }
  const handle = setInterval(tick, intervalMs);
  if (typeof handle?.unref === 'function') handle.unref();
  return () => clearInterval(handle);
}

/**
 * 启动每日归纳。
 * @returns disposer，插件卸载时调用
 */
export function startDailyTend(ctx, { getDefaultRoot, intervalMs = TICK_MS } = {}) {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runOnce({ defaultRoot: getDefaultRoot?.() });
    } catch {
      /* 定时器不能因为一次异常就死掉 */
    } finally {
      running = false;
    }
  };

  const stopTimer = schedule(ctx, tick, intervalMs);

  // 起来先补一次：插件重启当天的归纳不该漏掉。
  // 放到下一个事件循环，别和插件加载抢时间。
  const kick = setTimeout(tick, 5000);
  if (typeof kick?.unref === 'function') kick.unref();

  return () => {
    stopped = true;
    try {
      clearTimeout(kick);
    } catch {
      /* 忽略 */
    }
    try {
      stopTimer?.();
    } catch {
      /* 忽略 */
    }
  };
}
