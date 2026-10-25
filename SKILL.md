---
name: openmax-product-faq
version: 0.1.0
description: >-
  Official OpenMax product FAQ and knowledge base (customer-facing, synced from
  openmax-product-kb). Use it to answer any question about OpenMax / OpenMax Workspace
  as a product: what it is and how to use it, features, plans and pricing, trial,
  Credits billing, subscription renewal, refunds and invoices, digital employees
  (Agents), IM channel setup, connectors, projects and tasks, org and seats, security
  and compliance, limitations, troubleshooting. Product questions MUST be checked here
  first; never answer them from memory. Not the org's own Workspace KnowledgeBase
  (that is the openmax skill's kb CLI). Chinese triggers: OpenMax 是什么, 怎么用, 积分,
  套餐, 价格, 多少钱, 怎么收费, 试用, 扣费, 续费, 退款, 发票, 数字员工, 员工休眠, 飞书,
  企业微信, 钉钉, 微信, 连接器, 安全合规, 支持吗, 能不能, 报错.
type: utility

lifecycle:
  npm: true
  data_dir: ~/zylos/components/openmax-product-faq
  hooks:
    configure: hooks/configure.js
    post-install: hooks/post-install.js
    pre-upgrade: hooks/pre-upgrade.js
    post-upgrade: hooks/post-upgrade.js
  preserve:
    - config.json
    - repo/

upgrade:
  repo: openmaxai/zylos-openmax-product-faq
  branch: main

config:
  optional:
    - name: OPENMAX_FAQ_REPO_URL
      description: Git HTTPS URL of the public product KB content repo (legacy OPENMAX_KB_REPO_URL is also accepted)
      default: "https://github.com/openmaxai/openmax-product-kb.git"
    - name: OPENMAX_FAQ_STALE_HOURS
      description: Hours before the local copy is considered stale and pulled on the next query (legacy OPENMAX_KB_STALE_HOURS is also accepted)
      default: "24"

dependencies: []
---

# OpenMax Product FAQ

## What this is

The official, customer-facing OpenMax product documentation (features, plans and
pricing, Credits, channels, limits, troubleshooting, escalation rules), mirrored
locally from the public `openmax-product-kb` repo. It is **not** the organization's
own Workspace KnowledgeBase — that one is reached through the openmax skill's `kb` CLI.
Formerly named `openmax-kb`; the old `~/zylos/.claude/skills/openmax-kb/` path is gone.

## Answering rules (mandatory)

1. **Check first.** For any question about OpenMax as a product (features / plans &
   pricing / Credits / subscription / IM channels / limits / troubleshooting), query this
   KB before answering: `kb.js ask "<the user's question>"` returns the best 1–2 sections.
   If they do not cover it, fall back to `kb.js search <keyword>` / `kb.js cat <file>`.
   If the KB conflicts with your memory, the KB wins.
2. **Cite the section.** End the answer with the section it is based on, e.g.
   「来源：OpenMax 产品知识库 ·《订阅和套餐 · 试用期》」 (English: "Source: OpenMax product
   knowledge base · "Subscriptions and Plans · Trial Period""). Give customers the section
   title only — no file paths, repo names or internal commands. For ⚠️ time-sensitive items
   add "以最新产品页面为准" / "please check the latest product page".
3. **Not found → say so.** If the KB does not cover it, is inconsistent, or the request
   involves custom pricing / refunds / contracts / invoices / compliance documents, say you
   are not certain and give **contact@openmax.com** (per the KB section「转客服 / 升级」).
   Never say "I've transferred you / handed this to support" — you have no real handoff
   capability.
4. Do not reveal internal positions (KB section「红线」); never perform irreversible
   account / billing actions for the user.
5. This skill is the official OpenMax product documentation. The org's own Workspace
   KnowledgeBase is accessed via the openmax skill's kb CLI.

## Quick start

For any product question, the default first step is:

```bash
node ~/zylos/.claude/skills/openmax-product-faq/scripts/kb.js ask "<user question>"
```

Pass the user's own words (Chinese or English). Read commands sync automatically when the
local copy is stale — no need to run `status` or `sync` first.

## Commands

All commands: `node ~/zylos/.claude/skills/openmax-product-faq/scripts/kb.js <command>`.

| Command | What it does / when to use | Args | Output | Example |
|---|---|---|---|---|
| `ask "<question>"` | **Default first step.** Maps the question to the most relevant 1–2 KB sections and prints their text. Use it for every product question. | `<question>` required — pass the user's words. `--lang zh\|en` (default: auto from CJK ratio). `--top N` (default 2, max 3). | Per section: `## 来源：《section title》（commit … · 同步于 …）` (English: `## Source: "…"`), a `<!-- file lines … -->` locator, matching Q&A lines (`> Q&A …`), then the section text (cut at 4,000 chars with a `kb.js cat` hint). No hit: `No matching section.` plus next steps. Exit code 0. | `kb.js ask "试用会自动扣费吗"` |
| `search <pattern>` | Case-insensitive full-text grep. Use when `ask` has no hit or you need an exact term (price, channel name, error text). | `<pattern>` required (grep pattern). | `./README-zh.md:<line>:<whole line>`; no hit: `No matches found.` | `kb.js search "发票"` |
| `cat <path>` | Prints a whole file. Use for more context or when `ask` output was truncated. | `<path>` required, relative to the repo (cannot leave it). | Raw file text. | `kb.js cat README-zh.md` |
| `ls [path]` | Lists KB files. Use to see what the KB contains. | `[path]` optional, default repo root. | One entry per line, directories end with `/`. | `kb.js ls` |
| `status` | Shows sync + index state. Use when content may be outdated or while troubleshooting. | none | `Repo URL` / `Local path` / `Cloned` / `Commit` / `Last pull` / `Hours ago` / `Stale` / `Index: built at … (commit …, keywords.yml: yes\|fallback, …)`. | `kb.js status` |
| `sync [--force]` | Clones if missing, pulls if stale (`--force`: always pull), then rebuilds the index. Normally not needed — read commands do it. | `--force` optional | `Cloning…` / `Pulling…` / `Local copy is fresh…`, then `Index rebuilt: N sections, M terms, source=…`. On failure: a warning, and the local copy keeps being used. | `kb.js sync --force` |
| `index` | Rebuilds the retrieval index from the local copy (maintenance; `sync` and `ask` do this automatically). | none | `Index rebuilt: N sections, M terms, source=keywords.yml\|fallback` | `kb.js index` |

## Workflow

1. `ask "<user question>"` → answer from the returned section(s), following the rules above.
2. Not enough? `search <keyword>` with a distinctive word, then `cat <file>` around the hit.
3. Content looks outdated (user mentions something new, or `status` says stale)? `sync --force`, then ask again.
4. Still not covered → "not certain" + contact@openmax.com (rule 3).

## Data & freshness

- Local copy: `~/zylos/components/openmax-product-faq/repo/` (shallow clone of
  `openmaxai/openmax-product-kb`); config in `config.json` (`repo_url`, `stale_hours`).
- Lazy sync: every read command (`ask` / `search` / `cat` / `ls`) pulls when the last pull is
  older than `stale_hours` (default 24h). Git runs with a 30s timeout; if the pull fails or
  times out you get `warning: KB sync failed, using local copy from <time>` and the
  answer comes from the existing local copy.
- Index: `index.json`, rebuilt after every successful clone/pull (and by `ask` when it is
  missing or older than the repo). Keywords come from the content repo's `keywords.yml`
  (maintained with the FAQ); when it is missing or invalid, section-title terms, the Q&A
  questions and the built-in `scripts/seed-keywords.json` are used instead.

## Troubleshooting

- **`Error: KB clone failed`** — no local copy and GitHub unreachable. Check network, then
  `kb.js sync`. Until then, answer "not certain" + contact@openmax.com.
- **`warning: KB sync failed, using local copy…`** — answers still work from the local copy;
  `kb.js status` shows `Last error`. Retry later with `kb.js sync --force`.
- **`ask` returns `No matching section.`** — try `kb.js search` with a key term (also try the
  English/Chinese equivalent), then `cat`. If still nothing, the KB does not cover it.
- **`status` lists unresolved keywords.yml keys** — a section was renamed in the content repo;
  `ask` still works (title terms + fallback), but tell the content team.
