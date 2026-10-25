import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../scripts/lib/index-builder.js';
import { retrieve, formatAsk, MAX_SECTION_CHARS } from '../scripts/lib/retrieve.js';
import { detectLang, termPresent, prepareQuery, stripNumbering } from '../scripts/lib/text.js';
import { MINI, makeContentRepo } from './helpers.js';

const titles = (r) => r.results.map(x => x.section.title);

test('detectLang: CJK majority → zh; brand names do not flip a Chinese question', () => {
  assert.equal(detectLang('积分怎么扣'), 'zh');
  assert.equal(detectLang('OpenMax 积分怎么扣'), 'zh');
  assert.equal(detectLang('How are credits deducted?'), 'en');
});

test('termPresent: CJK substring, Latin stems (credits ~ credit), phrases need all words', () => {
  const q = prepareQuery('Do I need a credit card for the trial?');
  assert.ok(termPresent('credits', q));
  assert.ok(termPresent('credit card', q));
  assert.ok(!termPresent('credit pack', q));
  assert.ok(termPresent('试用', prepareQuery('试用会自动扣费吗')));
});

test('stripNumbering only strips real numbering', () => {
  assert.equal(stripNumbering('5 Credit（积分）'), 'Credit（积分）');
  assert.equal(stripNumbering('2.1 员工类型'), '员工类型');
  assert.equal(stripNumbering('A · 产品是什么'), '产品是什么');
  assert.equal(stripNumbering('Subscriptions and Plans'), 'Subscriptions and Plans');
  assert.equal(stripNumbering('Slack (~3–5 min)'), 'Slack (~3–5 min)');
});

for (const withKeywords of [true, false]) {
  const label = withKeywords ? 'keywords.yml' : 'fallback';
  test(`[${label}] questions map to their section (zh + en)`, () => {
    const idx = buildIndex(makeContentRepo(MINI, { withKeywords }));
    const cases = [
      ['试用会自动扣费吗', '试用期（Trial·高频）'],
      ['积分怎么扣', '3 Credit（积分）'],
      ['怎么关掉自动续费', '自动续费 / 到期宽限'],
      ['Will the trial charge my card?', 'Trial Period (High Frequency)'],
      ['How are credits deducted?', '3 Credit (Credits)']
    ];
    for (const [q, want] of cases) {
      const r = retrieve(idx, q);
      assert.equal(titles(r)[0], want, `${q} → ${titles(r).join(' | ')}`);
    }
  });
}

test('synonyms: an English term in a Chinese question reaches the zh section', () => {
  const idx = buildIndex(makeContentRepo(MINI));
  const r = retrieve(idx, '我的 credits 还剩多少');
  assert.equal(r.lang, 'zh');
  assert.equal(titles(r)[0], '3 Credit（积分）');
});

test('unrelated questions → no section', () => {
  const idx = buildIndex(makeContentRepo(MINI));
  for (const q of ['今天天气怎么样', 'What is the capital of France?', '帮我写一首诗']) {
    assert.deepEqual(retrieve(idx, q).results, [], q);
  }
});

test('--top bounds and --lang override', () => {
  const idx = buildIndex(makeContentRepo(MINI));
  assert.ok(retrieve(idx, '试用 积分 续费 退款', { top: 9 }).results.length <= 3);
  assert.equal(retrieve(idx, '试用 积分 续费', { top: 1 }).results.length, 1);
  assert.equal(retrieve(idx, 'trial', { lang: 'zh' }).lang, 'zh');
});

test('formatAsk: zh citation header, Q&A line, section text; no-match guidance', () => {
  const repo = makeContentRepo(MINI);
  const idx = buildIndex(repo);
  const out = formatAsk(idx, repo, retrieve(idx, '试用会自动扣费吗'), { lastPull: '2026-10-25T00:00:00.000Z' });
  assert.match(out, /^## 来源：《2 订阅和套餐 · 试用期（Trial·高频）》（commit [0-9a-f]{7} · 同步于 2026-10-25T00:00:00Z）$/m);
  assert.match(out, /^> Q&A（第 \d+ 行）："试用会自动扣费吗/m);
  assert.match(out, /^### 试用期（Trial·高频）$/m);
  assert.match(out, /绑卡不扣款/);
  const en = formatAsk(idx, repo, retrieve(idx, 'Will the trial charge my card?'), {});
  assert.match(en, /^## Source: "2 Subscriptions and Plans · Trial Period \(High Frequency\)"/m);
  const none = formatAsk(idx, repo, { lang: 'zh', results: [] });
  assert.match(none, /^No matching section\./);
  assert.match(none, /contact@openmax\.com/);
});

test('formatAsk truncates a section over 4,000 chars and points to kb.js cat', () => {
  const repo = makeContentRepo(MINI, { longText: '积分说明'.repeat(1500) });
  const idx = buildIndex(repo);
  const out = formatAsk(idx, repo, retrieve(idx, '积分怎么扣'), {});
  assert.match(out, new RegExp(`\\[truncated at ${MAX_SECTION_CHARS} chars — full section: kb\\.js cat README-zh\\.md \\(lines \\d+-\\d+\\)\\]`));
});
