// Pure comment/to-do scanner. No `vscode` import so it can be unit-tested with plain Node.

export interface CommentSyntax {
  /** Line comment openers, e.g. `//`, `#`. */
  line?: string[];
  /** Block comment [open, close] pairs, e.g. `/*`, `*\/`. */
  block?: Array<[string, string]>;
  /** String delimiters that cannot span lines. */
  quotes?: string[];
  /** String delimiters that may span lines. */
  multilineQuotes?: string[];
  /** Language has `/regex/` literals (JS/TS). */
  regexLiterals?: boolean;
  /** PHP: file starts in HTML mode; code lives between `<?php`/`<?=`/`<?` and `?>`. */
  phpTags?: boolean;
}

export interface TodoMatch {
  /** 0-based line. */
  line: number;
  /** Column range of the keyword itself (TODO / to-do / DONE ...). */
  keywordStart: number;
  keywordEnd: number;
  keyword: string;
  /** Description following the keyword. */
  text: string;
  done: boolean;
  /** Column range of the comment content on this line (delimiters excluded). */
  contentStart: number;
  contentEnd: number;
  /** Column of the opening delimiter, when it sits on this line. */
  commentStart?: number;
  /** Column just past the closing delimiter (or end of a line comment), when on this line. */
  commentEnd?: number;
}

const JS: CommentSyntax = {
  line: ['//'],
  block: [['/*', '*/']],
  quotes: ["'", '"'],
  multilineQuotes: ['`'],
  regexLiterals: true,
};
const MARKUP_JS: CommentSyntax = { ...JS, block: [['/*', '*/'], ['<!--', '-->']] };
const PHP: CommentSyntax = {
  line: ['//', '#'],
  block: [['/*', '*/']],
  multilineQuotes: ["'", '"'],
  phpTags: true,
};
const C_LIKE: CommentSyntax = { line: ['//'], block: [['/*', '*/']], quotes: ["'", '"'] };
const HASH: CommentSyntax = { line: ['#'], quotes: ["'", '"'] };
const CSS: CommentSyntax = { block: [['/*', '*/']], quotes: ["'", '"'] };
const HTML: CommentSyntax = { block: [['<!--', '-->']] };
const SQL: CommentSyntax = { line: ['--'], block: [['/*', '*/']], quotes: ["'", '"'] };

export const SYNTAX_BY_EXTENSION: Record<string, CommentSyntax> = {
  php: PHP, phtml: PHP,
  js: JS, jsx: JS, mjs: JS, cjs: JS, ts: JS, tsx: JS, mts: JS, cts: JS,
  vue: MARKUP_JS, svelte: MARKUP_JS, astro: MARKUP_JS,
  c: C_LIKE, h: C_LIKE, cpp: C_LIKE, hpp: C_LIKE, cs: C_LIKE, java: C_LIKE, kt: C_LIKE,
  go: C_LIKE, rs: C_LIKE, swift: C_LIKE, scala: C_LIKE, dart: C_LIKE,
  scss: C_LIKE, less: C_LIKE, css: CSS,
  py: HASH, rb: HASH, sh: HASH, bash: HASH, zsh: HASH, yml: HASH, yaml: HASH, toml: HASH,
  html: HTML, htm: HTML, xml: HTML,
  sql: SQL,
};

export const SUPPORTED_EXTENSIONS = Object.keys(SYNTAX_BY_EXTENSION);

export function syntaxForPath(filePath: string): CommentSyntax | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return undefined;
  return SYNTAX_BY_EXTENSION[filePath.slice(dot + 1).toLowerCase()];
}

/**
 * Keyword must open the comment (after decoration like `*`, `#`, `@`, `[`), so that prose such as
 * "// things to do later" or strings like "todo-list" are not picked up.
 * Matches: todo, TODO, to do, TO DO, to-do, TO-DO (any case) and the checked-off marker DONE.
 */
const TODO_PATTERN = /^([\s*#\/!\[-]*@?)(to[ \t-]?do|done)(?=$|[\s:(\]]|[-–—]\s)/i;
const SEPARATORS = /^[\s:\]\-–—]*/;

interface RawComment {
  open: number;
  contentStart: number;
  contentEnd: number;
  close: number;
}

// `<` and `>` are left out on purpose: in JSX `</tag>` and `>/text` are far more common than `a < /re/`.
const REGEX_PRECEDERS = '(,=:[!&|?{};+-*%~^';

function findComments(text: string, syntax: CommentSyntax): RawComment[] {
  const comments: RawComment[] = [];
  const n = text.length;
  const lineOpeners = syntax.line ?? [];
  const blocks = syntax.block ?? [];
  const quotes = syntax.quotes ?? [];
  const multilineQuotes = syntax.multilineQuotes ?? [];
  let inHtml = !!syntax.phpTags;
  let prevSignificant = '';
  let i = 0;

  outer: while (i < n) {
    if (syntax.phpTags) {
      if (inHtml) {
        if (text.startsWith('<?', i)) {
          inHtml = false;
          i += text.startsWith('<?php', i) ? 5 : 2;
          prevSignificant = '';
          continue;
        }
        if (text.startsWith('<!--', i)) {
          const end = text.indexOf('-->', i + 4);
          const contentEnd = end < 0 ? n : end;
          comments.push({ open: i, contentStart: i + 4, contentEnd, close: end < 0 ? n : end + 3 });
          i = end < 0 ? n : end + 3;
          continue;
        }
        i++;
        continue;
      }
      if (text.startsWith('?>', i)) {
        inHtml = true;
        i += 2;
        continue;
      }
    }

    for (const opener of lineOpeners) {
      if (!text.startsWith(opener, i)) continue;
      // PHP 8 attributes: #[Attr]
      if (syntax.phpTags && opener === '#' && text[i + 1] === '[') continue;
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      if (syntax.phpTags) {
        // `?>` terminates a PHP line comment.
        const tagClose = text.indexOf('?>', i);
        if (tagClose >= 0 && tagClose < end) end = tagClose;
      }
      comments.push({ open: i, contentStart: i + opener.length, contentEnd: end, close: end });
      i = end;
      continue outer;
    }

    for (const [open, close] of blocks) {
      if (!text.startsWith(open, i)) continue;
      const end = text.indexOf(close, i + open.length);
      const contentEnd = end < 0 ? n : end;
      comments.push({ open: i, contentStart: i + open.length, contentEnd, close: end < 0 ? n : end + close.length });
      i = end < 0 ? n : end + close.length;
      continue outer;
    }

    const ch = text[i];
    const multiline = multilineQuotes.includes(ch);
    // In JS/TS a quote can't directly follow a letter, so `Don't` in JSX text is not a string.
    const jsxApostrophe = syntax.regexLiterals && ch === "'" && /\w/.test(text[i - 1] ?? '');
    if ((multiline || quotes.includes(ch)) && !jsxApostrophe) {
      let j = i + 1;
      while (j < n) {
        const c = text[j];
        if (c === '\\') { j += 2; continue; }
        if (c === ch) { j++; break; }
        if (c === '\n' && !multiline) break;
        j++;
      }
      i = j;
      prevSignificant = ch;
      continue;
    }

    if (ch === '/' && syntax.regexLiterals && (prevSignificant === '' || REGEX_PRECEDERS.includes(prevSignificant))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && text[j] !== '\n') {
        const c = text[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; j++; break; }
        j++;
      }
      if (closed) {
        i = j;
        prevSignificant = '/';
        continue;
      }
    }

    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return comments;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Find all to-dos (and DONE markers) inside comments of `text`. */
export function scanText(text: string, syntax: CommentSyntax): TodoMatch[] {
  const results: TodoMatch[] = [];
  const starts = lineStartsOf(text);

  for (const comment of findComments(text, syntax)) {
    const firstLine = lineOf(starts, comment.contentStart);
    const lastLine = lineOf(starts, comment.contentEnd);

    for (let line = firstLine; line <= lastLine; line++) {
      const lineStart = starts[line];
      const segStart = line === firstLine ? comment.contentStart : lineStart;
      let segEnd = line === lastLine ? comment.contentEnd : starts[line + 1] - 1;
      if (segEnd > segStart && text[segEnd - 1] === '\r') segEnd--;

      const content = text.slice(segStart, segEnd);
      const m = TODO_PATTERN.exec(content);
      if (!m) continue;
      const keyword = m[2];
      // Only the explicit upper-case marker counts as checked off; "done" in prose is ignored.
      if (keyword.toLowerCase() === 'done' && keyword !== 'DONE') continue;

      const rest = content.slice(m[0].length);
      const text_ = rest.slice(SEPARATORS.exec(rest)![0].length).trim();
      const keywordStart = segStart - lineStart + m[1].length;
      results.push({
        line,
        keywordStart,
        keywordEnd: keywordStart + keyword.length,
        keyword,
        text: text_,
        done: keyword === 'DONE',
        contentStart: segStart - lineStart,
        contentEnd: segEnd - lineStart,
        commentStart: line === firstLine ? comment.open - lineStart : undefined,
        commentEnd: line === lastLine ? comment.close - lineStart : undefined,
      });
    }
  }
  return results;
}
