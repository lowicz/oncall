import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Rgb { r: number; g: number; b: number }
interface Rgba extends Rgb { a: number }

const css = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8')
const dark = css.match(/:root \{([\s\S]*?)\n\}/)![1]
const light = css.match(/:root\[data-theme='light'\] \{([\s\S]*?)\n\}/)![1]

function token(block: string, name: string) {
  const pattern = new RegExp(`--${name}:\\s*([^;]+);`)
  const value = (pattern.exec(block) ?? pattern.exec(dark))?.[1].trim()
  if (!value) throw new Error(`Missing token: ${name}`)
  return value
}

function rgb(value: string): Rgb {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value)
  if (!match) throw new Error(`Expected a hex colour: ${value}`)
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) }
}

function rgba(value: string): Rgba {
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value)
  if (!match) throw new Error(`Expected an rgba colour: ${value}`)
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) }
}

function composite(foreground: Rgba, background: Rgb): Rgb {
  const channel = (front: number, back: number) => front * foreground.a + back * (1 - foreground.a)
  return {
    r: channel(foreground.r, background.r),
    g: channel(foreground.g, background.g),
    b: channel(foreground.b, background.b),
  }
}

function luminance(color: Rgb) {
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrast(foreground: Rgb, background: Rgb) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme text tokens', (_, theme) => {
  it('keeps dim and role text readable on the deepest surfaces', () => {
    for (const foreground of ['dim', 'sec-text', 'late-text']) {
      expect(contrast(rgb(token(theme, foreground)), rgb(token(theme, 's3')))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps secondary text readable on the weekend header wash', () => {
    const background = composite(rgba(token(theme, 'wknd')), rgb(token(theme, 's2')))
    for (const foreground of ['muted', 'dim']) {
      expect(contrast(rgb(token(theme, foreground)), background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['error', 'bad-text', 'bad-bg'],
    ['warning', 'warn-text', 'warn-bg'],
  ])('keeps %s text readable on every surface and its wash', (_, text, washToken) => {
    const foreground = rgb(token(theme, text))
    const wash = rgba(token(theme, washToken))
    for (const surface of ['s1', 's2', 's3']) {
      const background = rgb(token(theme, surface))
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(foreground, composite(wash, background))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps text on the action band readable without a translucent field', () => {
    expect(contrast(rgb(token(theme, 'band-ink')), rgb(token(theme, 'act')))).toBeGreaterThanOrEqual(4.5)
  })
})
