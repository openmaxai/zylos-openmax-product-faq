---
name: openmax-kb
version: 0.1.0
description: >-
  Local sync and query of the OpenMax product knowledge base (openmax-product-kb).
  Use when querying OpenMax product knowledge, product features, pricing tiers,
  FAQ, customer-facing documentation, sales playbooks, or any content maintained
  in the openmax-product-kb repository. Also use when asked "what does OpenMax do",
  "how does pricing work", "product capabilities", or similar product questions.
type: utility

lifecycle:
  npm: true
  data_dir: ~/zylos/components/openmax-kb
  hooks:
    configure: hooks/configure.js
    post-install: hooks/post-install.js
    pre-upgrade: hooks/pre-upgrade.js
    post-upgrade: hooks/post-upgrade.js
  preserve:
    - config.json
    - repo/

upgrade:
  repo: openmaxai/zylos-openmax-kb
  branch: main

config:
  optional:
    - name: OPENMAX_KB_REPO_URL
      description: Git HTTPS URL of the public KB repo
      default: "https://github.com/openmaxai/openmax-product-kb.git"
    - name: OPENMAX_KB_STALE_HOURS
      description: Hours before local copy is considered stale and needs a pull
      default: "24"

dependencies: []
---

# OpenMax KB

Lazy-sync local mirror of the OpenMax product knowledge base. The repo is cloned
on first install; subsequent reads check freshness and pull only when stale
(default >24 h since last pull). No scheduler — zero token cost when idle.

## Before querying

If the KB has not been synced in over a day, pull first:

```bash
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js sync
```

Then read files directly from the local repo path shown by `status`.

## CLI

```bash
# Check sync status (last pull time, staleness)
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js status

# Sync: clone if missing, pull if stale, skip if fresh
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js sync

# Force pull regardless of freshness
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js sync --force

# List KB contents (top-level or subpath)
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js ls [path]

# Read a specific file
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js cat <path>

# Search KB content
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js search <pattern>
```

## Workflow

1. Check `status` — if stale, run `sync` first
2. Use `ls` to browse, `cat` to read, `search` to find content
3. Answer the user's question from the KB content

The local repo lives at `~/zylos/components/openmax-kb/repo/`.
