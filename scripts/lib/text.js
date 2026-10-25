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

/** True when a (normalized) query contains the term. */
export function termPresent(term, query) {
  if (CJK_RE.test(term)) return query.text.includes(term);
  const words = latinWords(term);
  if (words.length === 0) return false;
  return words.every(w => query.words.has(w));
}

export function prepareQuery(question) {
  const text = normalize(question);
  return { raw: question, text, words: new Set(latinWords(text)), tokens: tokenSet(text) };
}
