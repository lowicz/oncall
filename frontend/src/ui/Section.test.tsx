import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Box, KeyValue, List, ListHeading, ListRow, PageHeader, Panelbox, SectionHeading, SrOnly, Steps } from './Section'

describe('PageHeader', () => {
  it('shows the eyebrow, the title, the context and the actions', () => {
    const { container } = render(
      <PageHeader eyebrow="Grafik" title="Wrzesień 2026" sub="4 tygodnie" actions={<button>Publikuj</button>} className="top" />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Wrzesień 2026' })).toBeInTheDocument()
    expect(screen.getByText('Grafik')).toHaveClass('ph-eyebrow')
    expect(screen.getByText('4 tygodnie')).toHaveClass('ph-sub')
    expect(screen.getByRole('button', { name: 'Publikuj' }).parentElement).toHaveClass('ph-actions')
    expect(container.firstElementChild).toHaveClass('ph', 'top')
  })

  it('shows the title alone', () => {
    const { container } = render(<PageHeader title="Zamiany" />)
    expect(container.querySelector('.ph-eyebrow, .ph-sub, .ph-actions')).toBeNull()
  })
})

describe('SectionHeading', () => {
  it('is a level-two heading with meta and controls', () => {
    const { container } = render(<SectionHeading title="Dyżury" meta="12" controls={<button>Filtr</button>} id="duties" className="s" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Dyżury' })).toHaveAttribute('id', 'duties')
    expect(screen.getByText('12')).toHaveClass('sech-meta')
    expect(screen.getByRole('button', { name: 'Filtr' }).parentElement).toHaveClass('sech-ctl')
    expect(container.firstElementChild).toHaveClass('sech', 's')
  })

  it('can be a level-three heading with nothing beside it', () => {
    const { container } = render(<SectionHeading title="Szczegóły" as="h3" />)
    expect(screen.getByRole('heading', { level: 3, name: 'Szczegóły' })).toBeInTheDocument()
    expect(container.querySelector('.sech-meta, .sech-ctl')).toBeNull()
  })
})

describe('surfaces', () => {
  it('draw a panel, padded on request', () => {
    const { container, rerender } = render(<Panelbox padded className="p">x</Panelbox>)
    expect(container.firstElementChild).toHaveClass('panel', 'panel-padded', 'p')
    rerender(<Panelbox>x</Panelbox>)
    expect(container.firstElementChild).not.toHaveClass('panel-padded')
  })

  it('draw a callout in its tone, with an optional title and role', () => {
    const { container, rerender } = render(<Box tone="warn" title="Uwaga" role="alert" className="b">Treść</Box>)
    expect(screen.getByRole('alert')).toHaveClass('box', 'box-warn', 'b')
    expect(screen.getByText('Uwaga').tagName).toBe('B')
    rerender(<Box>Notatka</Box>)
    expect(container.firstElementChild).toHaveClass('box-muted')
    expect(container.querySelector('b')).toBeNull()
    expect(container.firstElementChild).not.toHaveAttribute('role')
  })
})

describe('KeyValue', () => {
  it('pairs each key with its value, monospace where asked', () => {
    render(<KeyValue className="kv2" items={[{ key: 'Wersja', value: '3', mono: true }, { key: 'Stan', value: 'Szkic' }]} />)
    const terms = screen.getAllByRole('term')
    const values = screen.getAllByRole('definition')
    expect(terms.map((term) => term.textContent)).toEqual(['Wersja', 'Stan'])
    expect(values[0]).toHaveClass('mono')
    expect(values[1]).not.toHaveClass('mono')
    expect(terms[0].closest('dl')).toHaveClass('kv', 'kv2')
  })
})

describe('Steps', () => {
  it('marks the current stage for assistive technology', () => {
    render(<Steps label="Etapy zamiany" className="st" steps={[
      { label: 'Wniosek', state: 'done' },
      { label: 'Zgoda', state: 'on' },
      { label: 'Zatwierdzenie', state: 'todo' },
    ]} />)
    const list = screen.getByRole('list', { name: 'Etapy zamiany' })
    expect(list).toHaveClass('steps', 'st')
    const [done, on, todo] = screen.getAllByRole('listitem')
    expect(done).toHaveClass('step-done')
    expect(done).not.toHaveAttribute('aria-current')
    expect(on).toHaveAttribute('aria-current', 'step')
    expect(todo).toHaveClass('step-todo')
  })
})

describe('lists', () => {
  it('draw rows with an aside, a highlight and a tone', () => {
    const { container } = render(
      <List className="l">
        <ListHeading>Wrzesień</ListHeading>
        <ListRow aside={<span>12</span>} highlight tone="bad" className="r">Jan</ListRow>
        <ListRow>Ola</ListRow>
      </List>,
    )
    expect(container.firstElementChild).toHaveClass('list', 'l')
    expect(screen.getByText('Wrzesień')).toHaveClass('list-h')
    const rows = container.querySelectorAll('.list-row')
    expect(rows[0]).toHaveClass('list-row-hl', 'list-row-bad', 'r')
    expect(rows[0].querySelector('.list-aside')).toHaveTextContent('12')
    expect(rows[1].className).toBe('list-row')
    expect(rows[1].querySelector('.list-aside')).toBeNull()
  })

  it('hide screen-reader text visually', () => {
    render(<SrOnly>tylko dla czytnika</SrOnly>)
    expect(screen.getByText('tylko dla czytnika')).toHaveClass('sr-only')
  })
})
