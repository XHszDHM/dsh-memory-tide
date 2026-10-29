import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BEGIN, END, HINT, applyHint, syncAgentsHint } from '../src/agents.js';

test('空工作空间：建出带标题的 AGENTS.md', () => {
  const out = applyHint(null, true);
  assert.ok(out.startsWith('# AGENTS.md'));
  assert.ok(out.includes(BEGIN) && out.includes(END));
});

test('已有 AGENTS.md：只追加，不动原文', () => {
  const src = '# AGENTS.md\n\n这是项目说明。\n';
  const out = applyHint(src, true);
  assert.ok(out.startsWith('# AGENTS.md\n\n这是项目说明.'.slice(0, 10)));
  assert.ok(out.includes('这是项目说明。'));
  assert.ok(out.includes(BEGIN));
  assert.ok(out.indexOf('这是项目说明。') < out.indexOf(BEGIN));
});

test('幂等：同一份内容跑两遍不变', () => {
  const once = applyHint('# AGENTS.md\n\n原有内容\n', true);
  const twice = applyHint(once, true);
  assert.equal(twice, once);
});

test('换掉块内容而不是叠加第二份', () => {
  const once = applyHint('# AGENTS.md\n', true);
  const broken = once.replace(HINT, BEGIN + '\n旧的说法\n' + END);
  const fixed = applyHint(broken, true);
  assert.equal((fixed.match(new RegExp(BEGIN, 'g')) ?? []).length, 1);
  assert.equal((fixed.match(new RegExp(END, 'g')) ?? []).length, 1);
  assert.ok(fixed.includes(HINT));
});

test('关掉开关：撤掉块，原文原样留着', () => {
  const src = '# AGENTS.md\n\n这是项目说明。\n';
  const on = applyHint(src, true);
  const off = applyHint(on, false);
  assert.equal(off, src);
});

test('关掉开关：只剩我们建的空壳就把文件删掉（返回 null）', () => {
  const on = applyHint(null, true);
  assert.equal(applyHint(on, false), null);
});

test('本来就没有块、开关也关着：一个字不动', () => {
  assert.equal(applyHint('# AGENTS.md\n\n别人的东西\n', false), '# AGENTS.md\n\n别人的东西\n');
  assert.equal(applyHint(null, false), null);
  assert.equal(applyHint('', false), null);
});

test('syncAgentsHint 真的读写文件，并且重复调用不重复写', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-agents-'));
  try {
    const first = await syncAgentsHint(root, true);
    assert.equal(first.changed, true);
    const text = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
    assert.ok(text.includes(BEGIN));

    const second = await syncAgentsHint(root, true);
    assert.equal(second.changed, false);

    const off = await syncAgentsHint(root, false);
    assert.equal(off.changed, true);
    assert.equal(off.removed, true);
    await assert.rejects(fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('syncAgentsHint 碰到已有文件时保留块外的内容', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-agents2-'));
  const file = path.join(root, 'AGENTS.md');
  try {
    await fs.writeFile(file, '# AGENTS.md\n\n项目自己的规矩\n', 'utf8');
    await syncAgentsHint(root, true);
    let text = await fs.readFile(file, 'utf8');
    assert.ok(text.includes('项目自己的规矩'));
    assert.ok(text.includes(BEGIN));

    await syncAgentsHint(root, false);
    text = await fs.readFile(file, 'utf8');
    assert.equal(text, '# AGENTS.md\n\n项目自己的规矩\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
