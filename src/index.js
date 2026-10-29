/**
 * index.js — 潮汐记忆（dsh-memory-tide）的插件入口。
 *
 * 注册六个工具：
 *   memory_search  找东西（默认只翻热档）
 *   memory_read    把某一天整份读出来
 *   memory_add     往某一天追加一段
 *   memory_index   重建热/冷两层的索引
 *   memory_lint    体检（只看不改）
 *   memory_tend    冷热档归纳（每天跑一次）
 *
 * 契约定点：
 *  - `apply` 返回 disposer
 *  - 参数 schema 只能用 string / number / integer / boolean / null / array / object / json / oneOf，
 *    **不支持** minimum / maximum / pattern / maxItems 这类注解，取值范围写在 description 里
 */

import { resolveRoot, memoryPaths } from './paths.js';
import { loadFor } from './config.js';
import {
  listDays, listAll, readDayAnywhere, appendToDay, today, locateDay
} from './store.js';
import { searchTide } from './search.js';
import { rebuildIndex } from './index-gen.js';
import { lintTide, formatLint } from './lint.js';
import { tendTide, formatTend } from './tend.js';

export const name = 'dsh-memory-tide';
export const inject = ['tools'];

async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    if (mod?.defineTool) return mod.defineTool;
  } catch {
    /* 落到环境变量 */
  }
  const override = process.env.DSH_TOOLS_PATH;
  if (override) {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(override).href);
    if (mod?.defineTool) return mod.defineTool;
  }
  throw new Error('cannot resolve @deepseek-ai/dsh-tools (set DSH_TOOLS_PATH for local dev)');
}

const ROOT_PARAM = {
  type: 'string',
  description: '记忆所在的根目录。留空就用当前工作空间。'
};

export async function apply(ctx) {
  const defineTool = await loadDefineTool();

  const setup = async (root) => {
    const paths = memoryPaths(resolveRoot(root));
    const { config } = await loadFor(paths.root, { createIfMissing: true });
    return { paths, config };
  };

  const search = defineTool({
    name: 'memory_search',
    description: [
      '在潮汐记忆里找东西。默认只翻**热档**（近 7 天 + 被查得多被钉住的那些天），也搜 MEMORY.md 和 TODO.md。',
      '',
      '多关键词用空格分开，全部命中才算（AND）。每命中一处，就给那一天记一次「被查到」——',
      '被查得多的天会留在热档，冷清的会慢慢沉到冷档。',
      '',
      'scope 怎么选：',
      '- `hot`（默认）日常翻，够快',
      '- `all` 热档没有、要翻旧账时用',
      '- `cold` 只想看沉下去的老日子',
      '- `memory` / `todo` 只搜那一个文件',
      '- `day` 加 day 参数精读某一天'
    ].join('\n'),
    parameters: {
      query: { type: 'string', required: true, description: '关键词，空格分开表示全部要命中' },
      scope: {
        type: 'string',
        enum: ['hot', 'cold', 'all', 'memory', 'todo', 'day'],
        description: '搜索范围，默认 hot'
      },
      day: { type: 'string', description: 'scope=day 时必填，格式 YYYY-MM-DD' },
      limit: { type: 'integer', description: '最多返回多少处命中，默认 8' },
      context: { type: 'integer', description: '每处命中带几行上下文，默认 3' },
      root: ROOT_PARAM
    },
    async execute(args) {
      const { paths, config } = await setup(args.root);
      const result = await searchTide(paths, {
        query: args.query,
        scope: args.scope ?? 'hot',
        day: args.day,
        limit: args.limit ?? config.searchLimit,
        context: args.context ?? config.searchContext
      });
      return result.text;
    }
  });

  const read = defineTool({
    name: 'memory_read',
    description: [
      '把某一天的记忆整份读出来。不传 day 就读今天。',
      '热档冷档都会去找。返回里带一个头部说明这一天在哪一档。'
    ].join('\n'),
    parameters: {
      day: { type: 'string', description: 'YYYY-MM-DD，留空是今天' },
      root: ROOT_PARAM
    },
    async execute(args) {
      const { paths } = await setup(args.root);
      const day = args.day ?? today();
      const { tier, text } = await readDayAnywhere(paths, day);
      if (text === null) return `${day} 这一天还没有记忆`;
      return `# ${day}（${tier === 'hot' ? '热档' : '冷档'}）\n\n${text}`;
    }
  });

  const add = defineTool({
    name: 'memory_add',
    description: [
      '往某一天追加一段。不传 day 就写今天、不传 tier 默认写热档。',
      '给了 section 会新起一个 `## 【section】` 小节；不给就接在文件末尾。',
      '',
      '写日记这种天天做的事用它。写长期要点请直接改 MEMORY.md（那是热档的核心，不进冷热流转）。'
    ].join('\n'),
    parameters: {
      body: { type: 'string', required: true, description: '要写进去的内容' },
      section: { type: 'string', description: '小节标题，形如「14:30 干了什么」' },
      day: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
      root: ROOT_PARAM
    },
    async execute(args) {
      const { paths } = await setup(args.root);
      const day = args.day ?? today();
      const result = await appendToDay(paths, day, args.body, { section: args.section });
      const tier = (await locateDay(paths, day)) ?? result.tier;
      await rebuildIndex(paths, 'hot', await listDays(paths, 'hot'));
      return `已写进 ${day}.md（${tier === 'hot' ? '热档' : '冷档'}）`;
    }
  });

  const indexTool = defineTool({
    name: 'memory_index',
    description: [
      '重建索引。热档索引（每次必读、要短）和冷档索引（翻旧账才读）分开生成。',
      '写完日记、搬过档之后跑一次。'
    ].join('\n'),
    parameters: {
      tier: { type: 'string', enum: ['hot', 'cold', 'both'], description: '默认 both' },
      root: ROOT_PARAM
    },
    async execute(args) {
      const { paths } = await setup(args.root);
      const which = args.tier ?? 'both';
      const out = [];
      const tiers = which === 'both' ? ['hot', 'cold'] : [which];
      for (const tier of tiers) {
        const days = await listDays(paths, tier);
        const info = await rebuildIndex(paths, tier, days);
        out.push(`${tier === 'hot' ? '热档' : '冷档'}索引：${info.days} 天 → ${info.file}`);
      }
      return out.join('\n');
    }
  });

  const lintTool = defineTool({
    name: 'memory_lint',
    description: [
      '体检，只看不改。挑这些毛病：',
      '小节标题没带时间的 / 同一天里重复的小节 / 空小节 / 一天小节太多 /',
      'MEMORY.md 里指向不存在日子或对不上小节名的死指针 / 缺 TODO.md / 索引没跟上。'
    ].join('\n'),
    parameters: {
      root: ROOT_PARAM
    },
    async execute(args) {
      const { paths, config } = await setup(args.root);
      const report = await lintTide(paths, config);
      return formatLint(report);
    }
  });

  const tend = defineTool({
    name: 'memory_tend',
    description: [
      '冷热档归纳，每天跑一次就行。规则：',
      '- 近 hotKeepDays 天一律留在热档',
      '- 更早的，被查过 >= promoteHits 次或还钉着 → 留热档；否则沉冷档',
      '- 冷档里被查过 >= coldPromoteHits 次 → 升回热档并钉住',
      '- 钉住超过 pinMaxDays 天没再被查 → 解钉',
      '- 冷档超过 coldMaxFiles 个 → 按日期从早到晚删',
      '',
      '搬动是移动不是删除，内容一个字不改。dryRun=true 只出报告不动文件。'
    ].join('\n'),
    parameters: {
      dryRun: { type: 'boolean', description: '只出报告，不动文件' },
      root: ROOT_PARAM
    },
    async execute(args) {
      const { paths, config } = await setup(args.root);
      const report = await tendTide(paths, config, { dryRun: args.dryRun === true });
      return formatTend(report);
    }
  });

  const stats = defineTool({
    name: 'memory_stats',
    description: '看一眼记忆系统现在的样子：热档几天、冷档几天、各被查过几次、配置文件在哪。',
    parameters: {
      root: ROOT_PARAM
    },
    async execute(args) {
      const { paths, config } = await setup(args.root);
      const all = await listAll(paths);
      const hot = all.filter((item) => item.tier === 'hot');
      const cold = all.filter((item) => item.tier === 'cold');
      const lines = [
        `根目录：${paths.root}`,
        `热档 ${hot.length} 天 · 冷档 ${cold.length} 天`,
        `配置：${paths.configFile}`,
        `用量：${paths.usageFile}`,
        '',
        `热档：${hot.map((item) => item.day).join('、') || '（空）'}`,
        `冷档：${cold.map((item) => item.day).join('、') || '（空）'}`,
        '',
        `规则：近 ${config.hotKeepDays} 天必热 · 查满 ${config.promoteHits} 次钉住 · 冷档查满 ${config.coldPromoteHits} 次升回 · 钉满 ${config.pinMaxDays} 天没查就解钉 · 冷档最多 ${config.coldMaxFiles} 个`
      ];
      return lines.join('\n');
    }
  });

  const registered = [search, read, add, indexTool, lintTool, tend, stats]
    .map((tool) => ctx.tools.register(tool));
  return () => {
    for (const dispose of registered) {
      try {
        dispose?.();
      } catch {
        /* 忽略 */
      }
    }
  };
}
