/**
 * index-gen.js — 从每一天的小节标题生成索引。
 *
 * 热档索引要**短**：它每次都在上下文里。所以每行只给日期、距今、被查次数、
 * 小节数，下面最多列 `INLINE_SECTIONS` 个小节名，剩下的折成「还有 N 节」。
 * 冷档索引不常读，可以列全。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { sectionsOf, readDay, loadUsage, ageOf, tierIndex } from './store.js';

const INLINE_SECTIONS = 5;

function ageLabel(age) {
  if (age === 0) return '今天';
  if (age === 1) return '昨天';
  if (age < 7) return `${age} 天前`;
  if (age < 30) return `${Math.floor(age / 7)} 周前`;
  return `${Math.floor(age / 30)} 个月前`;
}

function fmtDate(day) {
  return day;
}

async function renderTier(paths, tier, days, usage) {
  const title = tier === 'hot' ? '热档索引' : '冷档索引';
  const root = tier === 'hot' ? paths.hotDir : paths.coldDir;
  const lines = [];
  const totalSections = [];

  for (const day of days) {
    const text = await readDay(paths, tier, day);
    const sections = sectionsOf(text).map((item) => item.title);
    totalSections.push(sections.length);
    const entry = usage.days[day] ?? { hits: 0, pinned: false, lastHit: null };
    const age = ageOf(day);
    const marks = [];
    marks.push(`查 ${entry.hits} 次`);
    marks.push(`${sections.length} 节`);
    if (entry.pinned) marks.push('**钉住**');
    lines.push(`- **${fmtDate(day)}**（${ageLabel(age)}）· ${marks.join(' · ')}`);
    const shown = tier === 'hot' ? sections.slice(0, INLINE_SECTIONS) : sections;
    for (const title2 of shown) lines.push(`  - ${title2}`);
    if (tier === 'hot' && sections.length > INLINE_SECTIONS) {
      lines.push(`  - …还有 ${sections.length - INLINE_SECTIONS} 节`);
    }
  }

  const head = [
    `# ${title}`,
    '',
    `共 ${days.length} 天 / ${totalSections.reduce((sum, n) => sum + n, 0)} 节 · 最后更新 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    tier === 'hot'
      ? '每次必读。要翻更早的，去看 `../cold/INDEX.md`。'
      : '用到才读。翻到命中后，用 `memory_read` 把那一天整份读出来。',
    ''
  ];

  return `${[...head, ...lines].join('\n').replace(/\s*$/, '')}\n`;
}

/** 重建某一档的索引，返回 { file, days, sections } */
export async function rebuildIndex(paths, tier, days) {
  const usage = await loadUsage(paths);
  const text = await renderTier(paths, tier, days, usage);
  const file = tierIndex(paths, tier);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
  const count = days.reduce((sum, day) => sum + 1, 0);
  return { file, days: count, bytes: Buffer.byteLength(text, 'utf8') };
}
