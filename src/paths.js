/**
 * paths.js — 把「工作空间根目录」解析出来，再派生出记忆系统的所有路径。
 *
 * 解析顺序（先命中先用）：
 *   1. 工具参数里传的 workspace
 *   2. 环境变量 DSH_WORKSPACE / DSH_CWD / CLAUDE_PROJECT_DIR
 *   3. process.cwd()
 *
 * 记忆系统固定住在 <root>/memory 下：
 *
 *   memory/
 *     MEMORY.md            总目录（热档要点 + 冷档路标）
 *     TODO.md              待办
 *     archive/
 *       hot/
 *         INDEX.md         热档索引（每次必读）
 *         YYYY-MM-DD.md
 *       cold/
 *         INDEX.md         冷档索引（翻旧账才读）
 *         YYYY-MM-DD.md
 *     .tide.json           本文件：配置
 *     .usage.json          本文件：每份记忆被查了几次
 */

import path from 'node:path';

export const MEMORY_DIRNAME = 'memory';
export const ARCHIVE_DIRNAME = 'archive';
export const HOT_DIRNAME = 'hot';
export const COLD_DIRNAME = 'cold';
export const INDEX_FILENAME = 'INDEX.md';
export const MEMORY_FILENAME = 'MEMORY.md';
export const TODO_FILENAME = 'TODO.md';
export const CONFIG_FILENAME = '.tide.json';
export const USAGE_FILENAME = '.usage.json';

/** 从参数/环境/cwd 里找出工作空间根 */
export function resolveRoot(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return path.resolve(explicit.trim());
  for (const key of ['DSH_WORKSPACE', 'DSH_CWD', 'CLAUDE_PROJECT_DIR', 'INIT_CWD']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return path.resolve(value.trim());
  }
  return process.cwd();
}

/** 一个工作空间下，记忆系统的全部落点 */
export function memoryPaths(root) {
  const memoryDir = path.join(root, MEMORY_DIRNAME);
  const archiveDir = path.join(memoryDir, ARCHIVE_DIRNAME);
  const hotDir = path.join(archiveDir, HOT_DIRNAME);
  const coldDir = path.join(archiveDir, COLD_DIRNAME);
  return {
    root,
    memoryDir,
    memoryFile: path.join(memoryDir, MEMORY_FILENAME),
    todoFile: path.join(memoryDir, TODO_FILENAME),
    archiveDir,
    hotDir,
    hotIndex: path.join(hotDir, INDEX_FILENAME),
    coldDir,
    coldIndex: path.join(coldDir, INDEX_FILENAME),
    configFile: path.join(memoryDir, CONFIG_FILENAME),
    usageFile: path.join(memoryDir, USAGE_FILENAME),
  };
}

/** YYYY-MM-DD */
export function isoDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' -> Date（本地零点） */
export function dayToDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 两个 YYYY-MM-DD 之间隔了几天 */
export function daysBetween(fromDay, toDay) {
  const a = dayToDate(fromDay).getTime();
  const b = dayToDate(toDay).getTime();
  return Math.round((b - a) / 86400000);
}

export const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
