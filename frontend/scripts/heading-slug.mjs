/**
 * GitHub-compatible heading slug, so an anchor written against the Markdown
 * source resolves the same way in the rendered page.
 *
 * Inline HTML in a heading gives the slug its text, not its tags. Tags are
 * removed innermost first until none is left, so a tag written around another
 * one (`<scr<b>ipt>`) cannot close up into a new tag once the inner one is
 * gone; the character filter after it then drops any `<` or `>` left over.
 */
export const slugify = (text) =>
  withoutTags(text.toLowerCase())
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

function withoutTags(text) {
  let previous
  do {
    previous = text
    text = text.replace(/<[^<>]+>/g, '')
  } while (text !== previous)
  return text
}
