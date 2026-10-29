/**
 * 注册契约烟测：这个插件只用宿主公开的 `ctx.tools.register()`，
 * 所以不必真的起一个 DSH —— 拿一个假的 ctx 就能验完。
 *
 * 守的是三件以前坏过的事：
 *  1. 模块能在**没有任何 @deepseek-ai 包**的环境里加载（不 import 宿主内部包）
 *  2. 每个工具都带 output { schema, render }，否则 register 会抛错
 *  3. parameters 是合法 JSON Schema（object + properties），不是 schemastery 简写
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const plugin = await import('../src/index.js');

function fakeCtx() {
  const tools = [];
  return {
    tools,
    ctx: {
      tools: { register: (definition) => { tools.push(definition); return () => {}; } },
      get: () => undefined,
      logger: { info() {}, warn() {}, debug() {} }
    }
  };
}

test('模块导出 apply / inject / name', () => {
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.name, 'dsh-memory-tide');
  assert.deepEqual(plugin.inject, ['tools']);
});

test('apply 注册七个工具，每个都带 output 和 JSON Schema 参数', async () => {
  const { tools, ctx } = fakeCtx();
  const dispose = await plugin.apply(ctx);

  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'memory_add', 'memory_index', 'memory_lint',
    'memory_read', 'memory_search', 'memory_stats', 'memory_tend'
  ]);

  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string', `${tool.name} 缺 description`);
    assert.equal(typeof tool.execute, 'function', `${tool.name} 缺 execute`);

    assert.ok(tool.output, `${tool.name} 缺 output`);
    assert.equal(typeof tool.output.render, 'function', `${tool.name} 的 output.render 不是函数`);
    assert.ok(tool.output.schema, `${tool.name} 的 output 缺 schema`);
    const rendered = tool.output.render({}, 'hello');
    assert.deepEqual(rendered, [{ type: 'text', text: 'hello' }], `${tool.name} 的 render 形状不对`);

    assert.equal(tool.parameters.type, 'object', `${tool.name} 的 parameters 不是 JSON Schema object`);
    assert.equal(typeof tool.parameters.properties, 'object');
  }

  assert.equal(typeof dispose, 'function');
});

test('required 从字段简写抬到 JSON Schema 的 required 数组', async () => {
  const { tools, ctx } = fakeCtx();
  await plugin.apply(ctx);
  const search = tools.find((tool) => tool.name === 'memory_search');
  assert.deepEqual(search.parameters.required, ['query']);
  assert.equal(search.parameters.properties.query.type, 'string');
  assert.equal(search.parameters.properties.query.required, undefined, 'required 不该留在字段里');
  assert.deepEqual(search.parameters.properties.scope.enum, ['hot', 'cold', 'all', 'memory', 'todo', 'day']);
});

test('缺必填参数时给一句能读懂的报错', async () => {
  const { tools, ctx } = fakeCtx();
  await plugin.apply(ctx);
  const add = tools.find((tool) => tool.name === 'memory_add');
  await assert.rejects(() => add.execute({}, {}), /缺少必填参数 body/);
});
