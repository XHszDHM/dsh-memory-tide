# dsh-memory-tide

> A two-tier memory plugin for DeepSeek Harness: **recent memories stay in context, old ones sink, frequently-used ones float back up.**

Context is scarce. Diaries pile up day after day until they blow the window — yet what you actually reuse is always the last few days, plus a handful of old entries.

Tide memory splits your memory into a **hot tier** and a **cold tier**, and rebalances once a day.

```
        new day → hot tier (read every time)
                    │ 7 days pass, nobody reads it
                    ▼
                  cold tier (read on demand)
                    │ read often enough
                    └──────────→ back to hot, pinned
```

---

## Layout

```
memory/
├── MEMORY.md             long-term essentials (never sinks)
├── TODO.md               open tasks
├── archive/
│   ├── hot/
│   │   ├── INDEX.md      hot index — short, always in context
│   │   └── 2026-10-29.md
│   └── cold/
│       ├── INDEX.md      cold index — only read when digging
│       └── 2026-09-30.md
├── .tide.json            config (everything is tunable)
└── .usage.json           how many times each day was read
```

**The indexes are split too.** The hot index is always in context, so it must stay short; the cold index costs nothing until you open it. `MEMORY.md` carries only one line pointing at the cold tier.

---

## Rebalance rules

| Situation | Result |
| --- | --- |
| Within `hotKeepDays` (default 7) days | always hot |
| Older, but read ≥ `promoteHits` (default 3) times | stays hot, gets pinned |
| Older, and never read | sinks to cold |
| In cold, read ≥ `coldPromoteHits` (default 5) times | back to hot, pinned |
| Pinned and unread for `pinMaxDays` (default 90) days | unpinned, flows again |
| Cold tier exceeds `coldMaxFiles` (default 120) | oldest deleted first |
| Hot tier exceeds `hotMaxFiles` (default 0 = unlimited) | oldest sinks (pinned untouched) |

"Read" is counted **per day**, not per hit — five matches in one day count once. The days you actually revisit float up on their own.

**Moving between tiers is a move, never a delete.** Content is untouched; only the directory changes.

---

## Install

```bash
dsh plugin --profile desktop add dsh-memory-tide
dsh plugin --profile desktop add github:XHszDHM/dsh-memory-tide
dsh plugin --profile desktop add link:D:/path/to/dsh-memory-tide
```

Restart DSH afterwards.

---

## Seven tools

| Tool | Purpose |
| --- | --- |
| `memory_search` | find things; hot tier by default, `scope: "all"` includes cold |
| `memory_read` | read a whole day (defaults to today) |
| `memory_add` | append a section to a day |
| `memory_index` | rebuild both indexes |
| `memory_lint` | check for untimed sections, duplicates, empty sections, dead pointers, stale indexes |
| `memory_tend` | rebalance tiers (`dryRun: true` to preview) |
| `memory_stats` | see current shape |

---

## Run the rebalance daily

Hand it to a scheduled task:

```
Run memory_tend once a day. If anything moved, note it in today's diary.
```

---

## Config

Defaults are written to `memory/.tide.json` on first use:

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

---

## For the agent

The package ships [`SKILL.md`](./SKILL.md) — when to use which tool, the three steps for digging up an old memory, and which tier each kind of note belongs in. Paste it into `AGENTS.md` or your system prompt.

---

## Existing flat memory

If `memory/` still holds bare `YYYY-MM-DD.md` files, the first `memory_tend` moves them into `archive/hot/` untouched.

---

## License

MIT
