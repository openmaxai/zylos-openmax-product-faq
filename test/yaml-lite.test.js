import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, YamlError } from '../scripts/lib/yaml-lite.js';

test('maps, nested maps, block and flow lists, quotes, comments', () => {
  const doc = parseYaml(`# header
version: 1
synonyms:
  积分: [credit, "top up", 'it''s']   # trailing comment
sections:
  "5 Credit（积分）":
    strong: [积分, 扣费]
    weak:
      - 余额
      - "a # not comment"
  'Escalation': { zh: [退款], en: { strong: [refund], weak: [contract] } }
  multi: [a,
          b]
  empty:
`);
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.synonyms['积分'], ['credit', 'top up', "it's"]);
  assert.deepEqual(doc.sections['5 Credit（积分）'], { strong: ['积分', '扣费'], weak: ['余额', 'a # not comment'] });
  assert.deepEqual(doc.sections.Escalation, { zh: ['退款'], en: { strong: ['refund'], weak: ['contract'] } });
  assert.deepEqual(doc.sections.multi, ['a', 'b']);
  assert.equal(doc.sections.empty, null);
});

test('sequence at the same indent as its key', () => {
  assert.deepEqual(parseYaml('k:\n- a\n- b\n'), { k: ['a', 'b'] });
});

test('unsupported / invalid YAML throws YamlError', () => {
  for (const bad of [
    'a: [1, 2',
    'a: |\n  text',
    'a: &x 1',
    'a: 1\na: 2',
    'a:\n  - k: v',
    'a: 1\n   b: 2',
    'a:\tb'.replace(':', ':\n') // tab indentation
  ]) {
    assert.throws(() => parseYaml(bad), YamlError, bad);
  }
});

test('empty document → null', () => {
  assert.equal(parseYaml('# only a comment\n'), null);
});
