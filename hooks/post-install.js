#!/usr/bin/env node
/**
 * Post-install hook for zylos-openmax-product-faq.
 *
 * 1. Write config.json (defaults; inherit repo_url / stale_hours from a legacy
 *    openmax-kb install when present).
 * 2. Get the content repo: reuse a legacy ~/zylos/components/openmax-kb/repo clone
 *    when present (COPY, never move — the legacy dir is purged by openmax's
 *    migration step), otherwise clone fresh. Then pull + build the ask index.
 *
 * Every failure is non-fatal: the component stays installed and the next
 * `kb.js` read command retries the clone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataPaths, readJson, writeJsonAtomic, normalizeConfig, DEFAULT_CONFIG } from '../scripts/lib/paths.js';

const P = dataPaths();
const KB_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'kb.js');

function kb(args) {
  execFileSync(process.execPath, [KB_JS, ...args], { stdio: 'inherit', env: process.env, timeout: 90000, killSignal: 'SIGKILL' });
}

console.log('[post-install] Running openmax-product-faq setup...\n');
fs.mkdirSync(P.dataDir, { recursive: true });

// 1. config
if (!fs.existsSync(P.configPath)) {
  const legacy = readJson(P.legacyConfigPath, null);
  const inherited = {};
  if (legacy && typeof legacy === 'object') {
    for (const k of ['repo_url', 'stale_hours']) if (legacy[k] !== undefined) inherited[k] = legacy[k];
  }
  const config = normalizeConfig({ ...DEFAULT_CONFIG, ...inherited });
  writeJsonAtomic(P.configPath, config);
  console.log(Object.keys(inherited).length
    ? `Created config.json (inherited ${Object.keys(inherited).join(', ')} from openmax-kb).`
    : 'Created default config.json.');
}

// 2. content repo
const cloned = () => fs.existsSync(path.join(P.repoDir, '.git'));
if (!cloned() && fs.existsSync(path.join(P.legacyRepoDir, '.git'))) {
  const tmp = `${P.repoDir}.tmp-${process.pid}`;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.cpSync(P.legacyRepoDir, tmp, { recursive: true });
    fs.renameSync(tmp, P.repoDir);
    const legacyState = readJson(P.legacyStatePath, {}) || {};
    writeJsonAtomic(P.statePath, { last_pull: legacyState.last_pull || null, copied_from: 'openmax-kb' });
    console.log(`Reused existing openmax-kb content clone (copied from ${P.legacyRepoDir}).`);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.warn(`[post-install] Could not reuse legacy clone (${err.message}); cloning fresh.`);
  }
}

try {
  // Clones when missing; pulls a reused copy (degrades to the local copy on failure).
  kb(['sync', '--force']);
} catch (err) {
  console.error(`[post-install] Sync failed: ${err.message}`);
}

if (cloned()) {
  try {
    kb(['index']);
  } catch (err) {
    console.error(`[post-install] Index build failed (ask rebuilds it on demand): ${err.message}`);
  }
} else {
  console.error('The component is installed but the KB repo is not yet cloned.');
  console.error('Run: node ~/zylos/.claude/skills/openmax-product-faq/scripts/kb.js sync');
}

console.log('\n[post-install] Complete!');
