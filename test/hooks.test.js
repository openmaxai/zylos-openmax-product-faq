import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, MINI, makeContentRepo, runNode, tmpDir, runKb } from './helpers.js';

const HOOK = (n) => path.join(ROOT, 'hooks', `${n}.js`);
const dataDir = (z) => path.join(z, 'components', 'openmax-product-faq');
const readCfg = (z) => JSON.parse(fs.readFileSync(path.join(dataDir(z), 'config.json'), 'utf8'));

test('configure: accepts OPENMAX_FAQ_* and legacy OPENMAX_KB_* (FAQ wins), coerces stale_hours', () => {
  const z = tmpDir();
  let r = runNode(HOOK('configure'), z, { input: JSON.stringify({ OPENMAX_KB_REPO_URL: 'https://example.com/legacy.git', OPENMAX_KB_STALE_HOURS: '6' }) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readCfg(z), { repo_url: 'https://example.com/legacy.git', stale_hours: 6 });
  r = runNode(HOOK('configure'), z, { input: JSON.stringify({ OPENMAX_FAQ_REPO_URL: 'https://example.com/new.git', OPENMAX_KB_REPO_URL: 'https://example.com/old.git' }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readCfg(z).repo_url, 'https://example.com/new.git');
  assert.equal(readCfg(z).stale_hours, 6);
  assert.equal(runNode(HOOK('configure'), z, { input: '' }).code, 1);
  assert.equal(runNode(HOOK('configure'), z, { input: '[1]' }).code, 1);
});

test('post-install (fresh): default config, clone, index', () => {
  const z = tmpDir();
  // Pre-seed config so the hook clones the local fixture instead of GitHub.
  const repo = makeContentRepo(MINI);
  fs.mkdirSync(dataDir(z), { recursive: true });
  fs.writeFileSync(path.join(dataDir(z), 'config.json'), JSON.stringify({ repo_url: repo }));
  const r = runNode(HOOK('post-install'), z);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dataDir(z), 'repo', '.git')));
  assert.ok(fs.existsSync(path.join(dataDir(z), 'index.json')));
  assert.match(r.stdout, /Index rebuilt/);
});

test('post-install reuses a legacy openmax-kb clone by COPY and inherits its config', () => {
  const z = tmpDir();
  const upstream = makeContentRepo(MINI);
  const legacy = path.join(z, 'components', 'openmax-kb');
  fs.mkdirSync(legacy, { recursive: true });
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${upstream}`, path.join(legacy, 'repo')]);
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ repo_url: `file://${upstream}`, stale_hours: 12, enabled: true }));
  fs.writeFileSync(path.join(legacy, 'sync-state.json'), JSON.stringify({ last_pull: '2026-10-15T00:00:00.000Z' }));
  const r = runNode(HOOK('post-install'), z);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /inherited repo_url, stale_hours from openmax-kb/);
  assert.match(r.stdout, /Reused existing openmax-kb content clone/);
  assert.deepEqual(readCfg(z), { repo_url: `file://${upstream}`, stale_hours: 12 });
  assert.ok(fs.existsSync(path.join(dataDir(z), 'repo', '.git')));
  assert.ok(fs.existsSync(path.join(legacy, 'repo', '.git')), 'legacy clone must be left in place (copy, not move)');
  assert.ok(fs.existsSync(path.join(dataDir(z), 'index.json')));
  const state = JSON.parse(fs.readFileSync(path.join(dataDir(z), 'sync-state.json'), 'utf8'));
  assert.notEqual(state.last_pull, '2026-10-15T00:00:00.000Z', 'reused copy was pulled');
});

test('post-install with an unreachable repo stays non-fatal', () => {
  const z = tmpDir();
  fs.mkdirSync(dataDir(z), { recursive: true });
  fs.writeFileSync(path.join(dataDir(z), 'config.json'), JSON.stringify({ repo_url: path.join(tmpDir(), 'missing.git') }));
  const r = runNode(HOOK('post-install'), z);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /not yet cloned/);
});

test('pre-upgrade backs up config; post-upgrade drops `enabled`, coerces config, rebuilds index', () => {
  const z = tmpDir();
  const repo = makeContentRepo(MINI);
  fs.mkdirSync(dataDir(z), { recursive: true });
  fs.writeFileSync(path.join(dataDir(z), 'config.json'), JSON.stringify({ repo_url: repo, stale_hours: '24', enabled: true }));
  assert.equal(runKb(z, ['sync']).code, 0);
  fs.rmSync(path.join(dataDir(z), 'index.json'));
  assert.equal(runNode(HOOK('pre-upgrade'), z).code, 0);
  assert.ok(fs.existsSync(path.join(dataDir(z), 'config.json.backup')));
  const r = runNode(HOOK('post-upgrade'), z);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readCfg(z), { repo_url: repo, stale_hours: 24 });
  assert.ok(fs.existsSync(path.join(dataDir(z), 'index.json')));
});
