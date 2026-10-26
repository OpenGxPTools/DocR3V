/**
 * View tests. Spec §10 requires both view modes to render correctly, and both
 * to reach the same conclusions — they share a diff, so the risk is not that
 * they disagree but that one of them silently drops something.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ComparisonView } from './ComparisonView.tsx'
import { MergedView } from './MergedView.tsx'
import { SideBySideView } from './SideBySideView.tsx'
import { diffDocuments } from '../services/diffEngine.ts'
import { docOf, runs } from '../test/helpers.ts'
import { makeParagraph, type ParsedDocument } from '../types/document.ts'

const diff = diffDocuments(
  docOf(
    'SOP_v1.odt',
    'Deviation Management',
    'The Quality Assurance Manager shall review all deviations within five days.',
    'This clause was withdrawn.',
    'Unrelated closing paragraph.',
  ),
  docOf(
    'SOP_v2.odt',
    'Deviation Management',
    'The Quality Assurance Manager shall assess all deviations within five days.',
    'Records are retained for ten years.',
    'Unrelated closing paragraph.',
  ),
)

describe('side-by-side view', () => {
  it('shows deletions on the left and additions on the right', () => {
    const { container } = render(
      <SideBySideView paragraphs={diff.paragraphs} showFormattingNotes />,
    )

    const rows = container.querySelectorAll('[data-status]')
    const edited = [...rows].find((row) => row.getAttribute('data-status') === 'modified')!
    const [left, right] = edited.querySelectorAll(':scope > div')

    expect(within(left as HTMLElement).getByText('review')).toBeInTheDocument()
    expect(within(left as HTMLElement).queryByText('assess')).toBeNull()
    expect(within(right as HTMLElement).getByText('assess')).toBeInTheDocument()
    expect(within(right as HTMLElement).queryByText('review')).toBeNull()
  })

  it('reads as the original document down the left column', () => {
    const { container } = render(
      <SideBySideView paragraphs={diff.paragraphs} showFormattingNotes />,
    )
    const rows = container.querySelectorAll('[data-status]')
    const edited = [...rows].find((row) => row.getAttribute('data-status') === 'modified')!
    const left = edited.querySelector(':scope > div') as HTMLElement

    expect(left.textContent).toContain(
      'The Quality Assurance Manager shall review all deviations within five days.',
    )
  })

  it('leaves a placeholder where a paragraph exists on only one side', () => {
    render(<SideBySideView paragraphs={diff.paragraphs} showFormattingNotes />)
    expect(screen.getByText('Not in the revision')).toBeInTheDocument()
    expect(screen.getByText('Not in the original')).toBeInTheDocument()
  })

  it('marks changes with elements screen readers announce, not colour alone', () => {
    const { container } = render(
      <SideBySideView paragraphs={diff.paragraphs} showFormattingNotes />,
    )
    expect(container.querySelectorAll('del').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('ins').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Edited paragraph/)).not.toHaveLength(0)
  })
})

describe('merged view', () => {
  const props = {
    paragraphs: diff.paragraphs,
    showFormattingNotes: true,
    hideDeletions: false,
    hideAdditions: false,
  }

  it('shows both sides of an edit in document order', () => {
    const { container } = render(<MergedView {...props} />)
    const edited = container.querySelector('[data-status="modified"]')!

    expect(edited.textContent).toBe(
      'Edited: The Quality Assurance Manager shall review assess all deviations within five days.',
    )
    expect(within(edited as HTMLElement).getByText('review').tagName).toBe('DEL')
    expect(within(edited as HTMLElement).getByText('assess').tagName).toBe('INS')
  })

  it('hiding deletions leaves the revised text readable on its own', () => {
    const { container } = render(<MergedView {...props} hideDeletions />)

    expect(container.querySelectorAll('del')).toHaveLength(0)
    expect(container.textContent).toContain(
      'The Quality Assurance Manager shall assess all deviations within five days.',
    )
    // A paragraph that only ever existed in the original disappears entirely.
    expect(container.textContent).not.toContain('This clause was withdrawn')
  })

  it('hiding additions leaves the original text readable on its own', () => {
    const { container } = render(<MergedView {...props} hideAdditions />)

    expect(container.querySelectorAll('ins')).toHaveLength(0)
    expect(container.textContent).toContain(
      'The Quality Assurance Manager shall review all deviations within five days.',
    )
    expect(container.textContent).not.toContain('Records are retained for ten years')
  })
})

describe('tables in the views', () => {
  /** Two one-table documents differing in the cells given. */
  function tableDocs(before: string[][], after: string[][]) {
    const build = (fileName: string, rows: string[][]): ParsedDocument => ({
      fileName,
      format: 'docx',
      byteSize: 0,
      paragraphs: rows.flatMap((cells, row) =>
        cells.map((text, column) =>
          makeParagraph(row * cells.length + column, runs([text]), {
            cell: { table: 0, row, column, offset: 0 },
          }),
        ),
      ),
    })
    return diffDocuments(build('a.docx', before), build('b.docx', after))
  }

  const base = [
    ['Role', 'Frequency'],
    ['QA Manager', 'Daily'],
  ]

  it('renders a table as a grid rather than as loose paragraphs', () => {
    const diff = tableDocs(base, [
      ['Role', 'Frequency'],
      ['QA Director', 'Daily'],
    ])
    const { container } = render(
      <MergedView
        paragraphs={diff.paragraphs}
        showFormattingNotes
        hideDeletions={false}
        hideAdditions={false}
      />,
    )

    const rows = container.querySelectorAll('tr')
    expect(rows).toHaveLength(2)
    expect(rows[1].querySelectorAll('td')).toHaveLength(2)
    // The edit stays inside its own cell instead of leaking into the next one.
    expect(rows[1].querySelectorAll('td')[0].textContent).toBe('QA Manager Director')
    expect(rows[1].querySelectorAll('td')[1].textContent).toBe('Daily')
  })

  it('keeps a cell that is empty in one version so the row stays aligned', () => {
    const diff = tableDocs(
      [
        ['Role', 'Frequency'],
        ['', 'Daily'],
      ],
      [
        ['Role', 'Frequency'],
        ['Operator', 'Daily'],
      ],
    )
    const { container } = render(
      <SideBySideView paragraphs={diff.paragraphs} showFormattingNotes />,
    )

    // Both columns must still show two cells in the second row, or "Daily"
    // slides left and is compared against the wrong column.
    for (const table of container.querySelectorAll('table')) {
      expect(table.querySelectorAll('tr')[1].querySelectorAll('td')).toHaveLength(2)
    }
  })

  it('draws a merged cell as one spanning cell, not several with blanks', () => {
    // The reported defect: a cell merged across two columns appeared as two
    // cells, the second empty, which misrepresents the layout of a controlled
    // document that the reviewer is checking against its original.
    const build = (fileName: string, role: string): ParsedDocument => ({
      fileName,
      format: 'docx',
      byteSize: 0,
      paragraphs: [
        makeParagraph(0, runs(['Responsibilities']), {
          cell: { table: 0, row: 0, column: 0, offset: 0, columnSpan: 2 },
        }),
        makeParagraph(1, runs([role]), { cell: { table: 0, row: 1, column: 0, offset: 0 } }),
        makeParagraph(2, runs(['Daily']), { cell: { table: 0, row: 1, column: 1, offset: 0 } }),
      ],
    })

    const diff = diffDocuments(build('a.docx', 'QA Manager'), build('b.docx', 'QA Director'))
    const { container } = render(
      <MergedView
        paragraphs={diff.paragraphs}
        showFormattingNotes
        hideDeletions={false}
        hideAdditions={false}
      />,
    )

    const rows = container.querySelectorAll('tr')
    const headingCells = rows[0].querySelectorAll('td')
    expect(headingCells).toHaveLength(1)
    expect(headingCells[0].getAttribute('colspan')).toBe('2')
    expect(headingCells[0].textContent).toBe('Responsibilities')

    // The row beneath keeps both of its own cells.
    expect(rows[1].querySelectorAll('td')).toHaveLength(2)
  })

  it('draws a row-spanning cell once and lets the rows beside it fill in', () => {
    const build = (fileName: string, task: string): ParsedDocument => ({
      fileName,
      format: 'docx',
      byteSize: 0,
      paragraphs: [
        makeParagraph(0, runs(['QA Manager']), {
          cell: { table: 0, row: 0, column: 0, offset: 0, rowSpan: 2 },
        }),
        makeParagraph(1, runs(['Approve deviations']), {
          cell: { table: 0, row: 0, column: 1, offset: 0 },
        }),
        makeParagraph(2, runs([task]), { cell: { table: 0, row: 1, column: 1, offset: 0 } }),
      ],
    })

    const diff = diffDocuments(build('a.docx', 'Review records'), build('b.docx', 'Review batches'))
    const { container } = render(
      <SideBySideView paragraphs={diff.paragraphs} showFormattingNotes />,
    )

    for (const table of container.querySelectorAll('table')) {
      const rows = table.querySelectorAll('tr')
      expect(rows[0].querySelectorAll('td')[0].getAttribute('rowspan')).toBe('2')
      // The second row holds only the cell beside the merge, not a duplicate
      // of the merged one.
      expect(rows[1].querySelectorAll('td')).toHaveLength(1)
      expect(rows[1].textContent).not.toContain('QA Manager')
    }
  })

  it('drops a wholly added row from the merged view when additions are hidden', () => {
    const diff = tableDocs(base, [
      ['Role', 'Frequency'],
      ['QA Manager', 'Daily'],
      ['Operator', 'Weekly'],
    ])
    const { container } = render(
      <MergedView
        paragraphs={diff.paragraphs}
        showFormattingNotes
        hideDeletions={false}
        hideAdditions
      />,
    )

    expect(container.textContent).not.toContain('Operator')
    expect(container.querySelectorAll('tr')).toHaveLength(2)
  })
})

describe('large documents', () => {
  /**
   * Spec §4: under 3 seconds for a 500 KB document. The diff engine is not the
   * constraint — a 500 KB comparison costs about 50 ms — so what these guard is
   * the rendering strategy, which is where the other 95% of the time goes.
   */
  function bigDiff(count: number) {
    const build = (fileName: string, seed: number): ParsedDocument => ({
      fileName,
      format: 'txt',
      byteSize: 0,
      paragraphs: Array.from({ length: count }, (_, i) =>
        makeParagraph(i, runs([`${i}.1 The manager shall review deviations within ${i + seed} days.`])),
      ),
    })
    return diffDocuments(build('a.txt', 0), build('b.txt', 1))
  }

  it('marks every row so the browser can skip off-screen layout work', () => {
    const { container } = render(
      <SideBySideView paragraphs={bigDiff(60).paragraphs} showFormattingNotes />,
    )
    // Without row-shell a long comparison lays out every paragraph up front,
    // which roughly doubles the time to first view on a large document.
    expect(container.querySelectorAll('.row-shell').length).toBe(60)
  })

  it('keeps every paragraph in the DOM rather than windowing them away', () => {
    // Virtualisation would be faster still and would break find-in-page and
    // printing — both of which matter more than milliseconds in a GMP review.
    const diff = bigDiff(200)
    const { container } = render(
      <SideBySideView paragraphs={diff.paragraphs} showFormattingNotes />,
    )

    expect(container.querySelectorAll('[data-status]').length).toBe(200)
    expect(container.textContent).toContain('199.1 The manager shall review')
  })

  it('diffs a 2000-paragraph document well inside the time budget', () => {
    const started = performance.now()
    const diff = bigDiff(2000)
    const elapsed = performance.now() - started

    expect(diff.paragraphs).toHaveLength(2000)
    // Generous next to the 3s budget: this catches an algorithmic regression,
    // not a slow machine.
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('formatting notes', () => {
  function styled(fileName: string, bold: boolean): ParsedDocument {
    return {
      fileName,
      format: 'docx',
      byteSize: 0,
      paragraphs: [makeParagraph(0, runs(['Approved by the '], ['Quality Manager', { bold }]))],
    }
  }

  it('describes a formatting change in words rather than only showing it', () => {
    const formatting = diffDocuments(styled('a.docx', false), styled('b.docx', true))
    render(<MergedView paragraphs={formatting.paragraphs} showFormattingNotes hideDeletions={false} hideAdditions={false} />)

    expect(screen.getByText('“Quality Manager” is now bold')).toBeInTheDocument()
  })

  it("renders the document's own bold, so the text looks like the document", () => {
    const formatting = diffDocuments(styled('a.docx', false), styled('b.docx', true))
    const { container } = render(
      <MergedView
        paragraphs={formatting.paragraphs}
        showFormattingNotes
        hideDeletions={false}
        hideAdditions={false}
      />,
    )

    expect(container.querySelector('strong')?.textContent).toBe('Quality Manager')
    expect(container.querySelector('p, div')?.textContent).toContain('Approved by the Quality Manager')
  })

  it('shows each side with its own formatting, so a bolding change is visible in the columns', () => {
    const formatting = diffDocuments(styled('a.docx', false), styled('b.docx', true))
    const { container } = render(
      <SideBySideView paragraphs={formatting.paragraphs} showFormattingNotes />,
    )

    const [original, revised] = Array.from(container.querySelectorAll('[data-status] > div:not(.sr-only)'))
      .filter((cell) => cell.textContent?.includes('Quality Manager'))

    // The revision bolds the phrase; the original must not, or both columns
    // read identically and the change is invisible where it is looked for.
    expect(original?.querySelector('strong')).toBeNull()
    expect(revised?.querySelector('strong')?.textContent).toBe('Quality Manager')
  })

  it('keeps emphasis inside a changed word, marked as changed and as emphasis', () => {
    const before: ParsedDocument = {
      fileName: 'a.docx',
      format: 'docx',
      byteSize: 0,
      paragraphs: [makeParagraph(0, runs(['Escalate to the '], ['Manager', { bold: true }]))],
    }
    const after: ParsedDocument = {
      fileName: 'b.docx',
      format: 'docx',
      byteSize: 0,
      paragraphs: [makeParagraph(0, runs(['Escalate to the '], ['Director', { bold: true }]))],
    }

    const { container } = render(
      <MergedView
        paragraphs={diffDocuments(before, after).paragraphs}
        showFormattingNotes
        hideDeletions={false}
        hideAdditions={false}
      />,
    )

    expect(container.querySelector('del strong')?.textContent).toBe('Manager')
    expect(container.querySelector('ins strong')?.textContent).toBe('Director')
  })

  it('can be turned off without affecting the text', () => {
    const formatting = diffDocuments(styled('a.docx', false), styled('b.docx', true))
    const { container } = render(
      <MergedView
        paragraphs={formatting.paragraphs}
        showFormattingNotes={false}
        hideDeletions={false}
        hideAdditions={false}
      />,
    )

    expect(screen.queryByText(/is now bold/)).toBeNull()
    expect(container.textContent).toContain('Approved by the Quality Manager')
  })
})

describe('comparison screen', () => {
  it('opens on the side-by-side view and switches to merged', async () => {
    const user = userEvent.setup()
    render(<ComparisonView diff={diff} onReset={() => {}} />)

    expect(screen.getByRole('button', { name: 'Side by side' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Merged' }))
    expect(screen.getByRole('button', { name: 'Merged' })).toHaveAttribute('aria-pressed', 'true')
    // Merged view controls only appear in merged mode.
    expect(screen.getByLabelText('Deletions')).toBeInTheDocument()
  })

  it('summarises the comparison at the top', () => {
    render(<ComparisonView diff={diff} onReset={() => {}} />)

    expect(screen.getByText('words added')).toBeInTheDocument()
    expect(screen.getByText('words deleted')).toBeInTheDocument()
    expect(screen.getByText(/SOP_v1\.odt → SOP_v2\.odt/)).toBeInTheDocument()
  })

  it('filters to changes plus one paragraph of context on either side', async () => {
    const user = userEvent.setup()
    const { container } = render(<ComparisonView diff={diff} onReset={() => {}} />)

    // Four source paragraphs, but the withdrawn clause and its replacement are
    // unrelated, so they occupy a removed row and an added row.
    expect(container.querySelectorAll('[data-status]')).toHaveLength(5)

    await user.click(screen.getByLabelText('Changes only'))

    // Here every paragraph is either a change or adjacent to one, so nothing is
    // hidden and the filter reports no reduction.
    expect(screen.queryByText(/Showing \d+ of 5 paragraphs/)).toBeNull()
    expect(container.querySelectorAll('[data-status]')).toHaveLength(5)
  })

  it('hides paragraphs far from any change but keeps the ones either side', async () => {
    const user = userEvent.setup()
    const before = [
      'Alpha clause',
      'Bravo clause',
      'Charlie clause',
      'Delta clause',
      'Echo clause as written',
      'Foxtrot clause',
      'Golf clause',
      'Hotel clause',
    ]
    const after = [...before]
    after[4] = 'Echo clause as revised'

    const long = diffDocuments(docOf('a.txt', ...before), docOf('b.txt', ...after))
    const { container } = render(<ComparisonView diff={long} onReset={() => {}} />)

    await user.click(screen.getByLabelText('Changes only'))

    expect(screen.getByText(/Showing 3 of 8 paragraphs/)).toBeInTheDocument()
    expect(container.querySelectorAll('[data-status]')).toHaveLength(3)

    // The change plus one paragraph of context on each side.
    const text = [...container.querySelectorAll('[data-status]')]
      .map((row) => row.textContent)
      .join(' ')
    expect(text).toContain('Delta clause')
    expect(text).toContain('Echo clause')
    expect(text).toContain('Foxtrot clause')
    expect(text).not.toContain('Charlie clause')
    expect(text).not.toContain('Golf clause')
  })

  it('says how many changes there are to step through', () => {
    render(<ComparisonView diff={diff} onReset={() => {}} />)
    expect(screen.getByText('3 changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next change' })).toBeEnabled()
  })

  it('reports an identical pair plainly', () => {
    const identical = diffDocuments(docOf('a.txt', 'Same text'), docOf('b.txt', 'Same text'))
    render(<ComparisonView diff={identical} onReset={() => {}} />)

    expect(
      screen.getByText('No differences found — the two documents match word for word.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next change' })).toBeDisabled()
  })
})
