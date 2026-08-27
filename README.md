<h1 align="center">zylos-openmax-kb</h1>

<p align="center">
  Local sync and query of the OpenMax product knowledge base
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://openmax.com"><img src="https://img.shields.io/badge/Built%20by-OpenMax-orange" alt="Built by OpenMax"></a>
</p>

---

- **Zero-credential sync** — anonymously clones and pulls the public `openmax-product-kb` repo
- **Lazy freshness** — auto-pulls only when local copy is stale (default >24h), zero cost when idle
- **CLI access** — `status`, `sync`, `ls`, `cat`, `search` for agents and humans

## Install

```bash
zylos add openmax-kb
```

The post-install hook automatically clones the KB repo.

## Configuration

Edit `~/zylos/components/openmax-kb/config.json`:

```json
{
  "repo_url": "https://github.com/openmaxai/openmax-product-kb.git",
  "stale_hours": 24
}
```

## Usage

```bash
# Check sync status
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js status

# Sync (clone or pull)
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js sync

# Browse and read
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js ls
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js cat README-zh.md

# Search
node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js search "pricing"
```

## Built by OpenMax

Zylos is the open-source core of [OpenMax](https://openmax.com/) — the Human × Agent Collaboration Platform.

## License

[MIT](./LICENSE)
