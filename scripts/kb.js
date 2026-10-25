#!/usr/bin/env node
/**
 * kb.js — CLI for the OpenMax product FAQ / knowledge base (openmax-product-faq).
 *
 * Lazy-syncs a shallow clone of openmaxai/openmax-product-kb into
 * $ZYLOS_DIR/components/openmax-product-faq/repo (ZYLOS_DIR defaults to ~/zylos)
 * and answers product questions with `ask`, which returns the best 1–2 sections.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dataPaths, loadConfig, readJson, writeJsonAtomic } from './lib/paths.js';
import { writeIndex, readIndex, describeIndex, gitHead, buildIndex } from './lib/index-builder.js';
import { retrieve, formatAsk } from './lib/retrieve.js';

const GIT_TIMEOUT_MS = 30000;

const P = dataPaths();

const HELP = `Usage: kb.js <command> [args]

Commands:
  ask "<question>"  Best 1-2 KB sections for a product question (default first step)
                    Options: --lang zh|en (default: auto), --top N (1-3, default 2)
  search <pattern>  Case-insensitive full-text grep over the KB files
  cat <path>        Print a KB file (path relative to the repo)
  ls [path]         List KB contents
  status            Show sync + index status
  sync [--force]    Clone if missing, pull if stale (or forced), then rebuild the index
  index             Rebuild the retrieval index from the local copy`;

function gitEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' };
}

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: gitEnv(),
    ...opts
  });
}

function gitError(err) {
  if (err.signal === 'SIGKILL' || err.code === 'ETIMEDOUT') return `timed out after ${GIT_TIMEOUT_MS / 1000}s`;
  const stderr = err.stderr ? String(err.stderr).trim().split('\n').slice(-2).join(' ') : '';
  return stderr || err.message;
}

const toStderr = (m) => process.stderr.write(m + '\n');
const toStdout = (m) => console.log(m);

function loadState() {
  return readJson(P.statePath, {}) || {};
}

function saveState(patch) {
  writeJsonAtomic(P.statePath, { ...loadState(), ...patch });
}

function isCloned() {
  return fs.existsSync(path.join(P.repoDir, '.git'));
}

function hoursAgo(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
}

function rebuildIndex(say) {
  try {
    const idx = writeIndex(P.repoDir, P.indexPath);
    say(describeIndex(idx));
    return idx;
  } catch (err) {
    process.stderr.write(`warning: index rebuild failed: ${err.message}\n`);
    return null;
  }
}

function gitClone(say) {
  const url = loadConfig(P).repo_url;
  say(`Cloning ${url} ...`);
  fs.mkdirSync(P.dataDir, { recursive: true });
  // Clone into a temp dir, then rename: a killed clone never leaves a half repo behind.
  const tmp = `${P.repoDir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    git(['clone', '--depth', '1', '--', url, tmp]);
    fs.rmSync(P.repoDir, { recursive: true, force: true });
    fs.renameSync(tmp, P.repoDir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  saveState({ last_pull: new Date().toISOString(), last_error: null });
  say('Clone complete.');
}

function gitPull(say) {
  say('Pulling latest...');
  git(['pull', '--ff-only'], { cwd: P.repoDir });
  saveState({ last_pull: new Date().toISOString(), last_error: null });
  say('Pull complete.');
}

/**
 * Make sure a local copy exists and is not stale.
 * - no clone → clone (failure is fatal: nothing to answer from)
 * - stale or forced → pull; failure/timeout degrades to the local copy with a warning
 * After a successful clone/pull the index is rebuilt.
 * `say` receives progress lines (stdout for `sync`, stderr for read commands).
 */
function ensureFresh({ force = false, say }) {
  if (!isCloned()) {
    try {
      gitClone(say);
    } catch (err) {
      process.stderr.write(`Error: KB clone failed (${gitError(err)}). No local copy available.\n`);
      process.stderr.write('Check network access to GitHub, then run: kb.js sync\n');
      process.exit(1);
    }
    rebuildIndex(say);
    return { updated: true };
  }
  const state = loadState();
  const staleHours = loadConfig(P).stale_hours;
  if (!force && hoursAgo(state.last_pull) <= staleHours) {
    if (say === toStdout) say('Local copy is fresh, no pull needed.');
    return { updated: false };
  }
  try {
    gitPull(say);
  } catch (err) {
    const msg = gitError(err);
    try { saveState({ last_error: `${new Date().toISOString()} ${msg}` }); } catch {}
    process.stderr.write(`warning: KB sync failed, using local copy from ${state.last_pull || 'unknown time'} (${msg})\n`);
    return { updated: false, degraded: true };
  }
  rebuildIndex(say);
  return { updated: true };
}


function resolvePath(sub) {
  const root = path.resolve(P.repoDir);
  const resolved = path.resolve(root, sub || '.');
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] === '.git') {
    console.error('Error: path outside the KB repo.');
    process.exit(1);
  }
  return resolved;
}

/** Load the index, rebuilding it when missing, from an older schema, or older than repo HEAD. */
function currentIndex() {
  const head = gitHead(P.repoDir);
  let idx = readIndex(P.indexPath);
  if (idx && (!head || idx.commit === head)) return idx;
  try {
    idx = writeIndex(P.repoDir, P.indexPath, { commit: head });
  } catch (err) {
    process.stderr.write(`warning: could not write index (${err.message}); using an in-memory index\n`);
    idx = buildIndex(P.repoDir, { commit: head });
  }
  return idx;
}

// --- Commands ---

function cmdStatus() {
  const cfg = loadConfig(P);
  const state = loadState();
  const cloned = isCloned();
  const ago = hoursAgo(state.last_pull);
  const idx = readIndex(P.indexPath);
  console.log(`Repo URL:     ${cfg.repo_url}`);
  console.log(`Local path:   ${P.repoDir}`);
  console.log(`Cloned:       ${cloned ? 'yes' : 'no'}`);
  console.log(`Commit:       ${cloned ? (gitHead(P.repoDir) || 'unknown').slice(0, 7) : 'n/a'}`);
  console.log(`Last pull:    ${state.last_pull || 'never'}`);
  console.log(`Hours ago:    ${Number.isFinite(ago) ? ago.toFixed(1) : 'n/a'}`);
  console.log(`Stale (>${cfg.stale_hours}h): ${ago > cfg.stale_hours ? 'YES' : 'no'}`);
  if (state.last_error) console.log(`Last error:   ${state.last_error}`);
  if (idx) {
    const kw = idx.source === 'keywords.yml' ? 'yes' : `fallback${idx.keywords_error ? ` (${idx.keywords_error})` : ''}`;
    console.log(`Index:        built at ${idx.built_at} (commit ${(idx.commit || 'unknown').slice(0, 7)}, keywords.yml: ${kw}, ${idx.stats.sections} sections, ${idx.stats.terms} terms)`);
    if (idx.unresolved_keys.length) console.log(`Unresolved keywords.yml keys: ${idx.unresolved_keys.join(' | ')}`);
  } else {
    console.log('Index:        missing (built automatically by sync / ask, or run: kb.js index)');
  }
}

function cmdSync(force) {
  ensureFresh({ force, say: toStdout });
}

function cmdIndex() {
  if (!isCloned()) {
    console.error('Error: KB not cloned yet. Run: kb.js sync');
    process.exit(1);
  }
  const idx = writeIndex(P.repoDir, P.indexPath);
  console.log(describeIndex(idx));
}

function cmdLs(sub) {
  ensureFresh({ say: toStderr });
  const target = resolvePath(sub);
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${sub || '/'}`);
    process.exit(1);
  }
  if (fs.statSync(target).isDirectory()) {
    for (const e of fs.readdirSync(target, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      console.log(e.isDirectory() ? `${e.name}/` : e.name);
    }
  } else {
    console.log(path.basename(target));
  }
}

function cmdCat(sub) {
  if (!sub) { console.error('Usage: kb.js cat <path>'); process.exit(1); }
  ensureFresh({ say: toStderr });
  const target = resolvePath(sub);
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    console.error(`Not a file: ${sub}`);
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(target, 'utf8'));
}

function cmdSearch(pattern) {
  if (!pattern) { console.error('Usage: kb.js search <pattern>'); process.exit(1); }
  ensureFresh({ say: toStderr });
  try {
    const out = execFileSync('grep', [
      '-rn', '-i', '--include=*.md', '--include=*.txt', '--include=*.json', '--include=*.yml',
      '--exclude-dir=.git', '-e', pattern, '.'
    ], { cwd: P.repoDir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    process.stdout.write(out);
  } catch (e) {
    if (e.status === 1) console.log('No matches found.');
    else { console.error(`search failed: ${e.message}`); process.exit(2); }
  }
}

function parseAskArgs(args) {
  const words = [];
  let lang;
  let top;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--lang') lang = args[++i];
    else if (a.startsWith('--lang=')) lang = a.slice(7);
    else if (a === '--top') top = args[++i];
    else if (a.startsWith('--top=')) top = a.slice(6);
    else words.push(a);
  }
  return { question: words.join(' ').trim(), lang, top };
}

function cmdAsk(args) {
  const { question, lang, top } = parseAskArgs(args);
  if (!question) { console.error('Usage: kb.js ask "<question>" [--lang zh|en] [--top N]'); process.exit(1); }
  if (lang && lang !== 'zh' && lang !== 'en') { console.error('--lang must be zh or en'); process.exit(1); }
  ensureFresh({ say: toStderr });
  const idx = currentIndex();
  const result = retrieve(idx, question, { lang, top });
  process.stdout.write(formatAsk(idx, P.repoDir, result, { lastPull: loadState().last_pull }));
}

// --- Main ---

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'ask':
    cmdAsk(args.slice(1));
    break;
  case 'search':
    cmdSearch(args.slice(1).join(' '));
    break;
  case 'cat':
    cmdCat(args[1]);
    break;
  case 'ls':
    cmdLs(args[1]);
    break;
  case 'status':
    cmdStatus();
    break;
  case 'sync':
    cmdSync(args.includes('--force'));
    break;
  case 'index':
    cmdIndex();
    break;
  case '--help':
  case '-h':
  case 'help':
  case undefined:
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command: ${cmd}. Run with --help.`);
    process.exit(1);
}
