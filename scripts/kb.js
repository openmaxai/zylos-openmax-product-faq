#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/openmax-kb');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const REPO_DIR = path.join(DATA_DIR, 'repo');
const STATE_PATH = path.join(DATA_DIR, 'sync-state.json');

const DEFAULT_REPO_URL = 'https://github.com/openmaxai/openmax-product-kb.git';
const DEFAULT_STALE_HOURS = 24;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function getRepoUrl() {
  return loadConfig().repo_url || DEFAULT_REPO_URL;
}

function getStaleHours() {
  const h = loadConfig().stale_hours;
  return typeof h === 'number' && h > 0 ? h : DEFAULT_STALE_HOURS;
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function isCloned() {
  return fs.existsSync(path.join(REPO_DIR, '.git'));
}

function hoursAgo(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

function isStale() {
  const state = loadState();
  return hoursAgo(state.last_pull) > getStaleHours();
}

function gitClone() {
  const url = getRepoUrl();
  console.log(`Cloning ${url} ...`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  execSync(`git clone --depth 1 ${url} ${REPO_DIR}`, { stdio: 'inherit' });
  saveState({ last_pull: new Date().toISOString() });
  console.log('Clone complete.');
}

function gitPull() {
  console.log('Pulling latest...');
  execSync('git pull --ff-only', { cwd: REPO_DIR, stdio: 'inherit' });
  saveState({ last_pull: new Date().toISOString() });
  console.log('Pull complete.');
}

function ensureFresh(force) {
  if (!isCloned()) {
    gitClone();
  } else if (force || isStale()) {
    gitPull();
  } else {
    console.log('Local copy is fresh, no pull needed.');
  }
}

function resolvePath(sub) {
  const target = sub ? path.join(REPO_DIR, sub) : REPO_DIR;
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(REPO_DIR))) {
    console.error('Error: path traversal outside repo.');
    process.exit(1);
  }
  return resolved;
}

// --- Commands ---

function cmdStatus() {
  const state = loadState();
  const cloned = isCloned();
  const staleHours = getStaleHours();
  const ago = state.last_pull ? hoursAgo(state.last_pull).toFixed(1) : null;
  const stale = ago ? parseFloat(ago) > staleHours : true;

  console.log(`Repo URL:     ${getRepoUrl()}`);
  console.log(`Local path:   ${REPO_DIR}`);
  console.log(`Cloned:       ${cloned ? 'yes' : 'no'}`);
  console.log(`Last pull:    ${state.last_pull || 'never'}`);
  console.log(`Hours ago:    ${ago || 'n/a'}`);
  console.log(`Stale (>${staleHours}h): ${stale ? 'YES' : 'no'}`);
}

function cmdSync(force) {
  ensureFresh(force);
}

function cmdLs(sub) {
  ensureFresh(false);
  const target = resolvePath(sub);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${sub || '/'}`);
    process.exit(1);
  }
  if (fs.statSync(target).isDirectory()) {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      console.log(e.isDirectory() ? `${e.name}/` : e.name);
    }
  } else {
    console.log(path.basename(target));
  }
}

function cmdCat(sub) {
  if (!sub) { console.error('Usage: kb.js cat <path>'); process.exit(1); }
  ensureFresh(false);
  const target = resolvePath(sub);
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    console.error(`Not a file: ${sub}`);
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(target, 'utf8'));
}

function cmdSearch(pattern) {
  if (!pattern) { console.error('Usage: kb.js search <pattern>'); process.exit(1); }
  ensureFresh(false);
  try {
    const out = execSync(
      `grep -rn --include='*.md' --include='*.txt' --include='*.json' -i ${JSON.stringify(pattern)} .`,
      { cwd: REPO_DIR, encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
    process.stdout.write(out);
  } catch (e) {
    if (e.status === 1) {
      console.log('No matches found.');
    } else {
      throw e;
    }
  }
}

// --- Main ---

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'status':
    cmdStatus();
    break;
  case 'sync':
    cmdSync(args.includes('--force'));
    break;
  case 'ls':
    cmdLs(args[1]);
    break;
  case 'cat':
    cmdCat(args[1]);
    break;
  case 'search':
    cmdSearch(args.slice(1).join(' '));
    break;
  case '--help':
  case '-h':
  case undefined:
    console.log(`Usage: kb.js <command> [args]

Commands:
  status            Show sync status (last pull, staleness)
  sync [--force]    Clone if missing, pull if stale (or forced)
  ls [path]         List KB contents
  cat <path>        Read a KB file
  search <pattern>  Grep KB content`);
    break;
  default:
    console.error(`Unknown command: ${cmd}. Run with --help.`);
    process.exit(1);
}
