/**
 * search.js — 在记忆系统里找东西。
 *
 * 范围（scope）：
 *   memory  只看 MEMORY.md
 *   todo    只看 TODO.md
 *   hot     热档日记 + MEMORY.md + TODO.md（默认，最常用）
 *   cold    只看冷档
 *   all     MEMORY.md + TODO.md + 热档 + 冷档（翻旧账）
 *   day     指定的某一天（配 day 参数）
 *
 * 多个关键词用空格分开，**全部命中**才算（AND）。
 * 每命中一处，就给那一天记一次「被查到」。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { listDays, touchHits } from './store.js';

const SCOPES = ['memory', 'todo', 'hot', 'cold', 'all', 'day'];

function parseTerms(query) {
  return String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

async function readMaybe(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** 在一段文字里找命中行，返回 [{ line, text }] */
function matchLines(text, terms) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const needles = terms.map((term) => term.toLowerCase());
  if (!needles.every((needle) => lower.includes(needle))) return [];
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const l = line.toLowerCase();
    if (needles.some((needle) => l.includes(needle))) hits.push({ line: index + 1, text: line });
  });
  return hits;
}

function renderBlock(label, hits, lines, context) {
  const out = [];
  const seen = new Set();
  for (const hit of hits) {
    const from = Math.max(1, hit.line - context);
    const to = Math.min(lines.length, hit.line + context);
    const key = `${from}-${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${label}:${hit.line}`);
    for (let n = from; n <= to; n += 1) {
      const pointer = n === hit.line ? '>' : ' ';
      out.push(`${pointer} ${String(n).padStart(5, ' ')} | ${lines[n - 1]}`);
    }
    out.push('');
  }
  return out;
}

/** 主角：搜 */
export async function searchTide(paths, { query, scope = 'hot', day, limit = 8, context = 3 } = {}) {
  const terms = parseTerms(query);
  if (!terms.length) throw new Error('query 不能为空');
  if (!SCOPES.includes(scope)) throw new Error(`scope 只能是 ${SCOPES.join(' / ')}`);

  const blocks = [];
  const touched = [];
  let count = 0;

  const scanFile = async (file, label, onHit) => {
    if (count >= limit) return;
    const text = await readMaybe(file);
    if (!text) return;
    const hits = matchLines(text, terms);
    if (!hits.length) return;
    const lines = text.split(/\r?\n/);
    const take = hits.slice(0, Math.max(1, limit - count));
    blocks.push(...renderBlock(label, take, lines, context));
    count += take.length;
    onHit?.(text, hits.length);
  };

  const scanDay = async (tier, dayName) => {
    if (count >= limit) return;
    const file = path.join(tier === 'hot' ? paths.hotDir : paths.coldDir, `${dayName}.md`);
    await scanFile(file, `${tier}/${dayName}.md`, () => {
      touched.push({ day: dayName, tier });
    });
  };

  if (scope === 'memory' || scope === 'hot' || scope === 'all') {
    await scanFile(paths.memoryFile, 'MEMORY.md');
  }
  if (scope === 'todo' || scope === 'hot' || scope === 'all') {
    await scanFile(paths.todoFile, 'TODO.md');
  }
  if (scope === 'day') {
    if (!day) throw new Error('scope=day 时必须给 day（YYYY-MM-DD）');
    for (const tier of ['hot', 'cold']) await scanDay(tier, day);
  }
  if (scope === 'hot' || scope === 'all') {
    const days = (await listDays(paths, 'hot')).slice().reverse();
    for (const dayName of days) {
      if (count >= limit) break;
      await scanDay('hot', dayName);
    }
  }
  if (scope === 'cold' || scope === 'all') {
    const days = (await listDays(paths, 'cold')).slice().reverse();
    for (const dayName of days) {
      if (count >= limit) break;
      await scanDay('cold', dayName);
    }
  }

  if (touched.length) await touchHits(paths, touched);

  const header = count
    ? `找到 ${count} 处（关键词：${terms.join(' + ')}，范围：${scope}）`
    : `没找到「${terms.join(' ')}」（范围：${scope}）`;
  const hint = scope === 'hot' && !count
    ? '\n热档里没有，可以换 scope=all 连冷档一起搜'
    : '';

  return {
    count,
    terms,
    scope,
    text: `${header}\n\n${blocks.join('\n').replace(/\s*$/, '')}${hint}`
  };
}
