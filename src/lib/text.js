const NAMED_HTML_ENTITIES = {
  amp: '&',
  apos: '\u0027',
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '\u0022',
};

function decodeHtmlEntity(match, entity) {
  const normalized = entity.toLowerCase();

  if (normalized.startsWith('#')) {
    const isHex = normalized.startsWith('#x');
    const digits = normalized.slice(isHex ? 2 : 1);
    const codePoint = Number.parseInt(digits, isHex ? 16 : 10);

    if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }

    return match;
  }

  return NAMED_HTML_ENTITIES[normalized] ?? match;
}

export function htmlToPlainText(value) {
  if (!value) return '';

  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/gi, decodeHtmlEntity)
    .replace(/\s+/g, ' ')
    .trim();
}
