import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AvailabilityMark, Avatar, Chip, ChipRow, DeviationBar, RoleLabel, RoleMark, StatusBadge, Tag } from './Status'

describe('badges and tags', () => {
  it('draw a status badge in its tone, muted by default', () => {
    const { rerender } = render(<StatusBadge tone="pub" className="b">Opublikowany</StatusBadge>)
    expect(screen.getByText('Opublikowany')).toHaveClass('st', 'st-pub', 'b')
    rerender(<StatusBadge>Szkic</StatusBadge>)
    expect(screen.getByText('Szkic')).toHaveClass('st', 'st-muted')
  })

  it('draw a tag, toned when asked', () => {
    const { rerender } = render(<Tag tone="late" className="t">11–19</Tag>)
    expect(screen.getByText('11–19')).toHaveClass('tag', 'tag-late', 't')
    rerender(<Tag>v3</Tag>)
    expect(screen.getByText('v3').className).toBe('tag')
  })
})

describe('Chip', () => {
  it('is a button when it leads somewhere', () => {
    const onClick = vi.fn()
    render(<Chip tone="bad" onClick={onClick} title="Pokaż luki" className="c">2 luki</Chip>)
    const chip = screen.getByRole('button', { name: '2 luki' })
    expect(chip).toHaveClass('chip', 'chip-bad', 'chip-btn', 'c')
    expect(chip).toHaveAttribute('title', 'Pokaż luki')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is plain text otherwise', () => {
    render(<Chip>Bez zmian</Chip>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Bez zmian')).toHaveClass('chip', 'chip-muted')
  })

  it('rows are a named list only when labelled', () => {
    const { container, rerender } = render(<ChipRow label="Ryzyka" className="r"><span>a</span></ChipRow>)
    expect(screen.getByRole('list', { name: 'Ryzyka' })).toHaveClass('risk', 'r')
    rerender(<ChipRow><span>a</span></ChipRow>)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('risk')
  })
})

describe('role marks', () => {
  it('draw each role on its colour, with the change index', () => {
    const { rerender } = render(<RoleMark role="primary" change="swap" size="sm" className="m" />)
    expect(screen.getByText('P')).toHaveClass('rm', 'rm-p', 'rm-sw', 'rm-sm', 'm')
    rerender(<RoleMark role="secondary" change="manual_override" />)
    expect(screen.getByText('S')).toHaveClass('rm-s', 'rm-ko')
    expect(screen.getByText('S')).not.toHaveClass('rm-sw')
    rerender(<RoleMark role="late_shift" change={null} />)
    expect(screen.getByText('11–19').className).toBe('rm rm-l')
  })

  it('name the role in full', () => {
    render(<><RoleLabel role="primary" className="x" /><RoleLabel role="late_shift" /></>)
    expect(screen.getByText('PRIMARY')).toHaveClass('lbl', 'lbl-p', 'x')
    expect(screen.getByText('11–19')).toHaveClass('lbl-l')
  })
})

describe('AvailabilityMark', () => {
  it('spells the code out for a screen reader and in the tooltip', () => {
    render(<AvailabilityMark kind="unavailable" className="a" />)
    const code = screen.getByText('N')
    expect(code).toHaveClass('am', 'am-na')
    expect(code).toHaveAttribute('title', 'Nie mogę')
    expect(code).not.toHaveAttribute('aria-hidden')
    expect(screen.getByText('Nie mogę')).toHaveClass('sr-only')
    expect(code.parentElement).toHaveClass('am-wrap', 'a')
  })

  it('shows the label beside the code when asked, hiding the letter', () => {
    render(<AvailabilityMark kind="prefer" withLabel />)
    const code = screen.getByText('C')
    expect(code).toHaveClass('am-ch')
    expect(code).toHaveAttribute('aria-hidden', 'true')
    expect(code).not.toHaveAttribute('title')
    expect(screen.getByText('Chętnie wezmę')).not.toHaveClass('sr-only')
  })
})

describe('Avatar', () => {
  it('shows up to two initials', () => {
    const { container } = render(<Avatar name="  jan  maria kowal " size={40} className="big" />)
    const avatar = container.firstElementChild as HTMLElement
    expect(avatar).toHaveTextContent(/^JM$/)
    expect(avatar).toHaveClass('ava', 'big')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar.style.width).toBe('40px')
    expect(avatar.style.height).toBe('40px')
  })

  it('shows a question mark for a person with no name', () => {
    const { container } = render(<Avatar name=" " />)
    expect(container.firstElementChild).toHaveTextContent(/^\?$/)
  })

  it('shows the photo, falls back to initials when it fails, and tries a new photo afresh', () => {
    const { container, rerender } = render(<Avatar name="Jan Kowal" src="data:image/png;base64,AAA" />)
    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAA')
    expect(img).toHaveAttribute('alt', '')
    expect(container.firstElementChild).toHaveClass('ava-photo')

    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstElementChild).toHaveTextContent('JK')
    expect(container.firstElementChild).not.toHaveClass('ava-photo')

    rerender(<Avatar name="Jan Kowal" src="data:image/png;base64,BBB" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,BBB')
  })
})

describe('DeviationBar', () => {
  const bar = () => screen.getByRole('img')

  it('extends right in amber above the fair share', () => {
    const { container } = render(<DeviationBar value={1.5} max={3} className="d" />)
    expect(bar()).toHaveAccessibleName('odchylenie +1,5')
    expect(bar()).toHaveClass('dev', 'd')
    const fill = container.querySelector('i')!
    expect(fill).toHaveClass('dev-over')
    expect(fill.style.width).toBe('25%')
    expect(screen.getByText('+1,5')).toHaveClass('dev-v', 'dev-v-over')
  })

  it('extends left below it, capped at a full half', () => {
    const { container } = render(<DeviationBar value={-9} max={3} label="Jan: -9" />)
    expect(bar()).toHaveAccessibleName('Jan: -9')
    const fill = container.querySelector('i')!
    expect(fill).toHaveClass('dev-under')
    expect(fill.style.width).toBe('50%')
    expect(screen.getByText('-9,0')).toHaveClass('dev-v-under')
  })

  it('draws no bar at zero, even with a zero scale, and can hide the value', () => {
    const { container, rerender } = render(<DeviationBar value={0} max={0} />)
    expect(container.querySelector('i')!.style.width).toBe('0%')
    expect(screen.getByText('0,0').className).toBe('dev-v')
    rerender(<DeviationBar value={0} max={0} showValue={false} />)
    expect(screen.queryByText('0,0')).not.toBeInTheDocument()
  })
})
