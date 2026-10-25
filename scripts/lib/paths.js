/**
 * Shared paths, config and small fs helpers for kb.js and the lifecycle hooks.
 *
 * The data root follows zylos-core: $ZYLOS_DIR, else $HOME/zylos.
 */

import fs from 'node:fs';
import path from 'node:path';

export const COMPONENT = 'openmax-product-faq';
export const LEGACY_COMPONENT = 'openmax-kb';

export const DEFAULT_REPO_URL = 'https://github.com/openmaxai/openmax-product-kb.git';
export const DEFAULT_STALE_HOURS = 24;
export const DEFAULT_CONFIG = Object.freeze({
  repo_url: DEFAULT_REPO_URL,
  stale_hours: DEFAULT_STALE_HOURS
});

export function zylosDir(env = process.env) {
  return env.ZYLOS_DIR || path.join(env.HOME || '', 'zylos');
}

export function dataPaths(env = process.env) {
  const root = zylosDir(env);
  const dataDir = path.join(root, 'components', COMPONENT);
  const legacyDir = path.join(root, 'components', LEGACY_COMPONENT);
  return {
    zylosDir: root,
    dataDir,
    configPath: path.join(dataDir, 'config.json'),
    repoDir: path.join(dataDir, 'repo'),
    statePath: path.join(dataDir, 'sync-state.json'),
    indexPath: path.join(dataDir, 'index.json'),
    legacyDir,
    legacyConfigPath: path.join(legacyDir, 'config.json'),
    legacyRepoDir: path.join(legacyDir, 'repo'),
    legacyStatePath: path.join(legacyDir, 'sync-state.json')
  };
}

export function readJson(file, fallback = null) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return fallback;
}

/** Atomic JSON write: write a sibling temp file, then rename over the target. */
export function writeJsonAtomic(file, value, { pretty = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 2 : 0) + '\n');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

/** Coerce config values; stale_hours may arrive as a string from configure. */
export function normalizeConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
  const h = Number(cfg.stale_hours);
  cfg.stale_hours = Number.isFinite(h) && h > 0 ? h : DEFAULT_STALE_HOURS;
  if (typeof cfg.repo_url !== 'string' || !cfg.repo_url.trim()) cfg.repo_url = DEFAULT_REPO_URL;
  return cfg;
}

export function loadConfig(paths = dataPaths()) {
  return normalizeConfig(readJson(paths.configPath, {}));
}
