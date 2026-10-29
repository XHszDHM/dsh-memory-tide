# 潮汐记忆 · dsh-memory-tide

> 给 DeepSeek Harness 用的记忆插件：**近的记忆常驻、远的沉下去、用得多的自己浮上来。**

上下文是稀缺资源。日记一天一天写下去，早晚会把上下文撑爆——可真正被反复用到的，永远是最近那几天，加上少数几件旧事。

潮汐记忆做的就是这件事：把记忆分成**热档**和**冷档**两层，每天归纳一次，自动升降。

```
       新的一天 → 热档（每次都读）
                    │ 7 天以后，没人查
                    ▼
                  冷档（用到才翻）
                    │ 被查得多了
                    └──────────→ 升回热档，钉住
```

---

## 它长什么样

```
memory/
├── MEMORY.md             长期要点（永不沉档，人的脾气、规矩、坑都在这）
├── TODO.md               待办
├── archive/
│   ├── hot/
│   │   ├── INDEX.md      热档索引 —— 短，每次必读
│   │   └── 2026-10-29.md
│   └── cold/
│       ├── INDEX.md      冷档索引 —— 翻旧账时才读
│       └── 2026-09-30.md
├── .tide.json            配置（全部可调）
└── .usage.json           每份记忆被查了几次
```

**索引也是分开的**，这一点是重点：热档索引每次都在上下文里，所以它必须短；冷档索引你不翻就永远不读。`MEMORY.md` 里只写一句「冷档在 `archive\cold\`」，不给日期、不给目录。

---

## 升降规则

| 情况 | 结果 |
| --- | --- |
| 距今 ≤ `hotKeepDays`（默认 7）天 | 一定留在热档 |
| 更早，但被查过 ≥ `promoteHits`（默认 3）次 | 留在热档，并钉住 |
| 更早，也没人查 | 沉到冷档 |
| 冷档里被查过 ≥ `coldPromoteHits`（默认 5）次 | 升回热档，钉住 |
| 钉住之后 `pinMaxDays`（默认 90）天没再被查 | 解钉，重新参与流转 |
| 冷档超过 `coldMaxFiles`（默认 120）个 | 按日期从早到晚删 |
| 热档超过 `hotMaxFiles`（默认 0 = 不限） | 最老的沉到冷档（钉住的不动） |

「被查」按**天**算，不按条算——一天里被搜到五次，只记一次。这样热闹的那几天自己会浮起来。

**搬档是移动，不是删除。** 内容一个字不改，只是换个目录。

---

## 装

```bash
# 从 npm（上架后）
dsh plugin --profile desktop add dsh-memory-tide

# 从 GitHub
dsh plugin --profile desktop add github:XHszDHM/dsh-memory-tide

# 本地开发
dsh plugin --profile desktop add link:D:/path/to/dsh-memory-tide
```

桌面版没有 `dsh` CLI 的话，手改 `profiles/<档名>/package.json` 的 `dependencies`，把插件目录放进 `profiles/<档名>/node_modules/` 也一样。

装完**重启 DSH**。

插件本身**不依赖任何 `@deepseek-ai/*` 包**——只用到宿主的 `ctx.tools.register()` 公开契约，参数 schema 是插件自己转出来的 JSON Schema。所以不管你是 `link:` 挂开发目录、还是 `npm`/`github:` 装进 `profiles/<档名>/node_modules/`，跑起来是同一份代码，不会因为宿主内部包解析不到而加载失败。

第一次在某个工作空间调用任意工具时，会在 `<工作空间>/memory/` 下自动铺好目录、默认配置、`MEMORY.md` 和 `TODO.md` 的骨架。已有的文件一个字都不动。

---

## 装在哪儿

记忆跟着**工作空间**走，不跟插件走：工具默认写当前会话的工作目录，所以同一个插件在不同工作空间里各有一份 `memory/`。要指别处，每个工具都有 `root` 参数。

---

## 七个工具

| 工具 | 干什么 |
| --- | --- |
| `memory_search` | 找东西。默认只翻热档，`scope=all` 连冷档一起 |
| `memory_read` | 把某一天整份读出来（不传就今天） |
| `memory_add` | 往某一天追加一段 |
| `memory_index` | 重建热/冷两层索引 |
| `memory_lint` | 体检：标题没带时间、重复小节、空小节、死指针、索引过期 |
| `memory_tend` | 冷热档归纳（`dryRun=true` 只出报告） |
| `memory_stats` | 看一眼现在几天、各被查过几次 |

---

## 每天跑一次

归纳不用你记着，交给定时任务：

```
每天跑一次 memory_tend。跑完如果搬动过什么，就在当天日记里记一句。
```

---

## 配置

第一次用会在 `memory/.tide.json` 写一份默认的，改哪个都行：

```json
{
  "hotKeepDays": 7,
  "promoteHits": 3,
  "coldPromoteHits": 5,
  "pinMaxDays": 90,
  "coldMaxFiles": 120,
  "hotMaxFiles": 0,
  "sectionWarn": 30,
  "searchLimit": 8,
  "searchContext": 3
}
```

### 在设置页里改

装好后打开「设置 → 潮汐记忆」，顶部选一个工作空间，下面九个旋钮直接改，点「保存」写回那个工作空间的 `.tide.json`。

- 工作空间是**自动列出来的**：一打开就去读 DSH 自己的 `$DSH_HOME/storages/workspace.json`，把你用过的工作空间全摆进下拉，带标题、最近动过的排前面。同时合并插件自己记的那份（`$DSH_HOME/integrations/dsh-memory-tide/workspaces.json`）和当前会话的默认工作空间。
- 下拉里没有的，往「其它路径」粘一个绝对路径也能读；没被 DSH 记录过的工作空间就靠这条路。
- 每个工作空间各改各的，互不影响；「恢复默认」只重置当前选中的那一个。
- 设置页要重启一次 DSH 才会出现——浏览器的 bundle 是启动时收集的。

---

## 给 AI 看的那份

插件包里带了 [`SKILL.md`](./SKILL.md)——写的是「什么时候该用哪个工具、翻旧事的三步、什么该写进哪一层」。把那个文件的内容贴进 `AGENTS.md` 或系统提示，AI 就知道怎么用它了。

---

## 已经在用旧结构的记忆怎么办

`memory/` 下直接躺着 `YYYY-MM-DD.md` 的，第一次跑 `memory_tend` 会原样搬进 `archive/hot/`。不需要手动整理。

---

## 许可

MIT

---

English version: [README.en.md](./README.en.md)
