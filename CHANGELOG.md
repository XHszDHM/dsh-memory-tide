# 更新日志

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
