import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MINI, makeContentRepo, makeZylos, runKb, tmpDir, gitEnv } from './helpers.js';

function freshInstall() {
  const repo = makeContentRepo(MINI);
  const z = makeZylos(repo);
  const r = runKb(z.zylosDir, ['sync']);
  assert.equal(r.code, 0, r.stderr);
  return { repo, ...z };
}

const makeStale = (dataDir) => fs.writeFileSync(path.join(dataDir, 'sync-state.json'), JSON.stringify({ last_pull: '2020-01-01T00:00:00.000Z' }));

test('--help lists every command; unknown command exits 1', () => {
  const r = runKb(tmpDir(), ['--help']);
  assert.equal(r.code, 0);
  for (const c of ['ask', 'search', 'cat', 'ls', 'status', 'sync', 'index']) assert.match(r.stdout, new RegExp(`^  ${c}\\b`, 'm'));
  assert.equal(runKb(tmpDir(), ['nope']).code, 1);
});

test('sync clones, writes state and builds the index; status reports it', () => {
  const { dataDir, zylosDir } = freshInstall();
  assert.ok(fs.existsSync(path.join(dataDir, 'repo', '.git')));
  assert.ok(fs.existsSync(path.join(dataDir, 'index.json')));
  assert.ok(!fs.readdirSync(dataDir).some(f => f.includes('.tmp')), 'no temp leftovers');
  const st = runKb(zylosDir, ['status']);
  assert.match(st.stdout, /Cloned:\s+yes/);
  assert.match(st.stdout, /Index:\s+built at .* keywords\.yml: yes/);
  assert.match(st.stdout, /Unresolved keywords\.yml keys: No Such Section/);
  const again = runKb(zylosDir, ['sync']);
  assert.match(again.stdout, /Local copy is fresh/);
});

test('ask prints the cited section on stdout (progress on stderr) and exits 0', () => {
  const { zylosDir } = freshInstall();
  makeStale(path.join(zylosDir, 'components', 'openmax-product-faq'));
  const r = runKb(zylosDir, ['ask', '试用会自动扣费吗']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^## 来源：《2 订阅和套餐 · 试用期（Trial·高频）》/);
  assert.match(r.stderr, /Pulling latest/);
  assert.doesNotMatch(r.stdout, /Pulling|Local copy/);
  const none = runKb(zylosDir, ['ask', '今天天气怎么样']);
  assert.equal(none.code, 0);
  assert.match(none.stdout, /^No matching section\./);
  const en = runKb(zylosDir, ['ask', '--lang', 'en', '--top', '1', '试用']);
  assert.match(en.stdout, /^## Source: "2 Subscriptions and Plans · Trial Period/);
  assert.equal(runKb(zylosDir, ['ask']).code, 1);
  assert.equal(runKb(zylosDir, ['ask', 'x', '--lang', 'fr']).code, 1);
});

test('ask rebuilds a missing or outdated index on demand', () => {
  const { zylosDir, dataDir } = freshInstall();
  const idxPath = path.join(dataDir, 'index.json');
  fs.rmSync(idxPath);
  assert.match(runKb(zylosDir, ['ask', '积分怎么扣']).stdout, /来源：《3 Credit（积分）》/);
  assert.ok(fs.existsSync(idxPath));
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  fs.writeFileSync(idxPath, JSON.stringify({ ...idx, commit: 'old' }));
  runKb(zylosDir, ['ask', '积分怎么扣']);
  assert.notEqual(JSON.parse(fs.readFileSync(idxPath, 'utf8')).commit, 'old');
});

test('sync after an upstream change pulls and rebuilds the index', () => {
  const { repo, zylosDir, dataDir } = freshInstall();
  fs.appendFileSync(path.join(repo, 'README-zh.md'), '\n## 新功能 · 语音通话\n- 支持语音通话。\n');
  fs.appendFileSync(path.join(repo, 'README.md'), '\n## New Feature · Voice Calls\n- Voice calls are supported.\n');
  execFileSync('git', ['commit', '-qam', 'more'], { cwd: repo, env: gitEnv() });
  const r = runKb(zylosDir, ['sync', '--force']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Pull complete\.\nIndex rebuilt: \d+ sections/);
  assert.match(runKb(zylosDir, ['ask', '支持语音通话吗']).stdout, /来源：《新功能 · 语音通话》/);
  assert.ok(fs.existsSync(path.join(dataDir, 'index.json')));
});

test('pull failure degrades to the local copy: warning on stderr, exit 0, last_pull unchanged', () => {
  const { zylosDir, dataDir } = freshInstall();
  // Point the clone's remote at an unreachable path and make the copy stale.
  execFileSync('git', ['remote', 'set-url', 'origin', path.join(tmpDir(), 'gone.git')], { cwd: path.join(dataDir, 'repo') });
  makeStale(dataDir);
  for (const args of [['search', '绑卡'], ['ask', '试用会自动扣费吗'], ['cat', 'README.md'], ['ls']]) {
    const r = runKb(zylosDir, args);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /warning: KB sync failed, using local copy from 2020-01-01T00:00:00\.000Z/);
    assert.ok(r.stdout.length > 0);
  }
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'sync-state.json'), 'utf8'));
  assert.equal(state.last_pull, '2020-01-01T00:00:00.000Z');
  assert.ok(state.last_error);
  assert.match(runKb(zylosDir, ['status']).stdout, /Last error:/);
});

test('no local copy and unreachable repo → clone error, exit 1, no half-clone left', () => {
  const { zylosDir, dataDir } = makeZylos(path.join(tmpDir(), 'does-not-exist.git'));
  const r = runKb(zylosDir, ['ask', '积分']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /KB clone failed/);
  assert.ok(!fs.existsSync(path.join(dataDir, 'repo')));
  assert.ok(!fs.readdirSync(dataDir).some(f => f.startsWith('repo.tmp')));
});

test('search: no shell interpretation, no-match message', () => {
  const { zylosDir } = freshInstall();
  assert.match(runKb(zylosDir, ['search', '绑卡']).stdout, /^\.\/README-zh\.md:\d+:/m);
  assert.equal(runKb(zylosDir, ['search', '$(touch /tmp/should-not-exist-faq)']).stdout.trim(), 'No matches found.');
  assert.ok(!fs.existsSync('/tmp/should-not-exist-faq'));
});

test('cat / ls refuse paths outside the repo (incl. sibling-prefix and .git)', () => {
  const { zylosDir, dataDir } = freshInstall();
  fs.mkdirSync(path.join(dataDir, 'repo-evil'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'repo-evil', 'x.md'), 'secret');
  for (const p of ['../config.json', '../repo-evil/x.md', '/etc/passwd', '.git/config']) {
    const r = runKb(zylosDir, ['cat', p]);
    assert.equal(r.code, 1, p);
    assert.doesNotMatch(r.stdout, /secret|repo_url/);
  }
  assert.equal(runKb(zylosDir, ['ls', '..']).code, 1);
  assert.match(runKb(zylosDir, ['cat', 'README.md']).stdout, /^# Test Product/);
});

test('index command rebuilds; without a clone it errors', () => {
  const { zylosDir } = freshInstall();
  assert.match(runKb(zylosDir, ['index']).stdout, /^Index rebuilt: \d+ sections, \d+ terms, source=keywords\.yml \(1 unresolved/);
  assert.equal(runKb(makeZylos('x').zylosDir, ['index']).code, 1);
});
