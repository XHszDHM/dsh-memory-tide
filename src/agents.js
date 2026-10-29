/**
 * agents.js — 往工作空间的 AGENTS.md 里维护一小段「记忆在哪、开局先读」的提示。
 *
 * 为什么要这么干：MEMORY.md / TODO.md 只是磁盘上的文件，模型不主动去读就什么都看不到。
 * 而 DSH 的 dsh-agent-instructions 会自动把 AGENTS.md 注入上下文（全局那份 + 工作目录那份），
 * 所以往 AGENTS.md 里放一段提示，是「让接手的模型知道去读」最省事、也最不侵入的办法。
 *
 * 规矩：
 *   · 只用注释标记框住自己那一段，块外一个字都不改。
 *   · 内容没变就不写盘，避免每次调用都碰这个文件。
 *   · 开关关掉时把这一段撤干净；如果整个文件只剩我们建的空壳，就把文件删掉还原。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const BEGIN = '<!-- dsh-memory-tide:begin -->';
export const END = '<!-- dsh-memory-tide:end -->';

const PLACEHOLDER = '# AGENTS.md';

export const HINT = [
  BEGIN,
  '记忆在这个工作空间的 `memory\\` 里：`MEMORY.md` 是长期要点，`TODO.md` 是待办，其余的按天写成日记。',
  '',
  '- 开局先 `memory_read` 一下 `MEMORY.md` 和最近两天的日记；没有就跳过，别硬造。',
  '- 要翻更早的事，用 `memory_search`（默认只搜热档，`scope: "all"` 连冷档一起）。',
  '- 写回去用 `memory_add`，待办直接改 `TODO.md`。日记小节标题一律带时间：`## 【14:30 干了什么】`。',
  '- 密钥、密码、令牌这类凭据，**永远不写进记忆**。',
  '- 冷热档归纳插件自己每天跑一次，不用你记着喊。',
  END
].join('\n');

/** 把标记段从文本里切掉，顺手收掉多出来的空行 */
function strip(text) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < 0 || end < start) return text;
  return (text.slice(0, start) + text.slice(end + END.length)).replace(/\n{3,}/g, '\n\n');
}

/**
 * 纯函数：给定现有内容，算出应该写成什么。
 * 返回 null 表示「这个文件不该存在」（内容只剩空壳，删掉还原）。
 */
export function applyHint(text, enabled) {
  const src = typeof text === 'string' ? text : '';
  const hasBlock = src.includes(BEGIN) && src.includes(END);

  if (!enabled) {
    if (!hasBlock) return src.trim() ? src : null;
    const left = strip(src).trim();
    if (!left || left === PLACEHOLDER) return null;
    return left + '\n';
  }

  if (hasBlock) {
    const start = src.indexOf(BEGIN);
    const end = src.indexOf(END) + END.length;
    return src.slice(0, start) + HINT + src.slice(end);
  }

  const base = src.trim();
  if (!base) return PLACEHOLDER + '\n\n' + HINT + '\n';
  return base + '\n\n' + HINT + '\n';
}

/**
 * 把工作空间的 AGENTS.md 同步到目标状态。
 * 返回 { file, changed, removed }。
 */
export async function syncAgentsHint(root, enabled) {
  const file = path.join(root, 'AGENTS.md');
  let current;
  try {
    current = await fs.readFile(file, 'utf8');
  } catch {
    current = null;
  }

  const next = applyHint(current, enabled);
  if (next === null) {
    if (current === null) return { file, changed: false, removed: false };
    await fs.rm(file, { force: true });
    return { file, changed: true, removed: true };
  }
  if (current === next) return { file, changed: false, removed: false };

  await fs.writeFile(file, next, 'utf8');
  return { file, changed: true, removed: false };
}
