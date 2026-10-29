/**
 * lint.js — 体检。只看，不改。
 *
 * 会挑这些毛病：
 *   · 小节标题没带时间（`## 【14:30 干什么】` 这种格式）
 *   · 同一天里重复的小节标题
 *   · 空小节（标题下面一个字都没有）
 *   · 一天小节太多（超过 sectionWarn）
 *   · MEMORY.md 里的指针指向不存在的日子 / 对不上的小节名
 *   · 缺少 TODO.md 或两份索引没跟上
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  listDays, listAll, readDay, readMemory, readTodo, sectionsOf
} from './store.js';

const TIME_RE = /\d{1,2}:\d{2}/;
/** 认这些写法：`2026-10-28.md【晚上】`、`archive/hot/2026-10-28.md【晚上】` */
const PTR_RE = /(\d{4}-\d{2}-\d{2})\.md\s*【([^】]+)】/g;

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** 按 `## ` 切小节，返回 [{ title, line, lines: [] }] */
function splitSections(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  let current = null;
  lines.forEach((line, index) => {
    const match = /^##\s+(.*)$/.exec(line);
    if (match) {
      current = { title: match[1].trim(), line: index + 1, lines: [] };
      out.push(current);
      return;
    }
    if (current) current.lines.push(line);
  });
  return out;
}

export async function lintTide(paths, config) {
  const problems = {
    untimed: [],
    duplicated: [],
    empty: [],
    tooCrowded: [],
    deadPointers: [],
    missing: [],
    staleIndex: []
  };

  const all = await listAll(paths);
  const dayMap = new Map(all.map((item) => [item.day, item.tier]));

  for (const { day, tier } of all) {
    const text = await readDay(paths, tier, day);
    const sections = splitSections(text);

    const seen = new Set();
    for (const section of sections) {
      if (!TIME_RE.test(section.title)) {
        problems.untimed.push({ day, tier, line: section.line, title: section.title });
      }
      if (seen.has(section.title)) {
        problems.duplicated.push({ day, tier, title: section.title });
      }
      seen.add(section.title);
      if (!section.lines.join('').trim()) {
        problems.empty.push({ day, tier, line: section.line, title: section.title });
      }
    }

    if (sections.length > config.sectionWarn) {
      problems.tooCrowded.push({ day, tier, count: sections.length });
    }
  }

  // MEMORY.md 里的指针
  const memory = await readMemory(paths);
  if (memory === null) {
    problems.missing.push({ what: 'MEMORY.md', file: paths.memoryFile });
  } else {
    const dayCache = new Map();
    for (const match of memory.matchAll(PTR_RE)) {
      const [, day, wantSection] = match;
      if (!dayCache.has(day)) {
        const tier = dayMap.get(day);
        dayCache.set(day, tier ? splitSections(await readDay(paths, tier, day)).map((s) => s.title) : null);
      }
      const titles = dayCache.get(day);
      if (!titles) {
        problems.deadPointers.push({ day, section: wantSection, why: '那一天不存在' });
        continue;
      }
      const hit = titles.some((title) => title.includes(wantSection));
      if (!hit) {
        problems.deadPointers.push({ day, section: wantSection, why: '那一天里没有这个名字的小节' });
      }
    }
  }

  if ((await readTodo(paths)) === null) {
    problems.missing.push({ what: 'TODO.md', file: paths.todoFile });
  }

  // 索引有没有跟上
  for (const tier of ['hot', 'cold']) {
    const index = tier === 'hot' ? paths.hotIndex : paths.coldIndex;
    const days = await listDays(paths, tier);
    if (!(await exists(index))) {
      if (days.length) problems.staleIndex.push({ tier, why: '索引文件不存在' });
      continue;
    }
    const stat = await fs.stat(index);
    for (const day of days) {
      const file = path.join(tier === 'hot' ? paths.hotDir : paths.coldDir, `${day}.md`);
      const dayStat = await fs.stat(file);
      if (dayStat.mtimeMs > stat.mtimeMs) {
        problems.staleIndex.push({ tier, why: `${day} 比索引新` });
        break;
      }
    }
  }

  const total = Object.values(problems).reduce((sum, list) => sum + list.length, 0);
  return { ok: total === 0, problems, total };
}

export function formatLint(report) {
  const { problems, total } = report;
  if (total === 0) return '体检通过，没发现问题';
  const lines = [`共 ${total} 处问题：`];

  if (problems.missing.length) {
    lines.push('', '【缺文件】');
    for (const item of problems.missing) lines.push(`  · ${item.what} 不存在（${item.file}）`);
  }
  if (problems.deadPointers.length) {
    lines.push('', '【死指针】');
    for (const item of problems.deadPointers) {
      lines.push(`  · ${item.day}【${item.section}】—— ${item.why}`);
    }
  }
  if (problems.untimed.length) {
    lines.push('', `【标题没带时间】${problems.untimed.length} 处，写成 \`## 【14:30 干什么】\` 这种`);
    for (const item of problems.untimed.slice(0, 10)) {
      lines.push(`  · ${item.tier}/${item.day}.md:${item.line}  ${item.title}`);
    }
    if (problems.untimed.length > 10) lines.push(`  · …还有 ${problems.untimed.length - 10} 处`);
  }
  if (problems.duplicated.length) {
    lines.push('', '【同一天里重复的小节】');
    for (const item of problems.duplicated) lines.push(`  · ${item.tier}/${item.day}.md  ${item.title}`);
  }
  if (problems.empty.length) {
    lines.push('', '【空小节】');
    for (const item of problems.empty.slice(0, 10)) {
      lines.push(`  · ${item.tier}/${item.day}.md:${item.line}  ${item.title}`);
    }
  }
  if (problems.tooCrowded.length) {
    lines.push('', '【一天小节太多】');
    for (const item of problems.tooCrowded) lines.push(`  · ${item.tier}/${item.day}.md  ${item.count} 节`);
  }
  if (problems.staleIndex.length) {
    lines.push('', '【索引过期】');
    for (const item of problems.staleIndex) lines.push(`  · ${item.tier}：${item.why} —— 跑一次 memory_index`);
  }
  return lines.join('\n');
}
