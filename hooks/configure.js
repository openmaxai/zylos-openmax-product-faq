#!/usr/bin/env node
/**
 * Configure hook for zylos-openmax-product-faq
 *
 * Called by zylos with the collected SKILL.md config values as a JSON object on
 * stdin; writes component-owned config.json.
 *
 * Accepts the current prefix OPENMAX_FAQ_* and the legacy OPENMAX_KB_* prefix
 * (openmax-kb ≤0.1.0); OPENMAX_FAQ_* wins when both are given.
 *
 * Example stdin:
 *   { "OPENMAX_FAQ_REPO_URL": "https://github.com/openmaxai/openmax-product-kb.git", "OPENMAX_FAQ_STALE_HOURS": "12" }
 */

import { dataPaths, readJson, writeJsonAtomic, normalizeConfig, DEFAULT_CONFIG } from '../scripts/lib/paths.js';

const P = dataPaths();
const PREFIXES = ['OPENMAX_FAQ_', 'OPENMAX_KB_'];

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

export function configKey(name) {
  for (const p of PREFIXES) if (name.startsWith(p)) return name.slice(p.length).toLowerCase();
  return name.toLowerCase();
}

try {
  const raw = (await readStdin()).trim();
  if (!raw) throw new Error('Expected stdin JSON object with collected config values');

  const collected = JSON.parse(raw);
  if (!collected || Array.isArray(collected) || typeof collected !== 'object') {
    throw new Error('Configure input must be a JSON object');
  }

  const config = { ...DEFAULT_CONFIG, ...(readJson(P.configPath, {}) || {}) };
  // Legacy prefix first so the current prefix overrides it.
  const entries = Object.entries(collected).sort(([a], [b]) =>
    Number(a.startsWith('OPENMAX_FAQ_')) - Number(b.startsWith('OPENMAX_FAQ_')));
  for (const [name, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    config[configKey(name)] = value;
  }

  writeJsonAtomic(P.configPath, normalizeConfig(config));
  console.log(`[configure] Wrote config to ${P.configPath}`);
} catch (err) {
  console.error(`[configure] ${err.message}`);
  process.exit(1);
}
