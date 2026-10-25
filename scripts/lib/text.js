/**
 * Text normalisation and tokenisation shared by the index builder and retriever.
 *
 * No word segmentation dictionary: CJK text is compared with character bigrams
 * and substring containment; Latin text with lightly stemmed words.
 */

export const CJK_RE = /[㐀-鿿豈-﫿]/;
const CJK_RUN_RE = /[㐀-鿿豈-﫿]+/g;
const WORD_RE = /[a-z0-9]+(?:[.'][a-z0-9]+)*/g;

export const EN_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'done', 'can', 'could',
  'will', 'would', 'should', 'shall', 'may', 'might', 'must', 'have', 'has', 'had', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'there', 'here', 'if', 'then',
  'so', 'not', 'no', 'yes', 'any', 'some', 'all', 'about', 'into', 'out', 'up', 'down', 'over',
  'get', 'got', 'use', 'using', 'used', 'want', 'need', 'please', 'tell', 'know', 'there', 'than',
  'just', 'also', 'still', 'more', 'most', 'much', 'many', 'one', 'only', 'very', 'per', 'via', 'vs',
  'min', 'openmax', 'workspace'
].map(stem));

// Product words too common in this corpus to count as topic words on their own, but which
// anchor an otherwise all-stopword phrase ("what is openmax") to a specific intent.
const DOMAIN_STOPWORDS = new Set(['openmax', 'workspace'].map(stem));

// Question scaffolding that carries no topic signal.
export const ZH_STOP_BIGRAMS = new Set([
  '怎么', '么样', '什么', '为什', '么是', '可以', '可不', '不可', '以吗', '是不', '不是', '能不',
  '不能', '能吗', '吗？', '一下', '一个', '我们', '我的', '你们', '如何', '请问', '哪些', '哪里',
  '多少', '有没', '没有', '是否', '会不', '不会', '会吗', '有吗', '的话', '这个', '那个', '还是',
  '现在', '已经', '需要', '要不', '么办', '怎样', '是什', '支持', '持吗', '有哪', '用吗', '么用'
]);

export function normalize(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase();
}

/** Very light English stemmer — applied identically to queries and index terms. */
export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function latinWords(s) {
  const out = [];
  for (const m of normalize(s).matchAll(WORD_RE)) {
    const w = stem(m[0]);
    if (w.length < 2 || /^\d+$/.test(w) || EN_STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

export function cjkBigrams(s) {
  const out = [];
  for (const m of normalize(s).matchAll(CJK_RUN_RE)) {
    const run = m[0];
    for (let i = 0; i + 1 < run.length; i++) {
      const bg = run.slice(i, i + 2);
      if (!ZH_STOP_BIGRAMS.has(bg)) out.push(bg);
    }
  }
  return out;
}

/** Token set used for fuzzy overlap: CJK bigrams + stemmed Latin words. */
export function tokenSet(s) {
  return new Set([...cjkBigrams(s), ...latinWords(s)]);
}

export function countCjk(s) {
  const m = String(s).match(/[㐀-鿿豈-﫿]/g);
  return m ? m.length : 0;
}

/** zh when CJK characters outnumber Latin words (brand names do not flip a Chinese question). */
export function detectLang(question) {
  const cjk = countCjk(question);
  const words = (normalize(question).match(/[a-z]+/g) || []).length;
  return cjk > 0 && cjk >= words ? 'zh' : 'en';
}

/** Strip section numbering such as "5 ", "2.1 ", "A · " from a heading. */
export function stripNumbering(title) {
  return String(title)
    .replace(/^\s*\d+(?:\.\d+)*(?:\s+|\s*[·.、:：]\s*)(?=\S)/, '')
    .replace(/^\s*[A-Z]\s*[·.、:：]\s*(?=\S)/, '')
    .trim();
}

/** Canonical key for comparing headings with keywords.yml keys / Q&A references. */
export function titleKey(title) {
  return normalize(title).replace(/[\s·・.,，、:：;；!?！？'"“”‘’「」『』《》()（）\[\]【】/／|\-—–_*`~]+/g, '');
}

/** Every stemmed Latin word in order, stopwords kept — used for phrase matching. */
export function latinSeq(s) {
  return [...normalize(s).matchAll(WORD_RE)].map(m => stem(m[0]));
}

/**
 * The single normalisation boundary for keyword terms (index terms, keywords.yml terms,
 * seed terms, synonyms): raw term → match key. CJK terms stay as text; Latin terms become
 * their stemmed content words. A Latin term made only of stopwords is dropped ("how much"),
 * unless it names the product ("what is openmax"): then it is kept as an exact stemmed phrase.
 * Keys are already normalised — never pass a key through latinWords()/stem() again.
 */
export function termKey(term) {
  const t = normalize(term).trim().replace(/\s+/g, ' ');
  if (!t || CJK_RE.test(t)) return t;
  const words = latinWords(t);
  if (words.length > 0) return words.join(' ');
  const seq = latinSeq(t);
  return seq.some(w => DOMAIN_STOPWORDS.has(w)) ? seq.join(' ') : '';
}

/** True when a prepared query contains a match key (output of termKey). */
export function keyPresent(key, query) {
  if (!key) return false;
  if (CJK_RE.test(key)) return query.text.includes(key);
  const words = key.split(' ');
  // Keys with a stopword are stopword-only phrases: require the exact word sequence.
  if (words.some(w => EN_STOPWORDS.has(w))) return ` ${query.seq} `.includes(` ${key} `);
  return words.every(w => query.words.has(w));
}

/** True when a prepared query contains a raw (un-normalised) term. */
export function termPresent(term, query) {
  return keyPresent(termKey(term), query);
}

export function prepareQuery(question) {
  const text = normalize(question);
  return {
    raw: question, text,
    words: new Set(latinWords(text)), seq: latinSeq(text).join(' '),
    tokens: tokenSet(text)
  };
}
