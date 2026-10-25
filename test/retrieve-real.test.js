/**
 * Retrieval quality on a snapshot of the real content repo (test/fixtures/product-kb-snapshot):
 * every Q&A question (zh + en) must find its section (explicit 「…」/"…" reference, else the
 * section its category label names) in the top 2,
 * both with the draft keywords.yml and without any keywords.yml (fallback).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildIndex } from '../scripts/lib/index-builder.js';
import { retrieve } from '../scripts/lib/retrieve.js';
import { SNAPSHOT } from './helpers.js';

const within = (outer, inner) => outer.file === inner.file && outer.start <= inner.start && inner.end <= outer.end;

function qaHitRate(idx) {
  const questions = new Map(); // question → { lang, targets[] }
  for (const s of idx.sections) for (const qa of s.qa) {
    const k = `${s.lang}\u0000${qa.q}`;
    (questions.get(k) || questions.set(k, { q: qa.q, lang: s.lang, targets: [] }).get(k)).targets.push(s);
  }
  let hit = 0;
  const misses = [];
  for (const { q, lang, targets } of questions.values()) {
    const got = retrieve(idx, q, { lang }).results.map(r => r.section);
    if (got.some(g => targets.some(t => within(t, g) || within(g, t)))) hit++;
    else misses.push(`${q} → ${got.map(g => g.title).join(' | ') || 'NONE'}`);
  }
  return { hit, total: questions.size, misses };
}

const variants = [
  ['draft keywords.yml', { keywordsPath: path.join(SNAPSHOT, 'keywords.draft.yml') }, 0.95],
  ['fallback (no keywords.yml)', { keywordsPath: path.join(SNAPSHOT, 'missing.yml') }, 0.9]
];

for (const [label, opts, minRate] of variants) {
  test(`[${label}] Q&A questions retrieve their referenced section in the top 2`, () => {
    const idx = buildIndex(SNAPSHOT, { ...opts, commit: 'snapshot' });
    assert.equal(idx.stats.qa_unmapped, 0, 'every Q&A bullet maps to a section');
    if (label.startsWith('draft')) assert.deepEqual(idx.unresolved_keys, [], 'draft keys all resolve');
    const { hit, total, misses } = qaHitRate(idx);
    assert.ok(total >= 60, `expected ≥60 zh+en Q&A questions, got ${total}`);
    assert.ok(hit / total >= minRate, `${hit}/${total}\n${misses.join('\n')}`);
  });
}

test('real-content spot checks (zh + en, incl. a not-covered question)', () => {
  const idx = buildIndex(SNAPSHOT, { keywordsPath: path.join(SNAPSHOT, 'keywords.draft.yml'), commit: 'snapshot' });
  const first = (q) => retrieve(idx, q).results[0]?.section.title || 'NONE';
  assert.equal(first('积分怎么扣'), '5 Credit（积分）');
  assert.equal(first('试用会自动扣费吗'), '试用期（Trial·高频）');
  assert.equal(first('能开发票吗'), '使用限制 / 暂不支持（对客可答）');
  assert.match(first('怎么接企业微信'), /^企业微信/);
  assert.equal(first('How are credits deducted?'), '5 Credit (Credits)');
  assert.match(first('Is there a free trial?'), /^Trial Period/);
  assert.equal(first('今天天气怎么样'), 'NONE');
});

for (const [label, opts] of variants) {
  test(`[${label}] regressions: settings / What is OpenMax? hit; unrelated questions miss`, () => {
    const idx = buildIndex(SNAPSHOT, { ...opts, commit: 'snapshot' });
    const first = (q) => retrieve(idx, q).results[0]?.section.title || 'NONE';
    assert.match(first('settings'), /^Account & Settings/);
    assert.match(first('How do I change settings?'), /^Account & Settings/);
    assert.equal(first('What is OpenMax?'), 'A · What the Product Is');
    assert.equal(first('what is openmax'), 'A · What the Product Is');
    assert.equal(first('OpenMax 是什么'), 'A · 产品是什么');
    assert.match(first('账号设置在哪里'), /^账户与设置/);
    for (const q of ['What is the weather today?', 'How do I cook pasta?', 'What can I cook for dinner?',
      'How to use chopsticks?', '今天天气怎么样']) assert.equal(first(q), 'NONE', q);
  });
}
