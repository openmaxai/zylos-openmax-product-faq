import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

function skillVersion(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const m = fm && /^version:\s*["']?([^"'\s]+)["']?\s*$/m.exec(fm[1]);
  return m ? m[1] : null;
}

function changelogVersion(text) {
  const m = /^## \[(\d+\.\d+\.\d+[^\]]*)\]/m.exec(text);
  return m ? m[1] : null;
}

/** Returns a list of mismatches between the four version faces. */
export function versionMismatches(faces) {
  const ref = faces.package;
  const out = [];
  for (const [k, v] of Object.entries(faces)) if (v !== ref) out.push(`${k}=${v} (package.json=${ref})`);
  return out;
}

function readFaces(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return {
    package: pkg.version,
    lock: lock.version,
    lockRoot: lock.packages?.['']?.version,
    skill: skillVersion(fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8')),
    changelog: changelogVersion(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'))
  };
}

test('package.json / package-lock.json / SKILL.md / CHANGELOG.md versions agree', () => {
  const faces = readFaces(ROOT);
  assert.deepEqual(versionMismatches(faces), [], JSON.stringify(faces));
});

test('package names agree with the component name', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.name, 'zylos-openmax-product-faq');
  assert.equal(lock.name, pkg.name);
});

test('negative control: a drifted face is reported', () => {
  const faces = { package: '0.2.0', lock: '0.2.0', lockRoot: '0.2.0', skill: '0.1.0', changelog: '0.2.0' };
  assert.equal(versionMismatches(faces).length, 1);
  assert.match(versionMismatches(faces)[0], /^skill=0\.1\.0/);
  assert.equal(changelogVersion('## [Unreleased]\n\n## [1.2.3] - 2026-01-01\n'), '1.2.3');
  assert.equal(skillVersion('---\nname: x\nversion: 9.9.9\n---\n'), '9.9.9');
});
