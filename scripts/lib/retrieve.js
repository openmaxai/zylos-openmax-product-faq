/**
 * retrieve — score KB sections against a user question using the prebuilt index.
 *
 * score(section) = Σ weight(term) × lengthFactor(term)       for index terms present in the question
 *                + QA_WEIGHT × best similarity to an attached Q&A question
 *                + TITLE_OVERLAP × shared bigrams / words with the section title
 *
 * Synonym groups from keywords.yml expand the question before matching.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CJK_RE, normalize, prepareQuery, termPresent, tokenSet, detectLang, stripNumbering, latinWords } from './text.js';
import { displayTitle } from './index-builder.js';

export const MAX_SECTION_CHARS = 4000;
export const MIN_SCORE = 3;
const QA_WEIGHT = 6;
const QA_MIN_SIM = 0.34;
const TITLE_OVERLAP = 1;
const MAX_TOP = 3;

function lengthFactor(term) {
  if (CJK_RE.test(term)) return 1 + 0.25 * (Math.min(term.length, 6) - 2);
  return 1 + 0.25 * (Math.min(term.split(/\s+/).length, 3) - 1);
}

function overlap(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export function expandSynonyms(text, groups = []) {
  const norm = normalize(text);
  const probe = prepareQuery(norm);
  const extra = [];
  for (const g of groups) {
    if (g.some(t => termPresent(t, probe))) extra.push(...g);
  }
  return extra.length ? `${norm} ${extra.join(' ')}` : norm;
}

function qaSimilarity(query, qaQuestion) {
  // A Q&A entry may hold several phrasings separated by "/".
  let best = 0;
  const whole = tokenSet(qaQuestion).size;
  for (const variant of qaQuestion.split(/\s*[/／]\s*/)) {
    const toks = tokenSet(variant);
    if (toks.size === 0) continue;
    const hit = overlap(toks, query.tokens);
    if (hit === 0) continue;
    // Require 2 shared tokens unless the question is tiny ("多少钱", "Can I get an invoice?");
    // a one-token fragment of a longer question ("Is my data / …") is not enough.
    if (hit < 2 && (toks.size > 1 || whole > 2)) continue;
    best = Math.max(best, hit / toks.size);
  }
  return best;
}

/** Score every retrievable section in `lang`. Returns sorted candidates. */
export function scoreSections(index, question, lang) {
  const query = prepareQuery(expandSynonyms(question, index.synonyms));
  const original = prepareQuery(question);
  const scores = new Map();
  const matched = new Map();
  const bump = (id, v, why) => {
    scores.set(id, (scores.get(id) || 0) + v);
    if (why) (matched.get(id) || matched.set(id, new Set()).get(id)).add(why);
  };

  // Members of one synonym group are one concept: count the best of them once per section.
  const concept = new Map();
  (index.synonyms || []).forEach((g, gi) => {
    for (const t of g) {
      const key = CJK_RE.test(t) ? t : latinWords(t).join(' ');
      if (key && !concept.has(key)) concept.set(key, `syn:${gi}`);
    }
  });
  const best = new Map(); // `${id}\0${concept}` → [value, term]
  for (const [term, postings] of Object.entries(index.inverted)) {
    if (!termPresent(term, query)) continue;
    const f = lengthFactor(term);
    const c = concept.get(term) || term;
    for (const [id, w] of postings) {
      const k = `${id}\u0000${c}`;
      const prev = best.get(k);
      if (!prev || prev[0] < w * f) best.set(k, [w * f, term]);
    }
  }
  for (const [k, [v, term]] of best) bump(Number(k.slice(0, k.indexOf('\u0000'))), v, term);

  const out = [];
  for (const s of index.sections) {
    if (!s.retrievable || s.lang !== lang) continue;
    let score = scores.get(s.id) || 0;
    const titleTok = tokenSet(stripNumbering(s.title));
    score += TITLE_OVERLAP * overlap(titleTok, original.tokens);
    const qaHits = [];
    let bestSim = 0;
    for (const qa of s.qa) {
      const sim = qaSimilarity(original, qa.q);
      if (sim >= QA_MIN_SIM) qaHits.push({ ...qa, sim });
      bestSim = Math.max(bestSim, sim >= QA_MIN_SIM ? sim : 0);
    }
    score += QA_WEIGHT * bestSim;
    if (score <= 0) continue;
    qaHits.sort((a, b) => b.sim - a.sim);
    out.push({ section: s, score, matched: [...(matched.get(s.id) || [])], qa: qaHits });
  }
  out.sort((a, b) =>
    b.score - a.score ||
    b.section.level - a.section.level ||
    (a.section.end - a.section.start) - (b.section.end - b.section.start));
  return out;
}

function nested(a, b) {
  return a.file === b.file && ((a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end));
}

function isAncestor(a, d) {
  return a.file === d.file && a.start <= d.start && d.end <= a.end && a.id !== d.id;
}

/**
 * A parent section (e.g. "3 IM 渠道连接") often wins on a Q&A match while a child
 * ("企业微信") holds the specific answer. Prefer the best descendant that matched an
 * index term the parent did not; carry the parent's Q&A hits along.
 */
function narrowToDescendant(c, candidates) {
  const own = new Set(c.matched);
  let best = null;
  for (const d of candidates) {
    if (!isAncestor(c.section, d.section)) continue;
    if (d.score < MIN_SCORE || d.score < c.score * 0.35) continue;
    if (!d.matched.some(t => !own.has(t))) continue;
    if (!best || d.score > best.score) best = d;
  }
  if (!best) return c;
  const qa = [...best.qa, ...c.qa.filter(q => !best.qa.some(b => b.line === q.line))].sort((a, b) => b.sim - a.sim);
  return { ...best, qa, score: Math.max(best.score, c.score) };
}

/**
 * Pick the top sections for a question.
 * opts: { lang?: 'zh'|'en', top?: number (1..3, default 2) }
 */
export function retrieve(index, question, opts = {}) {
  const top = Math.max(1, Math.min(MAX_TOP, Number(opts.top) || 2));
  const lang = opts.lang === 'zh' || opts.lang === 'en' ? opts.lang : detectLang(question);
  let candidates = scoreSections(index, question, lang);
  let usedLang = lang;
  if ((!candidates.length || candidates[0].score < MIN_SCORE) && !opts.lang) {
    // A Chinese question may only hit English anchors (or vice versa): try the other file.
    const other = lang === 'zh' ? 'en' : 'zh';
    const alt = scoreSections(index, question, other);
    if (alt.length && alt[0].score >= MIN_SCORE) { candidates = alt; usedLang = other; }
  }
  const picked = [];
  for (let c of candidates) {
    if (c.score < MIN_SCORE) break;
    if (picked.some(p => nested(p.section, c.section))) continue;
    // Keep a weak runner-up out: it must reach 40% of the best score.
    if (picked.length && c.score < picked[0].score * 0.4) break;
    c = narrowToDescendant(c, candidates);
    if (picked.some(p => nested(p.section, c.section))) continue;
    picked.push(c);
    if (picked.length >= top) break;
  }
  return { lang: usedLang, results: picked };
}

export function readSlice(repoDir, file, start, end) {
  const fd = fs.openSync(path.join(repoDir, file), 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, end - start));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function shortCommit(c) {
  return c ? String(c).slice(0, 7) : 'unknown';
}

/** Render ask output (plain text / markdown) for the agent. */
export function formatAsk(index, repoDir, result, meta = {}) {
  const lines = [];
  const zh = result.lang === 'zh';
  if (result.results.length === 0) {
    lines.push('No matching section.');
    lines.push('');
    lines.push('Next: try `kb.js search "<keyword>"` with a distinctive word from the question (product name, plan, channel, error text).');
    lines.push('If the KB still does not cover it: tell the user you are not certain and give contact@openmax.com. Do not answer from memory and never claim you have transferred them to support.');
    return lines.join('\n') + '\n';
  }
  const synced = meta.lastPull ? meta.lastPull.replace(/\.\d+Z$/, 'Z') : 'unknown';
  for (const r of result.results) {
    const s = r.section;
    const title = displayTitle(s);
    lines.push(zh
      ? `## 来源：《${title}》（commit ${shortCommit(index.commit)} · 同步于 ${synced}）`
      : `## Source: "${title}" (commit ${shortCommit(index.commit)} · synced ${synced})`);
    lines.push(`<!-- ${s.file} lines ${s.line_start}-${s.line_end} · score ${r.score.toFixed(1)}${r.matched.length ? ' · matched: ' + r.matched.slice(0, 8).join(', ') : ''} -->`);
    for (const qa of r.qa.slice(0, 2)) {
      if (qa.sim < 0.5) continue;
      const text = readSlice(repoDir, s.file, qa.start, qa.end).trim();
      lines.push(zh ? `> Q&A（第 ${qa.line} 行）：${text.replace(/^[-*]\s+/, '')}` : `> Q&A (line ${qa.line}): ${text.replace(/^[-*]\s+/, '')}`);
    }
    let body = readSlice(repoDir, s.file, s.start, s.end).replace(/\s+$/, '');
    let truncated = false;
    if (body.length > MAX_SECTION_CHARS) {
      body = body.slice(0, MAX_SECTION_CHARS);
      truncated = true;
    }
    lines.push('');
    lines.push(body);
    if (truncated) {
      lines.push('');
      lines.push(`[truncated at ${MAX_SECTION_CHARS} chars — full section: kb.js cat ${s.file} (lines ${s.line_start}-${s.line_end})]`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
