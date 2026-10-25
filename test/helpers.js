import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KB_JS = path.join(ROOT, 'scripts', 'kb.js');
export const MINI = path.join(ROOT, 'test', 'fixtures', 'mini');
export const SNAPSHOT = path.join(ROOT, 'test', 'fixtures', 'product-kb-snapshot');

export function tmpDir(prefix = 'faq-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Copy a fixture dir into a fresh git repo (optionally replacing LONGTEXT). Returns its path. */
export function makeContentRepo(fixture = MINI, { longText = '', withKeywords = true } = {}) {
  const dir = tmpDir('faq-content-');
  for (const f of fs.readdirSync(fixture)) {
    if (!withKeywords && f === 'keywords.yml') continue;
    let text = fs.readFileSync(path.join(fixture, f), 'utf8');
    text = text.replace('LONGTEXT', longText || 'short');
    fs.writeFileSync(path.join(dir, f), text);
  }
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', env: gitEnv() });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return dir;
}

export function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com'
  };
}

/** A fresh ZYLOS_DIR with config pointing at repoUrl. */
export function makeZylos(repoUrl, extraConfig = {}) {
  const z = tmpDir('faq-zylos-');
  const data = path.join(z, 'components', 'openmax-product-faq');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ repo_url: repoUrl, stale_hours: 24, ...extraConfig }));
  return { zylosDir: z, dataDir: data };
}

export function runKb(zylosDir, args, opts = {}) {
  const r = spawnSync(process.execPath, [KB_JS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ZYLOS_DIR: zylosDir, ...(opts.env || {}) },
    timeout: 60000
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function runNode(script, zylosDir, { input, env } = {}) {
  const r = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input,
    env: { ...process.env, ZYLOS_DIR: zylosDir, ...(env || {}) },
    timeout: 90000
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
