import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { loadRealMediaQuery, loadRealStylesheet } from './test/stylesheet'

describe('shared interaction styles', () => {
  it('never cuts the time on the "Teraz" strip, giving it a row of its own instead', () => {
    loadRealStylesheet()
    const { container } = render(<div className="now-slot"><span className="now-until">do pon 00:00 · 2 h 1 min</span></div>)
    const until = getComputedStyle(container.querySelector('.now-until')!)
    expect(until.textOverflow).not.toBe('ellipsis')
    expect(until.flexShrink).toBe('0')
    expect(getComputedStyle(container.querySelector('.now-slot')!).flexWrap).toBe('wrap')
  })

  it('raises toasts on a phone above the bottom tabs, within the thumb\'s reach', () => {
    loadRealMediaQuery('(max-width: 900px)')
    const { container } = render(<><div className="toasts" /><nav className="tabs-bottom" /></>)
    const toasts = getComputedStyle(container.querySelector('.toasts')!)
    expect(toasts.top).toBe('auto')
    expect(toasts.bottom).toBe('calc(72px + env(safe-area-inset-bottom))')
  })

  it('puts a list row\'s actions under its text on a phone', () => {
    loadRealMediaQuery('(max-width: 900px)')
    const { container } = render(<div className="list-row"><div className="list-main" /><div className="list-aside" /></div>)
    expect(getComputedStyle(container.querySelector('.list-row')!).gridTemplateColumns).toBe('minmax(0, 1fr)')
    expect(getComputedStyle(container.querySelector('.list-aside')!).justifyContent).toBe('flex-start')
  })

  it('keeps a panel\'s close button on the first line of a long title', () => {
    loadRealStylesheet()
    const { container } = render(<div className="panel-head"><div className="panel-heading" /><button className="panel-close" /></div>)
    expect(getComputedStyle(container.querySelector('.panel-head')!).flexWrap).not.toBe('wrap')
    const heading = getComputedStyle(container.querySelector('.panel-heading')!)
    expect(heading.flexWrap).toBe('wrap')
    expect(heading.minWidth).toBe('0px')
  })

  it('gives every button a 44 px coarse-pointer target', () => {
    loadRealMediaQuery('(pointer: coarse)')
    const { container } = render(
      <>
        <button type="button" className="btn btn-sm">Zapisz</button>
        <button type="button" className="ib ib-sm">X</button>
        <div className="seg seg-sm"><button type="button">Miesiąc</button></div>
        <span className="filter-chip">Jan<button type="button">×</button></span>
      </>,
    )
    const [button, icon, segment, chip] = Array.from(container.querySelectorAll('button'))
    expect(getComputedStyle(button).minHeight).toBe('44px')
    expect([getComputedStyle(icon).minWidth, getComputedStyle(icon).minHeight]).toEqual(['44px', '44px'])
    expect(getComputedStyle(segment).minHeight).toBe('44px')
    expect([getComputedStyle(chip).minWidth, getComputedStyle(chip).minHeight]).toEqual(['44px', '44px'])
  })

  it('stops motion without hiding loading indicators', () => {
    loadRealMediaQuery('(prefers-reduced-motion: reduce)')
    const { container } = render(
      <>
        <span className="spinner" />
        <span className="sk" />
        <div className="toast" />
        <div className="progress"><i /></div>
      </>,
    )
    const spinner = container.querySelector('.spinner')!
    const skeleton = container.querySelector('.sk')!
    expect(getComputedStyle(spinner).animationName).toBe('none')
    expect(getComputedStyle(skeleton).animationName).toBe('none')
    expect(getComputedStyle(spinner).display).toBe('inline-block')
    expect(getComputedStyle(skeleton).display).toBe('block')
    for (const moving of [container.querySelector('.toast')!, container.querySelector('.progress i')!]) {
      expect(getComputedStyle(moving).transition).toBe('none')
    }
  })

  it('draws state text with the readable text tokens', () => {
    loadRealStylesheet()
    const { container } = render(
      <>
        <div className="box box-bad"><b>Konflikt</b></div>
        <div className="box box-warn"><b>Brak dyżurów</b></div>
        <span className="tag tag-bad">brak</span>
        <span className="rank-fact-bad">kolizja</span>
        <button type="button" className="btn btn-bad">Usuń</button>
        <span className="role-r role-r-s">SECONDARY</span>
        <button type="button" className="avail-day avail-day-na">7</button>
        <button type="button" className="now-search">Szukaj</button>
      </>,
    )
    const style = (selector: string) => getComputedStyle(container.querySelector(selector)!)
    for (const selector of ['.box-bad > b', '.tag-bad', '.rank-fact-bad', '.btn-bad']) {
      expect(style(selector).color).toBe('var(--bad-text)')
    }
    expect(style('.box-warn > b').color).toBe('var(--warn-text)')
    expect(style('.role-r-s').color).toBe('var(--sec-text)')
    expect(style('.avail-day-na').color).toBe('var(--fg)')
    expect(style('.now-search').backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('reveals the skip link when it receives keyboard focus', () => {
    loadRealStylesheet()
    const { container } = render(<a className="sr-only skip-link" href="#tresc">Przejdź do treści</a>)
    const link = container.querySelector('a')!
    expect(getComputedStyle(link).position).toBe('absolute')
    link.focus()
    expect(getComputedStyle(link).position).toBe('fixed')
    expect(getComputedStyle(link).width).toBe('auto')
  })

  it('applies reusable layout modifiers instead of component inline styles', () => {
    loadRealStylesheet()
    const { container } = render(
      <>
        <div className="row row-between row-nowrap" />
        <div className="frow frow-end" />
        <a className="list-row-link" href="/">Link</a>
      </>,
    )
    const row = container.querySelector('.row')!
    expect(getComputedStyle(row).justifyContent).toBe('space-between')
    expect(getComputedStyle(row).flexWrap).toBe('nowrap')
    expect(getComputedStyle(container.querySelector('.frow')!).alignItems).toBe('end')
    expect(getComputedStyle(container.querySelector('a')!).textDecoration).toBe('none')
  })

  it('narrows role marks under compact density only inside the matrix', () => {
    loadRealStylesheet()
    document.documentElement.dataset.density = 'compact'
    const { container } = render(
      <>
        <table className="m"><tbody><tr><td><span className="rm">P</span></td></tr></tbody></table>
        <span className="rm">S</span>
      </>,
    )
    const [inMatrix, outside] = Array.from(container.querySelectorAll('.rm'))
    expect(getComputedStyle(inMatrix).width).toBe('auto')
    expect(getComputedStyle(outside).width).toBe('32px')
    delete document.documentElement.dataset.density
  })
})
