#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/openmax-kb');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const REPO_DIR = path.join(DATA_DIR, 'repo');
const STATE_PATH = path.join(DATA_DIR, 'sync-state.json');

const DEFAULT_CONFIG = {
  repo_url: 'https://github.com/openmaxai/openmax-product-kb.git',
  stale_hours: 24
};

console.log('[post-install] Running openmax-kb setup...\n');

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(CONFIG_PATH)) {
  console.log('Creating default config.json...');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const repoUrl = config.repo_url || DEFAULT_CONFIG.repo_url;

if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
  console.log(`Cloning ${repoUrl} ...`);
  try {
    execSync(`git clone --depth 1 ${repoUrl} ${REPO_DIR}`, { stdio: 'inherit' });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ last_pull: new Date().toISOString() }, null, 2) + '\n');
    console.log('Clone complete.');
  } catch (err) {
    console.error(`[post-install] Clone failed: ${err.message}`);
    console.error('The component is installed but the KB repo is not yet cloned.');
    console.error('Run: node ~/zylos/.claude/skills/openmax-kb/scripts/kb.js sync');
  }
} else {
  console.log('Repo already cloned, skipping.');
}

console.log('\n[post-install] Complete!');
