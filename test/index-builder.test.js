import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildIndex, writeIndex, readIndex, parseMarkdown, titleTerms, entryTerms, normalizeKeywords, displayTitle, INDEX_SCHEMA } from '../scripts/lib/index-builder.js';
import { MINI, makeContentRepo, tmpDir } from './helpers.js';

const byTitle = (idx, lang, prefix) => idx.sections.find(s => s.lang === lang && s.title.startsWith(prefix));

test('parseMarkdown: subtree byte ranges, parent path, Q&A bullets with category', () => {
  const text = fs.readFileSync(path.join(MINI, 'README-zh.md'), 'utf8');
  const { sections, qa } = parseMarkdown(text, 'README-zh.md', 'zh');
  const sub = sections.find(s => s.title === '2 订阅和套餐');
  const trial = sections.find(s => s.title.startsWith('试用期'));
  assert.ok(sub.start < trial.start && trial.end <= sub.end, 'child inside parent range');
  assert.equal(Buffer.from(text).subarray(trial.start, trial.end).toString().split('\n')[0], '### 试用期（Trial·高频）');
  assert.deepEqual(trial.path, ['第一部分 · 产品知识', '2 订阅和套餐']);
  assert.equal(qa.length, 3);
  assert.equal(qa[0].category, '价格 · 付费');
  assert.equal(qa[2].question, '积分怎么扣 / 会一直扣吗？');
});

test('titleTerms strips numbering, splits separators, drops digit chunks', () => {
  assert.deepEqual(titleTerms('5 Credit（积分）'), ['credit', '积分']);
  assert.deepEqual(titleTerms('试用期（Trial·高频）'), ['试用期', 'trial', '高频']);
  assert.deepEqual(titleTerms('Slack（约 3–5min）'), ['slack']);
  assert.ok(titleTerms('A · 产品是什么').includes('产品是什么'));
});

test('entryTerms accepts every documented shape', () => {
  assert.deepEqual(entryTerms(['a', 'b']), { strong: ['a', 'b'], weak: [] });
  assert.deepEqual(entryTerms({ strong: ['a'], weak: ['b'] }), { strong: ['a'], weak: ['b'] });
  assert.deepEqual(entryTerms({ zh: ['a'], en: ['b'] }), { strong: ['a', 'b'], weak: [] });
  assert.deepEqual(entryTerms({ zh: { strong: ['a'], weak: ['c'] }, en: { strong: ['b'] } }), { strong: ['a', 'b'], weak: ['c'] });
});

test('normalizeKeywords rejects documents without a sections mapping', () => {
  assert.throws(() => normalizeKeywords(null));
  assert.throws(() => normalizeKeywords({ version: 1 }));
  assert.throws(() => normalizeKeywords({ sections: ['x'] }));
  assert.deepEqual(normalizeKeywords({ sections: {}, synonyms: { 积分: ['Credit', 'credits'] } }).synonyms, [['积分', 'credit', 'credits']]);
});

test('with keywords.yml: source, strong/weak weights on both languages, unresolved keys, Q&A mapping', () => {
  const repo = makeContentRepo(MINI);
  const idx = buildIndex(repo);
  assert.equal(idx.schema, INDEX_SCHEMA);
  assert.equal(idx.source, 'keywords.yml');
  assert.match(idx.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(idx.unresolved_keys, ['No Such Section']);
  const zhTrial = byTitle(idx, 'zh', '试用期');
  const enTrial = byTitle(idx, 'en', 'Trial Period');
  assert.equal(zhTrial.counterpart, enTrial.id);
  assert.deepEqual(idx.inverted['绑卡'].map(p => p[0]).sort(), [zhTrial.id, enTrial.id].sort());
  assert.equal(idx.inverted['绑卡'][0][1], 4);
  assert.equal(idx.inverted['扣款'][0][1], 1.5);
  // prefix key "Credit" → "3 Credit（积分）" / "3 Credit (Credits)"
  assert.ok(idx.inverted['余额'].some(([id]) => id === byTitle(idx, 'zh', '3 Credit').id));
  // en: nested { strong, weak }
  assert.ok(idx.inverted['refund'].some(([id]) => id === byTitle(idx, 'en', 'Escalation').id));
  // Q&A: explicit 「订阅和套餐·试用期」 → trial; unreferenced 积分 category → Credit section by label
  assert.ok(zhTrial.qa.some(q => q.q.startsWith('试用会自动扣费吗')));
  assert.ok(byTitle(idx, 'zh', '3 Credit').qa.some(q => q.q.startsWith('积分怎么扣') && q.inferred));
  assert.ok(byTitle(idx, 'en', '3 Credit').qa.some(q => q.q.startsWith('How are Credits deducted')));
  // Changelog excluded; level-1 parts not retrievable; display title omits the part heading
  assert.equal(byTitle(idx, 'zh', '更新记录').retrievable, false);
  assert.ok(idx.sections.filter(s => s.level === 1).every(s => !s.retrievable));
  assert.equal(displayTitle(zhTrial), '2 订阅和套餐 · 试用期（Trial·高频）');
  assert.deepEqual(idx.synonyms, [['积分', 'credit', 'credits', '点数']]);
});

test('without keywords.yml: fallback source, title + seed terms still indexed', () => {
  const repo = makeContentRepo(MINI, { withKeywords: false });
  const idx = buildIndex(repo);
  assert.equal(idx.source, 'fallback');
  assert.equal(idx.keywords_error, 'missing');
  assert.ok(idx.inverted['积分'], 'title-derived term');
  assert.ok(idx.inverted['试用'], 'seed anchor term (試用期 anchor)');
  assert.equal(idx.inverted['绑卡']?.length ?? 0, 2, 'seed anchor 绑卡 on trial sections');
});

test('invalid keywords.yml: falls back and records the parse error', () => {
  const repo = makeContentRepo(MINI);
  fs.writeFileSync(path.join(repo, 'keywords.yml'), 'sections:\n  a: [unclosed\n');
  const idx = buildIndex(repo);
  assert.equal(idx.source, 'fallback');
  assert.match(idx.keywords_error, /unbalanced|unterminated/);
});

test('writeIndex is atomic (no temp files left) and readIndex round-trips; other schema → null', () => {
  const repo = makeContentRepo(MINI);
  const dir = tmpDir();
  const p = path.join(dir, 'index.json');
  const idx = writeIndex(repo, p);
  assert.deepEqual(fs.readdirSync(dir), ['index.json']);
  assert.equal(readIndex(p).commit, idx.commit);
  fs.writeFileSync(p, JSON.stringify({ ...idx, schema: 999 }));
  assert.equal(readIndex(p), null);
  fs.writeFileSync(p, '{broken');
  assert.equal(readIndex(p), null);
});
