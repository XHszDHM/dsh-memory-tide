/**
 * store.js — 盘上那层：列日子、读写某一天、搬档、删档、记调用次数。
 *
 * 目录约定见 paths.js。所有函数都收 `paths`（memoryPaths() 的返回值），
 * 不自己解析工作空间，方便测试时塞临时目录。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DAY_FILE_RE, isoDay, daysBetween } from './paths.js';

const TIERS = ['hot', 'cold'];

export function tierDir(paths, tier) {
  if (!TIERS.includes(tier)) throw new Error(`未知的档位: ${tier}（只能是 hot 或 cold）`);
  return tier === 'hot' ? paths.hotDir : paths.coldDir;
}

export function tierIndex(paths, tier) {
  return tier === 'hot' ? paths.hotIndex : paths.coldIndex;
}

async function ensureDirs(paths) {
  await fs.mkdir(paths.hotDir, { recursive: true });
  await fs.mkdir(paths.coldDir, { recursive: true });
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function writeText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}

/* ---------------------------------------------------------------- 列档 */

/** 列出某一档里所有日期文件，按日期升序 */
export async function listDays(paths, tier) {
  await ensureDirs(paths);
  let names = [];
  try {
    names = await fs.readdir(tierDir(paths, tier));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const match = DAY_FILE_RE.exec(name);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .sort();
}

/** 这一天在哪个档；冷热都找不到返回 null */
export async function locateDay(paths, day) {
  for (const tier of TIERS) {
    const days = await listDays(paths, tier);
    if (days.includes(day)) return tier;
  }
  return null;
}

/** 所有档里的全部日期，升序，元素是 { day, tier } */
export async function listAll(paths) {
  const [hot, cold] = await Promise.all([listDays(paths, 'hot'), listDays(paths, 'cold')]);
  return [
    ...hot.map((day) => ({ day, tier: 'hot' })),
    ...cold.map((day) => ({ day, tier: 'cold' }))
  ].sort((a, b) => a.day.localeCompare(b.day));
}

/* ------------------------------------------------------------ 读/写某天 */

export async function readDay(paths, tier, day) {
  const text = await readText(path.join(tierDir(paths, tier), `${day}.md`));
  return text;
}

/** 读一天，不知道在哪一档就先找 */
export async function readDayAnywhere(paths, day) {
  const tier = await locateDay(paths, day);
  if (!tier) return { tier: null, text: null };
  return { tier, text: await readDay(paths, tier, day) };
}

export async function writeDay(paths, tier, day, text) {
  await ensureDirs(paths);
  await writeText(path.join(tierDir(paths, tier), `${day}.md`), text);
}

/** 往某一天追加一段；不存在就新建一份带日期小标题的 */
export async function appendToDay(paths, day, body, { section } = {}) {
  const tier = (await locateDay(paths, day)) ?? 'hot';
  const file = path.join(tierDir(paths, tier), `${day}.md`);
  let text = await readText(file);
  if (text === null) text = `# ${day}\n`;
  const chunk = section
    ? `\n## 【${section}】\n\n${body.trim()}\n`
    : `\n${body.trim()}\n`;
  await writeText(file, `${text.replace(/\s*$/, '')}\n${chunk}`);
  await touchHit(paths, day, { tier });
  return { tier, file };
}

/* ------------------------------------------------------------ 搬档/删档 */

export async function moveDay(paths, day, fromTier, toTier) {
  if (fromTier === toTier) return false;
  const source = path.join(tierDir(paths, fromTier), `${day}.md`);
  const target = path.join(tierDir(paths, toTier), `${day}.md`);
  const text = await readText(source);
  if (text === null) return false;
  await writeText(target, text);
  await fs.rm(source, { force: true });
  await setTier(paths, day, toTier);
  return true;
}

export async function deleteDay(paths, tier, day) {
  await fs.rm(path.join(tierDir(paths, tier), `${day}.md`), { force: true });
}

/* --------------------------------------------------------- 调用次数台账 */

const EMPTY_USAGE = { version: 1, days: {} };

export async function loadUsage(paths) {
  const text = await readText(paths.usageFile);
  if (text === null) return { ...EMPTY_USAGE, days: {} };
  try {
    const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!raw || typeof raw !== 'object') return { ...EMPTY_USAGE, days: {} };
    return { version: 1, days: raw.days && typeof raw.days === 'object' ? raw.days : {} };
  } catch {
    return { ...EMPTY_USAGE, days: {} };
  }
}

export async function saveUsage(paths, usage) {
  await writeText(paths.usageFile, `${JSON.stringify(usage, null, 2)}\n`);
}

function entryOf(usage, day) {
  if (!usage.days[day]) {
    usage.days[day] = { hits: 0, lastHit: null, tier: null, pinned: false, pinnedAt: null };
  }
  const entry = usage.days[day];
  entry.hits = Number.isFinite(entry.hits) ? entry.hits : 0;
  return entry;
}

/** 记一次「被查到」 */
export async function touchHit(paths, day, { tier, count = 1 } = {}) {
  const usage = await loadUsage(paths);
  const entry = entryOf(usage, day);
  entry.hits += count;
  entry.lastHit = new Date().toISOString();
  if (tier) entry.tier = tier;
  await saveUsage(paths, usage);
  return entry;
}

/** 批量记（search 一次命中多天时用） */
export async function touchHits(paths, days) {
  if (!days.length) return;
  const usage = await loadUsage(paths);
  const now = new Date().toISOString();
  for (const { day, tier } of days) {
    const entry = entryOf(usage, day);
    entry.hits += 1;
    entry.lastHit = now;
    if (tier) entry.tier = tier;
  }
  await saveUsage(paths, usage);
}

export async function setTier(paths, day, tier) {
  const usage = await loadUsage(paths);
  const entry = entryOf(usage, day);
  entry.tier = tier;
  await saveUsage(paths, usage);
}

export async function setPinned(paths, day, pinned) {
  const usage = await loadUsage(paths);
  const entry = entryOf(usage, day);
  entry.pinned = Boolean(pinned);
  entry.pinnedAt = pinned ? new Date().toISOString() : null;
  await saveUsage(paths, usage);
}

/* --------------------------------------------------- MEMORY.md / TODO.md */

export async function readMemory(paths) {
  return (await readText(paths.memoryFile)) ?? null;
}

export async function writeMemory(paths, text) {
  await writeText(paths.memoryFile, text);
}

export async function readTodo(paths) {
  return (await readText(paths.todoFile)) ?? null;
}

export async function writeTodo(paths, text) {
  await writeText(paths.todoFile, text);
}

/* ------------------------------------------------------------- 小工具 */

/** 一份记忆里的小节标题（## 开头的行） */
export function sectionsOf(text) {
  if (!text) return [];
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^##\s+/.test(line)) out.push({ title: line.replace(/^##\s+/, '').trim(), line: index + 1 });
  });
  return out;
}

/** 今天（本地） */
export function today() {
  return isoDay(new Date());
}

/** 某天距今几天 */
export function ageOf(day, now = today()) {
  return daysBetween(day, now);
}
