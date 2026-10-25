/**
 * index-builder — split the KB markdown into sections and build the keyword index
 * used by `kb.js ask`.
 *
 * Sources of terms, merged per section:
 *   1. keywords.yml in the content repo (strong / weak terms per section title,
 *      plus global synonyms) — when present and valid
 *   2. section-title-derived terms (always)
 *   3. Q&A questions from the "Q&A" part, attached to the section they point to
 *      (「…」 / "…" references, else the category's majority target)
 *   4. built-in seed anchors (scripts/seed-keywords.json)
 *
 * The index is written atomically to <dataDir>/index.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml-lite.js';
import { CJK_RE, normalize, stripNumbering, titleKey, latinWords, countCjk, tokenSet } from './text.js';
import { writeJsonAtomic } from './paths.js';

export const INDEX_SCHEMA = 1;
export const KEYWORDS_FILE = 'keywords.yml';
const MAX_TITLE_DF = 3;

export const WEIGHTS = Object.freeze({
  strong: 4,
  title: 3,
  seed: 3,
  weak: 1.5
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEED_PATH = path.join(HERE, '..', 'seed-keywords.json');

export function loadSeed(seedPath = SEED_PATH) {
  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch {
    return { anchors: [], exclude_titles: [] };
  }
}

function langOfFile(name, text) {
  if (/-zh\.md$/i.test(name) || /\.zh\.md$/i.test(name)) return 'zh';
  if (/^readme\.md$/i.test(name)) return 'en';
  const cjk = countCjk(text);
  return cjk > text.length * 0.1 ? 'zh' : 'en';
}

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const QA_BULLET_RE = /^\s*[-*]\s+(.+?)\s*(?:→|->|=>)\s*(.*)$/;

/**
 * Parse one markdown file into sections. Byte offsets refer to the UTF-8 file.
 * Returns { sections, qa } where qa are Q&A bullets (not yet resolved).
 */
export function parseMarkdown(text, file, lang) {
  const lines = text.split('\n');
  const headings = [];
  const qa = [];
  let offset = 0;
  let inFence = false;
  let qaPart = false;
  let category = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const len = Buffer.byteLength(line, 'utf8') + (i < lines.length - 1 ? 1 : 0);
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (m) {
      const level = m[1].length;
      headings.push({ level, title: m[2].trim(), start: offset, line: i + 1 });
      if (level === 1) qaPart = /q\s*&\s*a/i.test(normalize(m[2]));
      category = '';
    } else if (qaPart && !inFence) {
      const b = QA_BULLET_RE.exec(line);
      if (b && /^\s*[-*]\s+["“「'‘]/.test(line)) {
        qa.push({ file, lang, category, question: cleanQuestion(b[1]), answer: b[2], line: i + 1, start: offset, end: offset + len });
      } else if (line.trim() && !/^\s*[>\-*|]/.test(line) && !/^-{3,}$/.test(line.trim())) {
        category = line.trim();
      }
    }
    offset += len;
  }
  const totalBytes = offset;
  const totalLines = lines.length;

  const sections = headings.map((h, idx) => {
    // A section spans its whole subtree: up to the next heading of the same or a higher level.
    let end = totalBytes;
    let lineEnd = totalLines;
    for (let j = idx + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) { end = headings[j].start; lineEnd = headings[j].line - 1; break; }
    }
    const pathTitles = [];
    for (let j = idx - 1, lvl = h.level; j >= 0 && lvl > 1; j--) {
      if (headings[j].level < lvl) { pathTitles.unshift(headings[j].title); lvl = headings[j].level; }
    }
    return {
      file, lang, level: h.level, title: h.title,
      path: pathTitles,
      start: h.start, end, lineStart: h.line, lineEnd
    };
  });
  return { sections, qa, totalBytes };
}

function cleanQuestion(q) {
  return q.trim().replace(/^["“「'‘]+|["”」'’]+$/g, '').trim();
}

/** Display title: parent (level ≥2) + own title, e.g. "4 订阅和套餐 · 试用期（Trial·高频）". */
// Level-1 headings ("第一部分 · …", "Part 1 · …") are structural and already removed from `path`.
export function displayTitle(section) {
  return [...section.path, section.title].join(' · ');
}

/** Derive keyword terms from a heading: numbering stripped, split on separators, digit chunks dropped. */
export function titleTerms(title) {
  const clean = stripNumbering(title);
  const chunks = clean.split(/[·・/／()（）|、,，:：;；\-—–]+/).map(s => normalize(s).trim()).filter(Boolean);
  const out = new Set();
  for (const c of chunks) {
    if (/\d/.test(c)) continue;
    if (CJK_RE.test(c)) {
      const cjkOnly = c.replace(/\s+/g, '');
      if (cjkOnly.length >= 2) out.add(cjkOnly);
    } else if (latinWords(c).length > 0) {
      out.add(c);
    }
  }
  return [...out];
}

function resolveRef(refText, sections, file) {
  const parts = refText.split(/[·・]/).map(p => titleKey(stripNumbering(p))).filter(Boolean);
  if (parts.length === 0) return -1;
  const last = parts[parts.length - 1];
  const parent = parts.length > 1 ? parts[0] : null;
  let best = -1;
  let bestRank = Infinity;
  sections.forEach((s, i) => {
    if (s.file !== file || !s.retrievable) return;
    const k = titleKey(stripNumbering(s.title));
    let rank;
    if (k === last) rank = 0;
    else if (k.startsWith(last)) rank = 1;
    else return;
    if (parent) {
      const underParent = s.path.some(p => titleKey(stripNumbering(p)).startsWith(parent));
      if (!underParent) rank += 2;
    }
    rank += k.length / 1000; // prefer the tightest title
    if (rank < bestRank) { bestRank = rank; best = i; }
  });
  return best;
}

function extractRefs(answer, lang) {
  const refs = [];
  const re = lang === 'zh' ? /「([^」]+)」/g : /["“]([^"”]+)["”]/g;
  for (const m of answer.matchAll(re)) refs.push(m[1]);
  return refs;
}

/** Find the section a keywords.yml key refers to (zh or en heading; numbering optional). */
export function resolveKeywordKey(key, sections) {
  const full = titleKey(key);
  const bare = titleKey(stripNumbering(key));
  const matches = [];
  sections.forEach((s, i) => {
    if (!s.retrievable) return;
    const sFull = titleKey(s.title);
    const sBare = titleKey(stripNumbering(s.title));
    if (sFull === full || sBare === bare || sFull === bare) matches.push(i);
  });
  if (matches.length) return matches;
  // Prefix match (e.g. key "Credit" for "5 Credit（积分）") — only when unique per file.
  const pre = sections.map((s, i) => [s, i]).filter(([s]) => s.retrievable && bare.length >= 2 && titleKey(stripNumbering(s.title)).startsWith(bare));
  const perFile = new Map();
  for (const [s, i] of pre) perFile.set(s.file, [...(perFile.get(s.file) || []), i]);
  const out = [];
  for (const list of perFile.values()) if (list.length === 1) out.push(list[0]);
  return out;
}

function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(asList);
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  return [];
}

/**
 * Normalise one keywords.yml section entry into { strong: [], weak: [] }.
 * Accepted shapes:
 *   key: [a, b]                         → strong
 *   key: { strong: [..], weak: [..] }
 *   key: { zh: [..], en: [..] }         → strong
 *   key: { zh: { strong, weak }, en: { strong, weak } }
 */
export function entryTerms(entry) {
  const out = { strong: [], weak: [] };
  if (Array.isArray(entry) || typeof entry === 'string') { out.strong.push(...asList(entry)); return out; }
  if (!entry || typeof entry !== 'object') return out;
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'strong' || k === 'weak') out[k].push(...asList(v));
    else if (k === 'synonyms') out.strong.push(...asList(v));
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.strong.push(...asList(v.strong), ...asList(v.synonyms));
      out.weak.push(...asList(v.weak));
    } else out.strong.push(...asList(v));
  }
  return out;
}

/** Validate and normalise parsed keywords.yml. Throws on a structurally invalid document. */
export function normalizeKeywords(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('keywords.yml must be a mapping');
  const sections = doc.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    throw new Error('keywords.yml must have a top-level "sections" mapping');
  }
  const synonyms = [];
  const syn = doc.synonyms;
  if (syn != null) {
    if (typeof syn !== 'object') throw new Error('"synonyms" must be a mapping or a list of lists');
    const groups = Array.isArray(syn) ? syn.map(asList) : Object.entries(syn).map(([k, v]) => [k, ...asList(v)]);
    for (const g of groups) {
      const terms = [...new Set(g.map(t => normalize(t).trim()).filter(Boolean))];
      if (terms.length > 1) synonyms.push(terms);
    }
  }
  return { sections, synonyms };
}

export function gitHead(repoDir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Build the index object from a repo checkout. Pure apart from reading files.
 * opts.keywordsPath overrides <repoDir>/keywords.yml (tests).
 */
export function buildIndex(repoDir, opts = {}) {
  const seed = opts.seed || loadSeed(opts.seedPath);
  const files = fs.readdirSync(repoDir)
    .filter(f => /\.md$/i.test(f) && !/^(changelog|license|contributing|agents|claude)\.md$/i.test(f))
    .sort();

  const sections = [];
  const qaAll = [];
  const fileMeta = {};
  const excludeKeys = (seed.exclude_titles || []).map(titleKey);
  for (const f of files) {
    const text = fs.readFileSync(path.join(repoDir, f), 'utf8');
    const lang = langOfFile(f, text);
    const { sections: secs, qa, totalBytes } = parseMarkdown(text, f, lang);
    fileMeta[f] = { lang, bytes: totalBytes };
    const partTitles = new Set(secs.filter(s => s.level === 1).map(s => s.title));
    for (const s of secs) {
      const key = titleKey(s.title);
      s.retrievable = s.level > 1 && !excludeKeys.some(k => key.includes(k));
      s.path = s.path.filter(p => !partTitles.has(p));
      sections.push(s);
    }
    qaAll.push(...qa);
  }
  sections.forEach((s, i) => { s.id = i; s.terms = new Map(); s.qa = []; });

  // zh/en counterparts: pair retrievable sections by ordinal when both files have the same shape.
  const byLang = { zh: [], en: [] };
  for (const s of sections) if (s.retrievable && byLang[s.lang]) byLang[s.lang].push(s);
  const paired = byLang.zh.length > 0 && byLang.zh.length === byLang.en.length;
  if (paired) {
    byLang.zh.forEach((s, k) => { s.counterpart = byLang.en[k].id; byLang.en[k].counterpart = s.id; });
  }

  const addTerm = (sec, term, weight, kind) => {
    let t = normalize(term).trim().replace(/\s+/g, ' ');
    if (!t) return;
    if (!CJK_RE.test(t)) {
      // Latin terms are keyed by their stems so "credit" / "credits" count once.
      const words = latinWords(t);
      if (words.length === 0) return;
      t = words.join(' ');
    }
    const prev = sec.terms.get(t);
    if (!prev || prev.weight < weight) sec.terms.set(t, { weight, kind });
  };
  const addBoth = (sec, term, weight, kind) => {
    addTerm(sec, term, weight, kind);
    if (sec.counterpart != null) addTerm(sections[sec.counterpart], term, weight, kind);
  };

  // (2) title-derived terms. A term that many headings contain ("agent", "connection")
  // carries no signal: drop title terms found in more than MAX_TITLE_DF section pairs.
  const pairTitles = new Map(); // pairId → { text, words }
  for (const s of sections) {
    if (!s.retrievable) continue;
    const pairId = s.counterpart != null ? Math.min(s.id, s.counterpart) : s.id;
    const e = pairTitles.get(pairId) || { text: '', words: new Set() };
    e.text += ' ' + normalize(s.title).replace(/\s+/g, '');
    for (const w of latinWords(s.title)) e.words.add(w);
    pairTitles.set(pairId, e);
  }
  const dfCache = new Map();
  const titleDf = (t) => {
    if (dfCache.has(t)) return dfCache.get(t);
    const words = CJK_RE.test(t) ? null : latinWords(t);
    let n = 0;
    for (const e of pairTitles.values()) {
      if (words ? words.every(w => e.words.has(w)) : e.text.includes(t)) n++;
    }
    dfCache.set(t, n);
    return n;
  };
  for (const s of sections) {
    if (!s.retrievable) continue;
    for (const t of titleTerms(s.title)) if (titleDf(t) <= MAX_TITLE_DF) addBoth(s, t, WEIGHTS.title, 'title');
  }

  // (4) seed anchors
  for (const a of seed.anchors || []) {
    const matchKeys = asList(a.match).map(titleKey);
    for (const s of sections) {
      if (!s.retrievable) continue;
      const k = titleKey(stripNumbering(s.title));
      if (matchKeys.some(m => k.startsWith(m) || (a.contains && k.includes(m)))) {
        for (const t of asList(a.terms)) addTerm(s, t, WEIGHTS.seed, 'seed');
      }
    }
  }

  // (1) keywords.yml
  let source = 'fallback';
  let keywordsError = null;
  const unresolved = [];
  let synonyms = [];
  const kwPath = opts.keywordsPath || path.join(repoDir, KEYWORDS_FILE);
  if (fs.existsSync(kwPath)) {
    try {
      const kw = normalizeKeywords(parseYaml(fs.readFileSync(kwPath, 'utf8')));
      synonyms = kw.synonyms;
      for (const [key, entry] of Object.entries(kw.sections)) {
        const hits = resolveKeywordKey(key, sections);
        if (hits.length === 0) { unresolved.push(key); continue; }
        const { strong, weak } = entryTerms(entry);
        for (const i of hits) {
          for (const t of strong) addBoth(sections[i], t, WEIGHTS.strong, 'strong');
          for (const t of weak) addBoth(sections[i], t, WEIGHTS.weak, 'weak');
        }
      }
      source = 'keywords.yml';
    } catch (err) {
      keywordsError = err.message;
    }
  } else {
    keywordsError = 'missing';
  }

  // (3) Q&A questions → target sections
  const byCategory = new Map();
  for (const q of qaAll) {
    q.targets = [];
    for (const ref of extractRefs(q.answer, q.lang)) {
      const t = resolveRef(ref, sections, q.file);
      if (t >= 0 && !q.targets.includes(t)) q.targets.push(t);
    }
    const ck = `${q.file}\u0000${q.category}`;
    if (!byCategory.has(ck)) byCategory.set(ck, new Map());
    for (const t of q.targets) byCategory.get(ck).set(t, (byCategory.get(ck).get(t) || 0) + 1);
  }
  // Unreferenced Q&A: the category label ("积分（Credit）") usually names its section;
  // otherwise use the category's most common explicit reference.
  const categoryTarget = new Map();
  const targetFor = (q) => {
    const ck = `${q.file}\u0000${q.category}`;
    if (categoryTarget.has(ck)) return categoryTarget.get(ck);
    const counts = byCategory.get(ck) || new Map();
    const catTok = tokenSet(q.category);
    let best = -1;
    let bestKey = null;
    for (const s of sections) {
      if (s.file !== q.file || !s.retrievable) continue;
      let hit = 0;
      for (const t of tokenSet(stripNumbering(s.title))) if (catTok.has(t)) hit++;
      if (hit === 0) continue;
      const key = [hit, counts.get(s.id) || 0, -s.level];
      if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
        best = s.id;
        bestKey = key;
      }
    }
    if (best < 0 && counts.size) best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    categoryTarget.set(ck, best);
    return best;
  };
  for (const q of qaAll) {
    if (q.targets.length === 0) {
      const t = targetFor(q);
      if (t >= 0) { q.targets.push(t); q.inferred = true; }
    }
    for (const t of q.targets) {
      sections[t].qa.push({ q: q.question, line: q.line, start: q.start, end: q.end, inferred: !!q.inferred });
    }
  }

  // Inverted index term → [[sectionId, weight]]
  const inverted = {};
  let termCount = 0;
  for (const s of sections) {
    for (const [t, { weight }] of s.terms) {
      (inverted[t] ||= []).push([s.id, weight]);
      termCount++;
    }
  }

  return {
    schema: INDEX_SCHEMA,
    built_at: new Date().toISOString(),
    commit: opts.commit !== undefined ? opts.commit : gitHead(repoDir),
    source,
    keywords_error: source === 'fallback' ? keywordsError : null,
    unresolved_keys: unresolved,
    files: fileMeta,
    synonyms,
    stats: {
      sections: sections.filter(s => s.retrievable).length,
      terms: Object.keys(inverted).length,
      postings: termCount,
      qa: qaAll.length,
      qa_unmapped: qaAll.filter(q => q.targets.length === 0).length
    },
    sections: sections.map(s => ({
      id: s.id, file: s.file, lang: s.lang, level: s.level, title: s.title, path: s.path,
      retrievable: s.retrievable, start: s.start, end: s.end, line_start: s.lineStart, line_end: s.lineEnd,
      counterpart: s.counterpart ?? null,
      qa: s.qa
    })),
    inverted
  };
}

/** Build and atomically write the index. Returns the index object. */
export function writeIndex(repoDir, indexPath, opts = {}) {
  const index = buildIndex(repoDir, opts);
  writeJsonAtomic(indexPath, index, { pretty: false });
  return index;
}

export function readIndex(indexPath) {
  try {
    const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return idx && idx.schema === INDEX_SCHEMA ? idx : null;
  } catch {
    return null;
  }
}

export function describeIndex(index) {
  const s = index.stats;
  return `Index rebuilt: ${s.sections} sections, ${s.terms} terms, source=${index.source}` +
    (index.unresolved_keys.length ? ` (${index.unresolved_keys.length} unresolved keywords.yml keys: ${index.unresolved_keys.join(' | ')})` : '') +
    (index.source === 'fallback' && index.keywords_error && index.keywords_error !== 'missing' ? ` (keywords.yml invalid: ${index.keywords_error})` : '');
}
