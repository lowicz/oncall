/**
 * Heading slugs are the anchors every `#link` in docs/ is checked against, so
 * ordinary headings must keep the slug they have, and tag-like text must not
 * leave a tag, or the start of one, behind.
 */
import { describe, expect, it } from 'vitest'
import { slugify } from './heading-slug.mjs'

describe('slugify', () => {
  it.each([
    ['Dni wolne i stawka 2X', 'dni-wolne-i-stawka-2x'],
    ['Grafik: macierz osób × dni', 'grafik-macierz-osób-dni'],
    ['Powiązanie zmiany 11–19', 'powiązanie-zmiany-1119'],
    ['  Zażółć  gęślą  jaźń  ', 'zażółć-gęślą-jaźń'],
    ['a < b', 'a-b'],
  ])('keeps the slug of an ordinary heading: %s', (heading, slug) => {
    expect(slugify(heading)).toBe(slug)
  })

  it('takes the text of inline HTML and drops its tags', () => {
    expect(slugify('Tryb <code>tygodniowy</code>')).toBe('tryb-tygodniowy')
  })

  it.each([
    ['<scr<script>ipt>alert(1)</script>', 'alert1'],
    ['<<script>script>x', 'x'],
    ['a <b <c> d> e', 'a-e'],
    ['<<<<b>>>>tekst', 'tekst'],
    ['<b><i>x</i></b><b>y</b>', 'xy'],
  ])('leaves no tag behind when tags are nested or repeated: %s', (heading, slug) => {
    expect(slugify(heading)).toBe(slug)
  })
})
