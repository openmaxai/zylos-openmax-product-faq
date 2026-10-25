# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Renamed from `openmax-kb` (repo `openmaxai/zylos-openmax-kb`) to `openmax-product-faq`
(repo `openmaxai/zylos-openmax-product-faq`) — Plane OPENM-948. Existing agents are
migrated by the openmax component's install/upgrade hook (installs this component, then
`zylos uninstall openmax-kb --purge`).

### Added
- `kb.js ask "<question>"` — maps a product question to the best 1–2 KB sections and
  prints them with a citation header (`## 来源：《…》` / `## Source: "…"`), matching Q&A
  lines and the section text (4,000-char cap). `--lang zh|en`, `--top N` (≤3).
  `No matching section.` + next steps when nothing matches (exit 0).
- `kb.js index` — rebuild the retrieval index. The index (`index.json`, written
  atomically) is rebuilt after every successful clone/pull and on demand by `ask` when it
  is missing or older than the repo HEAD.
- Retrieval keywords from the content repo's `keywords.yml` (strong / weak terms per
  section, synonym groups; parsed by a dependency-free YAML subset parser). Falls back to
  section-title terms, the Q&A questions (attached to the sections they reference) and the
  built-in `scripts/seed-keywords.json` when it is missing or invalid.
- `status` shows the content commit, last sync error and index state.
- Tests (`node --test`): release consistency, SKILL.md frontmatter / description /
  command-table consistency, YAML parser, index builder, retrieval (Q&A questions hit
  their target section), CLI ask / degrade / path traversal, hooks.

### Changed
- Component, skill directory and data dir renamed to `openmax-product-faq`
  (`~/zylos/components/openmax-product-faq`).
- SKILL.md rewritten: English description with "MUST be checked here first / never from
  memory", distinguished from the Workspace KnowledgeBase, plus Chinese trigger words;
  mandatory answering rules (check first, cite the section, not found →
  contact@openmax.com, never claim a handoff); full command table; workflow starts with
  `ask`.
- Git operations use a 30s timeout (SIGKILL) and never prompt for credentials. A failed
  or timed-out pull degrades to the local copy with a warning instead of exiting; only a
  missing clone is fatal. Clones go to a temp dir first, so a killed clone leaves nothing
  half-written.
- Read commands print sync progress to stderr so `cat` / `ask` output stays clean.
- `search` runs grep without a shell (no quoting issues) and skips `.git`.
- `cat` / `ls` path check now rejects sibling-prefix escapes (`repo-x/…`) and `.git`.
- Config env prefix `OPENMAX_FAQ_*`; the configure hook also accepts the legacy
  `OPENMAX_KB_*`. `stale_hours` given as a string is coerced to a number.
- post-install reuses an existing `openmax-kb` content clone (copied, not moved) and its
  `repo_url` / `stale_hours`, then pulls and builds the index. post-upgrade rebuilds the
  index; the unused `enabled` config field is no longer added (and is dropped).
- `ZYLOS_DIR` is honoured for the data root (default `~/zylos`).

## [0.1.0] - 2026-08-27

### Added
- Initial release (as `openmax-kb`)
- Anonymous clone of public openmax-product-kb repo on install
- Lazy freshness check: auto-pull when local copy is >24h stale
- CLI: `status`, `sync`, `ls`, `cat`, `search` subcommands
- Configurable repo URL and stale threshold
