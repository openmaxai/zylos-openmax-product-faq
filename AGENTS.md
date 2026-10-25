# AGENTS.md — zylos-openmax-product-faq engineering conventions

This file binds every agent (Claude, Codex, or any other) that develops,
reviews, or releases in this repository. CLAUDE.md points here. Extend it
with component-specific rules as the project grows, but do not remove the
Release Process section below.

## Project Conventions

- **ESM only** — `import`/`export`, never `require()`. `"type": "module"` in package.json
- **Node.js 20+** — Minimum runtime version
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **All config in `~/zylos/components/openmax-product-faq/config.json`** — never committed; code is disposable, data is permanent
- **English for code** — Comments, commit messages, PR descriptions, documentation

## Release Process (hard gate)

Version bumps happen **only in a dedicated release PR** — feature PRs carry
source + tests + CHANGELOG entries under `## [Unreleased]`, never a version
change. The release PR must update **all four files in the same commit**:

1. **`package.json`** — Bump `version`
2. **`package-lock.json`** — Run `npm install` after bumping package.json to sync the lock file
3. **`SKILL.md`** — Update `version` in the YAML frontmatter to match. zylos-core registers the installed version from this field and uses it to decide upgrades; a stale value causes repeated upgrade prompts
4. **`CHANGELOG.md`** — Convert the `## [Unreleased]` section into a `## [X.Y.Z] - YYYY-MM-DD` entry ([Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format)

Version bump commit message: `chore: bump version to X.Y.Z`

After merge, create a GitHub Release with tag `vX.Y.Z` from the merge commit.

Machine gate vs process gate: `test/release-consistency.test.js` enforces the
**final-tree** half of this rule only — the suite fails whenever the four
version faces disagree in the working tree. The dedicated-release-PR and
same-commit requirements are process gates, guaranteed by the release flow
and review, not provable by this test. Keep the test passing and keep its
negative controls intact — a gate that cannot fail proves nothing.

## Component-specific notes

- Formerly `openmax-kb` (`openmaxai/zylos-openmax-kb`). The component name comes from the
  repo name minus `zylos-`; the skill directory, SKILL.md `name` and data dir must all be
  `openmax-product-faq`.
- SKILL.md is the agent-facing contract: every `kb.js --help` subcommand must appear in its
  Commands table (`test/skill-md.test.js` enforces it). The description must stay ≤1024
  chars and keep "MUST be checked here first" plus the Chinese trigger words.
- Retrieval keywords live in the content repo (`openmaxai/openmax-product-kb/keywords.yml`,
  content-team owned). `scripts/seed-keywords.json` is only the fallback.
- No runtime hooks (UserPromptSubmit / SessionStart) and no prompt injection: retrieval only
  happens when an agent calls `kb.js`.

## Testing

- `npm test` runs `node --test` over `test/*.test.js`
- The release-consistency gate (above) ships with the scaffold and must stay
- When a test guards specific logic, prove it can fail: temporarily break the
  guarded behavior (a known-bad mutant), confirm the test goes red, restore
