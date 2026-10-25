/**
 * yaml-lite — a tiny, dependency-free parser for the YAML subset used by
 * keywords.yml in openmax-product-kb:
 *
 *   - block mappings (`key: value`, nested by indentation; keys may be quoted)
 *   - block sequences (`- item`) of scalars or flow collections
 *   - flow sequences `[a, "b c", 'd']` and flow mappings `{ zh: [a], en: [b] }`
 *     (may span several lines until the brackets balance)
 *   - scalars: double-quoted (with \" \\ \n \t escapes), single-quoted ('' escape),
 *     plain (true/false/null/~ and numbers are typed, everything else is a string)
 *   - `#` comments (at line start or after whitespace, outside quotes)
 *
 * Anything outside this subset (anchors, tags, multi-document, block scalars
 * `|` / `>`, nested mappings inside block sequence items) throws a YamlError so
 * callers can fall back to derived keywords instead of indexing garbage.
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'YamlError';
    this.line = line;
  }
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) {
        if (quote === "'" && line[i + 1] === "'") { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function bracketDepth(text) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth;
}

function typedPlain(s) {
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Parse a flow value (scalar, [..] or {..}) starting at pos. Returns [value, nextPos]. */
function parseFlow(text, pos, lineNo) {
  const skipWs = () => { while (pos < text.length && /\s/.test(text[pos])) pos++; };
  skipWs();
  const c = text[pos];
  if (c === '[' || c === '{') {
    const isSeq = c === '[';
    const close = isSeq ? ']' : '}';
    const out = isSeq ? [] : {};
    pos++;
    skipWs();
    if (text[pos] === close) return [out, pos + 1];
    for (;;) {
      if (isSeq) {
        const [v, p] = parseFlow(text, pos, lineNo);
        out.push(v);
        pos = p;
      } else {
        const [k, p] = parseFlowScalar(text, pos, lineNo, true);
        pos = p;
        skipWs();
        if (text[pos] !== ':') throw new YamlError(`expected ':' in flow mapping`, lineNo);
        pos++;
        const [v, p2] = parseFlow(text, pos, lineNo);
        out[String(k)] = v;
        pos = p2;
      }
      skipWs();
      if (text[pos] === ',') { pos++; skipWs(); if (text[pos] === close) return [out, pos + 1]; continue; }
      if (text[pos] === close) return [out, pos + 1];
      throw new YamlError(`unterminated flow collection`, lineNo);
    }
  }
  return parseFlowScalar(text, pos, lineNo, false);
}

function parseQuoted(text, pos, lineNo) {
  const q = text[pos];
  let out = '';
  pos++;
  while (pos < text.length) {
    const c = text[pos];
    if (q === '"' && c === '\\') {
      const n = text[pos + 1];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      pos += 2;
      continue;
    }
    if (c === q) {
      if (q === "'" && text[pos + 1] === "'") { out += "'"; pos += 2; continue; }
      return [out, pos + 1];
    }
    out += c;
    pos++;
  }
  throw new YamlError('unterminated quoted string', lineNo);
}

function parseFlowScalar(text, pos, lineNo, isKey) {
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  if (text[pos] === '"' || text[pos] === "'") return parseQuoted(text, pos, lineNo);
  const stop = isKey ? /[:,\]}]/ : /[,\]}]/;
  let end = pos;
  while (end < text.length && !stop.test(text[end])) end++;
  const raw = text.slice(pos, end).trim();
  return [isKey ? raw : typedPlain(raw), end];
}

function parseValue(text, lineNo) {
  const t = text.trim();
  if (t === '') return null;
  if (/^[&*!|>]/.test(t)) throw new YamlError(`unsupported YAML feature: ${t[0]}`, lineNo);
  if (t[0] === '[' || t[0] === '{' || t[0] === '"' || t[0] === "'") {
    const [v, p] = parseFlow(t, 0, lineNo);
    if (t.slice(p).trim() !== '') throw new YamlError(`unexpected trailing content: ${t.slice(p).trim()}`, lineNo);
    return v;
  }
  return typedPlain(t);
}

/** Split `key: rest` honoring quoted keys. Returns null when the line is not a mapping entry. */
function splitKey(content, lineNo) {
  if (content[0] === '"' || content[0] === "'") {
    const [k, p] = parseQuoted(content, 0, lineNo);
    const rest = content.slice(p);
    const m = /^\s*:(\s|$)/.exec(rest);
    if (!m) return null;
    return [k, rest.slice(m[0].length)];
  }
  const m = /^([^:]+?)\s*:(\s+|$)/.exec(content);
  if (!m) return null;
  return [m[1], content.slice(m[0].length)];
}

export function parseYaml(source) {
  const rawLines = String(source).replace(/^﻿/, '').split(/\r?\n/);
  if (rawLines.some(l => /^(---|\.\.\.)\s*$/.test(l)) && rawLines.filter(l => /^---\s*$/.test(l)).length > 1) {
    throw new YamlError('multi-document YAML is not supported');
  }

  // Logical lines: comment-stripped, non-empty, flow collections joined.
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    let text = stripComment(rawLines[i]).replace(/\s+$/, '');
    if (/^---\s*$/.test(text)) continue;
    if (text.trim() === '') continue;
    if (/\t/.test(text.match(/^\s*/)[0])) throw new YamlError('tabs are not allowed for indentation', i + 1);
    const lineNo = i + 1;
    while (bracketDepth(text) > 0 && i + 1 < rawLines.length) {
      i++;
      text += ' ' + stripComment(rawLines[i]).trim();
    }
    if (bracketDepth(text) !== 0) throw new YamlError('unbalanced brackets', lineNo);
    const indent = text.match(/^ */)[0].length;
    lines.push({ indent, content: text.slice(indent), lineNo });
  }

  let idx = 0;

  function parseBlock(indent) {
    const first = lines[idx];
    if (first.content.startsWith('- ') || first.content === '-') return parseSeq(indent);
    return parseMap(indent);
  }

  function parseSeq(indent) {
    const out = [];
    while (idx < lines.length && lines[idx].indent === indent && (lines[idx].content.startsWith('- ') || lines[idx].content === '-')) {
      const { content, lineNo } = lines[idx];
      const rest = content === '-' ? '' : content.slice(2);
      idx++;
      if (rest.trim() === '') {
        if (idx < lines.length && lines[idx].indent > indent) out.push(parseBlock(lines[idx].indent));
        else out.push(null);
        continue;
      }
      if (splitKey(rest.trim(), lineNo) && !/^["'[{]/.test(rest.trim())) {
        throw new YamlError('mappings inside block sequence items are not supported', lineNo);
      }
      out.push(parseValue(rest, lineNo));
    }
    if (idx < lines.length && lines[idx].indent > indent) {
      throw new YamlError('bad indentation', lines[idx].lineNo);
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (idx < lines.length && lines[idx].indent === indent) {
      const { content, lineNo } = lines[idx];
      if (content.startsWith('- ')) throw new YamlError('unexpected sequence item', lineNo);
      const kv = splitKey(content, lineNo);
      if (!kv) throw new YamlError(`expected "key: value", got: ${content}`, lineNo);
      const [key, rest] = kv;
      idx++;
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new YamlError(`duplicate key: ${key}`, lineNo);
      if (rest.trim() === '') {
        if (idx < lines.length && lines[idx].indent > indent) {
          out[key] = parseBlock(lines[idx].indent);
        } else if (idx < lines.length && lines[idx].indent === indent && lines[idx].content.startsWith('- ')) {
          // YAML allows a block sequence at the same indent as its parent key.
          out[key] = parseSeq(indent);
        } else {
          out[key] = null;
        }
      } else {
        out[key] = parseValue(rest, lineNo);
      }
    }
    if (idx < lines.length && lines[idx].indent > indent) {
      throw new YamlError('bad indentation', lines[idx].lineNo);
    }
    return out;
  }

  if (lines.length === 0) return null;
  const result = parseBlock(lines[0].indent);
  if (idx < lines.length) throw new YamlError('unexpected content (bad indentation?)', lines[idx].lineNo);
  return result;
}
