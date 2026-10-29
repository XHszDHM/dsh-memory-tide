/**
 * config.js — 默认配置 + 读写 <memory>/.tide.json。
 *
 * 全部可调。第一次用到时如果文件不存在，会按默认值写一份出来，
 * 让人一眼能看到有哪些旋钮。
 */

import fs from 'node:fs/promises';
import { memoryPaths } from './paths.js';

export const DEFAULTS = Object.freeze({
  /** 近 N 天的记忆一定留在热档，不动 */
  hotKeepDays: 7,
  /** 过了 hotKeepDays 的记忆，被查过 >= 这么多次 → 钉在热档 */
  promoteHits: 3,
  /** 冷档里的记忆被查过 >= 这么多次 → 升回热档 */
  coldPromoteHits: 5,
  /** 钉住的记忆连续这么多天没被查 → 解钉，按普通规则降温 */
  pinMaxDays: 90,
  /** 冷档最多留多少个文件，超了按日期从早到晚删 */
  coldMaxFiles: 120,
  /** 热档最多留多少个文件，0 = 不限 */
  hotMaxFiles: 0,
  /** 写日记时，一份文件超过这么多个小节，提示该拆分/沉淀 */
  sectionWarn: 30,
  /** search 默认返回几处命中 */
  searchLimit: 8,
  /** search 命中一处时，前后各带几行上下文 */
  searchContext: 3,
  /** 插件自带的每日归纳开关：true = 每天自动跑一次 tend，false = 只认手动调用 */
  autoTend: true
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 只合并已知的键，类型不对就退回默认值 —— 让人手改坏一个字段不至于炸 */
export function mergeConfig(raw) {
  const out = { ...DEFAULTS };
  if (!isPlainObject(raw)) return out;
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = raw[key];
    if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = Math.floor(value);
    } else if (typeof fallback === 'string') {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

async function readJson(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(getDirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getDirname(file) {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return index === -1 ? '.' : file.slice(0, index);
}

/** 读配置；文件不存在就写一份默认的出来 */
export async function loadConfig(paths, { createIfMissing = true } = {}) {
  const raw = await readJson(paths.configFile);
  if (raw === null && createIfMissing) {
    await writeJson(paths.configFile, DEFAULTS);
    return { ...DEFAULTS };
  }
  return mergeConfig(raw);
}

export async function saveConfig(paths, patch) {
  const current = await readJson(paths.configFile);
  const merged = mergeConfig({ ...(current ?? {}), ...patch });
  await writeJson(paths.configFile, merged);
  return merged;
}

/** 给工具层用的便捷入口：拿 root 换 { paths, config } */
export async function loadFor(root, { createIfMissing = true } = {}) {
  const paths = memoryPaths(root);
  const config = await loadConfig(paths, { createIfMissing });
  return { paths, config };
}
