<h1 align="center">zylos-openmax-product-faq</h1>

<p align="center">
  Official OpenMax product FAQ for Zylos agents — local sync + one-step retrieval over the OpenMax product knowledge base
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://openmax.com"><img src="https://img.shields.io/badge/Built%20by-OpenMax-orange" alt="Built by OpenMax"></a>
</p>

---

> **Formerly `openmax-kb`** ([openmaxai/zylos-openmax-kb](https://github.com/openmaxai/zylos-openmax-kb)).
> Agents with the openmax component are migrated automatically on their next openmax
> install/upgrade. Manual migration:
> `zylos add openmaxai/zylos-openmax-product-faq --yes && zylos uninstall openmax-kb --purge --yes`

- **One-step answers** — `kb.js ask "<question>"` returns the best 1–2 sections of the product KB (Chinese or English questions)
- **Answering rules in the skill** — check first, cite the section, unknown → contact@openmax.com, never claim a handoff
- **Zero-credential sync** — anonymously clones and pulls the public [`openmax-product-kb`](https://github.com/openmaxai/openmax-product-kb) repo
- **Lazy freshness** — pulls only when the local copy is stale (default >24h), with a 30s git timeout and fallback to the local copy
- **Content-team keywords** — retrieval uses the content repo's `keywords.yml`; falls back to heading terms, Q&A questions and built-in seeds

## Install

```bash
zylos add openmaxai/zylos-openmax-product-faq
```

The post-install hook clones the KB repo (or reuses an existing `openmax-kb` clone) and builds the index.

## Configuration

`~/zylos/components/openmax-product-faq/config.json`:

```json
{
  "repo_url": "https://github.com/openmaxai/openmax-product-kb.git",
  "stale_hours": 24
}
```

Via `zylos config`: `OPENMAX_FAQ_REPO_URL`, `OPENMAX_FAQ_STALE_HOURS` (legacy `OPENMAX_KB_*` also accepted).

## Usage

```bash
KB=~/zylos/.claude/skills/openmax-product-faq/scripts/kb.js

node $KB ask "积分怎么扣"            # default first step for any product question
node $KB ask "Can I get an invoice?" --top 1
node $KB search "发票"               # exact-term fallback
node $KB cat README-zh.md            # full file
node $KB ls
node $KB status                      # sync + index state
node $KB sync --force                # pull now and rebuild the index
node $KB index                       # rebuild the index only
```

See [SKILL.md](./SKILL.md) for the full command reference and the answering rules.

## keywords.yml (content repo)

```yaml
version: 1
synonyms:
  积分: [credit, credits, 点数]
sections:
  "5 Credit（积分）":            # zh or en heading; numbering optional; covers both languages
    strong: [积分, 扣费, credit, top-up]
    weak: [用完, usage]
```

Also accepted per section: a plain list (= strong), `{ zh: [...], en: [...] }`, or `{ zh: { strong, weak }, en: { strong, weak } }`.

## Development

```bash
npm test
```

## Built by OpenMax

Zylos is the open-source core of [OpenMax](https://openmax.com/) — the Human × Agent Collaboration Platform.

## License

[MIT](./LICENSE)
