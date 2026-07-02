const CONTROL_KEYWORDS = new Set(['if', 'else', 'fail', 'for', 'tp', 'context']);
const TAG_NAME_PATTERN = /^[a-z][\w-]*(?:-[a-z][\w-]*)*/;

function collectBobeTagRanges(text, options = {}) {
  if (options.languageId === 'bobe' || options.standalone) {
    return collectTemplateTagRanges(text, 0, text.length);
  }
  return collectTaggedTemplateTagRanges(text);
}

function collectTaggedTemplateTagRanges(text) {
  const ranges = [];
  let searchStart = 0;

  while (searchStart < text.length) {
    const bobeIndex = findBobeIdentifier(text, searchStart);
    if (bobeIndex === -1) break;

    const templateStart = findBobeTemplateStart(text, bobeIndex + 4);
    if (templateStart === -1) {
      searchStart = bobeIndex + 4;
      continue;
    }

    const contentStart = templateStart + 1;
    const templateEnd = findTemplateEnd(text, contentStart);
    const contentEnd = templateEnd === -1 ? text.length : templateEnd;
    ranges.push(...collectTemplateTagRanges(text, contentStart, contentEnd));
    searchStart = templateEnd === -1 ? text.length : templateEnd + 1;
  }

  return ranges;
}

function collectTemplateTagRanges(text, start, end) {
  const ranges = [];
  let lineStart = start;

  while (lineStart < end) {
    let lineEnd = lineStart;
    while (lineEnd < end && text[lineEnd] !== '\n' && text[lineEnd] !== '\r') {
      lineEnd += 1;
    }

    const tag = findLineTag(text, lineStart, lineEnd);
    if (tag) ranges.push(tag);

    if (lineEnd >= end) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1);
  }

  return ranges;
}

function findLineTag(text, lineStart, lineEnd) {
  let start = lineStart;
  while (start < lineEnd && (text[start] === ' ' || text[start] === '\t')) {
    start += 1;
  }

  const match = TAG_NAME_PATTERN.exec(text.slice(start, lineEnd));
  if (!match) return undefined;

  const tag = match[0];
  const afterTag = start + tag.length;
  if (afterTag < lineEnd && !/\s/.test(text[afterTag])) return undefined;
  if (CONTROL_KEYWORDS.has(tag)) return undefined;

  return { start, length: tag.length, text: tag };
}

function findBobeIdentifier(text, start) {
  const matcher = /\bbobe\b/g;
  matcher.lastIndex = start;
  const match = matcher.exec(text);
  return match ? match.index : -1;
}

function findBobeTemplateStart(text, afterIdentifier) {
  let cursor = skipInlineWhitespace(text, afterIdentifier);
  const directTemplateStart = findUnescapedBacktick(text, cursor);
  if (directTemplateStart === -1) return -1;

  if (cursor === directTemplateStart) return directTemplateStart;
  if (text[cursor] !== '<') return -1;

  const beforeTemplate = text.slice(cursor, directTemplateStart);
  const genericEnd = beforeTemplate.lastIndexOf('>');
  if (genericEnd === -1) return -1;

  cursor = skipInlineWhitespace(text, cursor + genericEnd + 1);
  return cursor === directTemplateStart ? directTemplateStart : -1;
}

function findTemplateEnd(text, start) {
  let expressionDepth = 0;
  let cursor = start;

  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (expressionDepth === 0 && char === '`') return cursor;
    if (char === '$' && text[cursor + 1] === '{') {
      expressionDepth += 1;
      cursor += 2;
      continue;
    }
    if (expressionDepth > 0) {
      if (char === '{') expressionDepth += 1;
      if (char === '}') expressionDepth -= 1;
    }
    cursor += 1;
  }

  return -1;
}

function findUnescapedBacktick(text, start) {
  let cursor = start;
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (text[cursor] === '`') return cursor;
    cursor += 1;
  }
  return -1;
}

function skipInlineWhitespace(text, start) {
  let cursor = start;
  while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\n' || text[cursor] === '\r')) {
    cursor += 1;
  }
  return cursor;
}

module.exports = {
  collectBobeTagRanges,
  collectTaggedTemplateTagRanges,
  collectTemplateTagRanges
};
