# 更新日志

## 0.1.2 — 2026-10-29

设置页。装完之后在「设置 → 潮汐记忆」里就能改参数，不用再手改 `.tide.json`。

**每个工作空间单独一份**
- 设置页顶部是一个工作空间下拉，选中哪一个就编辑哪一个的 `memory/.tide.json`。记忆本来就跟着工作空间走，参数也该跟着走。
- 下拉里的候选来自「用过记忆的工作空间」（插件自己记在 `$DSH_HOME/integrations/dsh-memory-tide/workspaces.json`）+ 当前默认工作空间；也可以直接粘一个绝对路径读。
- 九个旋钮都能改：热档保留天数、钉住门槛、冷档升回门槛、钉住有效期、冷档/热档文件上限、日记小节告警线、搜索条数、搜索上下文行数。另有「恢复默认」。

**只加了一条 HTTP 路由，没加依赖**
- 宿主端新开 `POST /api/dsh-memory-tide`（`src/server.js`），走宿主自带的 `connection.fetch.register()`；拿不到这个服务就安静跳过，插件本体照常工作。
- 浏览器端 `lib/client.js` 是一份手写的 `window.__ModuleLoader__` bundle，React 用宿主提供的，没有构建步骤、没有 esbuild、没有 `@deepseek-ai/*` 依赖。
- 设置页要重启 DSH 才会出现（client bundle 在启动时收集）。

## 0.1.1 — 2026-10-29

安装通用性修复。这一版起，插件在任何 DSH 上用任何方式装上都能跑。

**不再依赖宿主内部包**
- 去掉对 `@deepseek-ai/dsh-tools` 的 `import` 与 `peerDependencies`。旧版靠它的 `defineTool` 打包工具定义，而那条路只在插件以 link/junction 挂在 profile 外时才解析得到（宿主 `dsh-app-boot` 的 `routeLinked` 按 peer 路由）；换成普通目录装进 `profiles/<档名>/node_modules/` 就走 `routeScoped`，profile 依赖表里没有这个包 → 加载失败、插件整条 fiber 挂掉。
- 现在只对接宿主公开的 `ctx.tools.register()` 契约，参数简写转 JSON Schema 由插件自己做。

**工具定义补齐 `output`**
- `register()` 要求每个工具声明 `output: { schema, render }`，缺了会抛 `Cannot read properties of undefined (reading 'render')`。七个工具统一补上纯文本输出。

**默认根目录跟着会话走**
- 不再回落到 `process.cwd()`（宿主进程里那是 profile 目录）。顺序：显式 `root` 参数 → 会话当前工作目录 → 环境变量 → cwd。

**开箱就是能用的**
- 第一次用到时自动生成 `MEMORY.md` / `TODO.md` 骨架，已存在的文件不碰。
- 缺必填参数时给一句能读懂的报错，而不是 `undefined` 崩进 `execute`。

## 0.1.0 — 2026-10-29

第一个能用的版本。

**记忆分两层**
- `archive/hot/` 热档，`archive/cold/` 冷档，`MEMORY.md` 是永不沉档的长期要点
- 热档索引每次必读（短），冷档索引按需翻——上下文只花在该花的地方

**七个工具**
- `memory_search` 找东西，默认只翻热档，多关键词 AND
- `memory_read` 把某一天整份读出来
- `memory_add` 往某一天追加一段
- `memory_index` 重建热/冷两份索引
- `memory_lint` 体检（标题没带时间 / 重复小节 / 空小节 / 死指针 / 索引过期）
- `memory_tend` 冷热档归纳，支持 `dryRun`
- `memory_stats` 看现状

**升降规则**（全部可调，见 `memory/.tide.json`）
- 近 7 天一律留热档
- 更早的：被查满 3 次或还钉着就留，否则沉冷档
- 冷档里被查满 5 次升回热档并钉住
- 钉住 90 天没再被查就解钉
- 冷档最多 120 个，超了从最早的删
- 搬档是移动，内容不改

**其他**
- 第一次调用任意工具时自动建目录和默认配置
- `memory/` 下直接躺着 `YYYY-MM-DD.md` 的旧结构，跑一次 `memory_tend` 就搬进 `archive/hot/`
- 自带 `SKILL.md`，把内容贴进 `AGENTS.md` 或系统提示即可让 AI 会用
