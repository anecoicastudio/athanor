/**
 * Line counts for labels that must never break a word in half (#754).
 *
 * iOS wraps by word, but a single word wider than its box has nowhere to go and breaks
 * mid-word — «Notifi / che» beside a header's actions at AX5, «@marco_acc / ardi» on Home.
 * A second line is only worth giving a label that has a second word to put on it; a lone
 * word takes one line and a tail ellipsis instead, with the full text on the element's
 * `accessibilityLabel`. No font cap and no `adjustsFontSizeToFit` — DESIGN §10.
 *
 * Whitespace here is every `\s` EXCEPT the no-break space: that is how a catalog string
 * glues a mark to its word («Connetti ✦»), so it must count as part of the word.
 */
const BREAK = /[^\S\u00a0]+/;

function words(text: string | null | undefined): string[] {
  return (text ?? '').split(BREAK).filter(Boolean);
}

/** `max` lines for a label with at least that many words; one for a single word. */
export function wordLines(text: string | null | undefined, max = 2): number {
  return Math.max(1, Math.min(max, words(text).length));
}

/**
 * The stories row's two stacked lines: the first word (a first name, or a handle), then the
 * rest (the surname). Each renders as its own one-line Text, so neither can break mid-word
 * and every entry keeps the same two-line box. A one-word label leaves the second line empty.
 */
export function nameLines(label: string): [string, string] {
  const [first = '', ...rest] = words(label);
  return [first, rest.join(' ')];
}
