import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, KB_JS } from './helpers.js';

const SKILL = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
const FM = /^---\n([\s\S]*?)\n---/.exec(SKILL)[1];
const BODY = SKILL.slice(SKILL.indexOf('\n---', 4) + 4);

function fmScalar(key) {
  const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(FM);
  return m ? m[1].trim() : null;
}

function description() {
  const m = /^description:\s*>-?\n((?:[ \t]+.*\n?)+)/m.exec(FM);
  return m[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ');
}

/** Subcommands listed by `kb.js --help` (first word of each "Commands:" entry). */
export function helpCommands(helpText) {
  const after = helpText.split(/^Commands:\s*$/m)[1] || '';
  const out = [];
  for (const line of after.split('\n')) {
    const m = /^ {2}([a-z][\w-]*)/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Commands documented in the SKILL.md "## Commands" table (first cell, backticked). */
export function tableCommands(body) {
  const sec = body.split(/^## Commands\s*$/m)[1]?.split(/^## /m)[0] || '';
  const out = [];
  for (const line of sec.split('\n')) {
    const m = /^\|\s*`([a-z][\w-]*)/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

test('frontmatter name matches the component / skill directory name', () => {
  assert.equal(fmScalar('name'), 'openmax-product-faq');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // zylos-core derives the component name from the repo name minus "zylos-".
  assert.equal(pkg.name.replace(/^zylos-/, ''), fmScalar('name'));
  assert.match(FM, /^ {2}repo: openmaxai\/zylos-openmax-product-faq$/m);
  assert.match(FM, /^ {2}data_dir: ~\/zylos\/components\/openmax-product-faq$/m);
});

test('description: ≤1024 chars, strong check-first wording, Workspace KB exclusion, Chinese triggers', () => {
  const d = description();
  assert.ok(d.length <= 1024, `description is ${d.length} chars`);
  assert.match(d, /MUST be checked here\s+first/);
  assert.match(d, /never answer them from memory/);
  assert.match(d, /Not the org's own Workspace KnowledgeBase/);
  for (const w of ['积分', '套餐', '价格', '多少钱', '试用', '续费', '退款', '发票', '数字员工', '飞书', '企业微信', '钉钉', '报错']) {
    assert.ok(d.includes(w), `missing Chinese trigger ${w}`);
  }
});

test('config uses the OPENMAX_FAQ_ prefix', () => {
  assert.match(FM, /name: OPENMAX_FAQ_REPO_URL/);
  assert.match(FM, /name: OPENMAX_FAQ_STALE_HOURS/);
  assert.doesNotMatch(FM, /name: OPENMAX_KB_/);
});

test('answering rules: check first via ask, cite, contact@openmax.com, no fake handoff', () => {
  const rules = BODY.split(/^## Answering rules \(mandatory\)\s*$/m)[1].split(/^## /m)[0];
  assert.match(rules, /kb\.js ask "<the user's question>"/);
  assert.match(rules, /来源：OpenMax 产品知识库/);
  assert.match(rules, /contact@openmax\.com/);
  assert.match(rules, /Never say "I've transferred you/);
  assert.match(BODY, /Formerly named `openmax-kb`/);
});

test('every `kb.js --help` subcommand appears in the SKILL.md Commands table', () => {
  const help = execFileSync(process.execPath, [KB_JS, '--help'], { encoding: 'utf8' });
  const cmds = helpCommands(help);
  assert.deepEqual(cmds.sort(), ['ask', 'cat', 'index', 'ls', 'search', 'status', 'sync']);
  const table = tableCommands(BODY);
  for (const c of cmds) assert.ok(table.includes(c), `SKILL.md Commands table is missing \`${c}\``);
  for (const c of table) assert.ok(cmds.includes(c), `SKILL.md documents \`${c}\` which --help does not list`);
  // ask is the documented default first step.
  assert.equal(table[0], 'ask');
});

test('negative control: the table check detects a missing command', () => {
  const body = '## Commands\n\n| Command | x |\n|---|---|\n| `ask "<q>"` | y |\n\n## Next\n';
  assert.deepEqual(tableCommands(body), ['ask']);
  assert.deepEqual(helpCommands('Usage\n\nCommands:\n  ask "<q>"  x\n                    Options: y\n  ls [path]  z\n'), ['ask', 'ls']);
});
