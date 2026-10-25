#!/usr/bin/env node
/**
 * Post-upgrade hook for zylos-openmax-product-faq.
 *
 * - Normalise config.json (stale_hours as a number; drop the unused template
 *   `enabled` field written by openmax-kb 0.1.0's post-upgrade).
 * - Rebuild the ask index: the index format or the built-in seed keywords may
 *   have changed with the new code.
 *
 * Non-fatal: always exits 0 (ask rebuilds a missing/old index on demand).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataPaths, readJson, writeJsonAtomic, normalizeConfig } from '../scripts/lib/paths.js';

const P = dataPaths();
const KB_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'kb.js');

console.log('[post-upgrade] Running openmax-product-faq migrations...\n');

const raw = readJson(P.configPath, null);
if (raw && typeof raw === 'object') {
  const { enabled, ...rest } = raw;
  const next = normalizeConfig(rest);
  if (JSON.stringify(next) !== JSON.stringify(raw)) {
    try {
      writeJsonAtomic(P.configPath, next);
      console.log('Config normalised.');
    } catch (err) {
      console.error(`Config migration failed (non-fatal): ${err.message}`);
    }
  } else {
    console.log('No config migrations needed.');
  }
} else {
  console.log('No config file found, skipping migrations.');
}

if (fs.existsSync(path.join(P.repoDir, '.git'))) {
  try {
    execFileSync(process.execPath, [KB_JS, 'index'], { stdio: 'inherit', env: process.env, timeout: 60000, killSignal: 'SIGKILL' });
  } catch (err) {
    console.error(`Index rebuild failed (non-fatal; ask rebuilds on demand): ${err.message}`);
  }
} else {
  console.log('KB repo not cloned yet; index will be built on first sync.');
}

console.log('\n[post-upgrade] Complete!');
