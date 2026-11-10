/** Bound each native utterance; only the current paragraph is split on demand. */
export function* speechChunks(text, limit = 220) {
  if (!Number.isInteger(limit) || limit < 2) throw new RangeError('Speech chunks must fit at least one Unicode character.');
  let remaining = text.replace(/\s+/g, ' ').trim();
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit + 1);
    const sentence = [...candidate.matchAll(/[.!?;:]\s/g)].at(-1);
    let end = sentence && sentence.index > limit / 3 ? sentence.index + 1 : candidate.lastIndexOf(' ');
    if (end < 1) end = limit;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    yield remaining.slice(0, end).trim(); remaining = remaining.slice(end).trim();
  }
  if (remaining) yield remaining;
}
