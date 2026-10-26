/** Export tests. Spec §9.1: the HTML must be valid, complete and self-contained. */

import { describe, expect, it } from 'vitest'
import { diffDocuments } from './diffEngine.ts'
import {
  buildReportHtml,
  buildRedlineFragment,
  escapeHtml,
  printReport,
  reportFileName,
} from './export.ts'
import { docOf, runs } from '../test/helpers.ts'
import { makeParagraph, type ParsedDocument } from '../types/document.ts'
import { APP_VERSION } from '../version.ts'

const diff = diffDocuments(
  docOf(
    'SOP-QA-017_v1.odt',
    'Deviation Management',
    'The Quality Assurance Manager shall review all deviations within five days.',
    'This clause was withdrawn.',
  ),
  docOf(
    'SOP-QA-017_v2.odt',
    'Deviation Management',
    'The Quality Assurance Manager shall assess all deviations within five days.',
    'Records are retained for ten years.',
  ),
)

function parseReport(html: string): Document {
  const document = new DOMParser().parseFromString(html, 'text/html')
  expect(document.querySelectorAll('parsererror')).toHaveLength(0)
  return document
}

describe('HTML report', () => {
  const html = buildReportHtml(diff)
  const report = parseReport(html)

  it('is a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(report.querySelector('title')?.textContent).toContain('SOP-QA-017_v1.odt')
    expect(report.querySelectorAll('style')).toHaveLength(1)
  })

  it('references nothing outside itself, so it renders offline and unchanged', () => {
    expect(report.querySelectorAll('script')).toHaveLength(0)
    expect(report.querySelectorAll('link')).toHaveLength(0)
    expect(report.querySelectorAll('img')).toHaveLength(0)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('contains both view modes', () => {
    const headings = [...report.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual(['Side by side', 'Merged (redlined)'])
    expect(report.querySelector('table.sbs')).not.toBeNull()
  })

  it('carries the metadata a filed report needs', () => {
    const text = report.body.textContent ?? ''
    expect(text).toContain('SOP-QA-017_v1.odt')
    expect(text).toContain('SOP-QA-017_v2.odt')
    expect(text).toContain(APP_VERSION)
    expect(text).toContain(diff.generatedAt)
    expect(text).toMatch(/words added/)
  })

  it('marks the changed words and leaves the rest as running text', () => {
    const deletions = [...report.querySelectorAll('del')].map((el) => el.textContent)
    const insertions = [...report.querySelectorAll('ins')].map((el) => el.textContent)

    expect(deletions).toContain('review')
    expect(insertions).toContain('assess')

    // The unchanged part of the sentence is present and unmarked.
    const merged = report.body.textContent ?? ''
    expect(merged).toContain('The Quality Assurance Manager shall')
  })

  it("reproduces the document's own emphasis", () => {
    const styled = (fileName: string, role: string): ParsedDocument => ({
      fileName,
      format: 'odt',
      byteSize: 0,
      paragraphs: [makeParagraph(0, runs(['Approved by the '], [role, { bold: true }]))],
    })

    const parsed = parseReport(
      buildReportHtml(diffDocuments(styled('a.odt', 'Manager'), styled('b.odt', 'Director'))),
    )

    expect(parsed.querySelector('del strong')?.textContent).toBe('Manager')
    expect(parsed.querySelector('ins strong')?.textContent).toBe('Director')
  })

  it('explains the colour coding in words as well as colour', () => {
    expect(report.querySelector('.legend')?.textContent).toMatch(/removed/i)
    expect(report.querySelector('.legend')?.textContent).toMatch(/added/i)
  })

  it('escapes document content instead of letting it become markup', () => {
    const risky = diffDocuments(
      docOf('a.txt', 'Plain'),
      docOf('b.txt', 'Plain <script>alert(1)</script> & <b>bold</b>'),
    )
    const rendered = buildReportHtml(risky)
    const parsed = parseReport(rendered)

    expect(parsed.querySelectorAll('script')).toHaveLength(0)
    expect(parsed.querySelectorAll('b')).toHaveLength(0)
    expect(parsed.body.textContent).toContain('<script>alert(1)</script>')
  })

  it('reports an identical pair without inventing changes', () => {
    const same = diffDocuments(docOf('a.txt', 'Identical text'), docOf('b.txt', 'Identical text'))
    const parsed = parseReport(buildReportHtml(same))

    // The only marks in the document are the two in the legend that explain
    // what the marks mean.
    expect(parsed.querySelectorAll('.legend del')).toHaveLength(1)
    expect(parsed.querySelectorAll('.legend ins')).toHaveLength(1)
    expect(parsed.querySelectorAll('del')).toHaveLength(1)
    expect(parsed.querySelectorAll('ins')).toHaveLength(1)
    expect(parsed.body.textContent).toContain('No differences found')
  })
})

describe('clipboard fragment', () => {
  const fragment = buildRedlineFragment(diff)

  it('carries its colours inline, since pasted <style> blocks are dropped', () => {
    expect(fragment).toContain('<del style="color:#B91C1C;text-decoration:line-through">')
    // Shading, not underline, marks an insertion — underline is a formatting
    // change the tool reports, so it must not be mistaken for the document's own.
    expect(fragment).toContain('<ins style="color:#166534;background-color:#A7F3C0;text-decoration:none">')
    expect(fragment).not.toContain('<style')
  })

  it('keeps headings as headings, so the pasted text keeps its structure', () => {
    const heading = (fileName: string, title: string): ParsedDocument => ({
      fileName,
      format: 'odt',
      byteSize: 0,
      paragraphs: [
        makeParagraph(0, runs([title]), { kind: 'heading', level: 2, styleName: 'Heading 2' }),
      ],
    })

    const structured = buildRedlineFragment(
      diffDocuments(heading('a.odt', 'Deviation Management'), heading('b.odt', 'Deviation Control')),
    )
    expect(structured).toMatch(/^<div [^>]*><h2>/)
    expect(structured).toContain('Deviation')
  })
})

describe('report file name', () => {
  it('names the file after both documents and the comparison date', () => {
    expect(reportFileName(diff)).toBe(
      `comparison_SOP-QA-017_v1_vs_SOP-QA-017_v2_${diff.generatedAt.slice(0, 10)}.html`,
    )
  })

  it('strips characters that would break a file name', () => {
    const awkward = diffDocuments(docOf('a b/c:d.txt', 'x'), docOf('e*f?.txt', 'y'))
    expect(reportFileName(awkward)).not.toMatch(/[/:*?"<>|]/)
  })
})

describe('tables in the report', () => {
  function tableDoc(fileName: string, rows: string[][]): ParsedDocument {
    return {
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
    }
  }

  const tableDiff = diffDocuments(
    tableDoc('a.docx', [
      ['Role', 'Frequency'],
      ['QA Manager', 'Daily'],
    ]),
    tableDoc('b.docx', [
      ['Role', 'Frequency'],
      ['QA Director', 'Daily'],
    ]),
  )

  it('draws a table as a grid, not as a run of loose paragraphs', () => {
    const parsed = parseReport(buildReportHtml(tableDiff))
    const grids = parsed.querySelectorAll('table.grid')

    // One grid per view: side-by-side draws it twice, merged once.
    expect(grids.length).toBe(3)
    for (const grid of grids) {
      expect(grid.querySelectorAll('tr')).toHaveLength(2)
      expect(grid.querySelectorAll('tr')[1].querySelectorAll('td')).toHaveLength(2)
    }
  })

  it('keeps the original cell wording in the original column', () => {
    const parsed = parseReport(buildReportHtml(tableDiff))
    const grids = parsed.querySelectorAll('table.grid')
    const originalCell = grids[0].querySelectorAll('tr')[1].querySelectorAll('td')[0]
    const revisedCell = grids[1].querySelectorAll('tr')[1].querySelectorAll('td')[0]

    expect(originalCell.textContent).toContain('Manager')
    expect(originalCell.textContent).not.toContain('Director')
    expect(revisedCell.textContent).toContain('Director')
    expect(revisedCell.textContent).not.toContain('Manager')
  })
})

describe('print / PDF', () => {
  const css = () => {
    const style = parseReport(buildReportHtml(diff)).querySelector('style')!.textContent!
    return style.slice(style.indexOf('@page'))
  }

  it('gives the cover its own page and starts each view on a new one', () => {
    expect(css()).toContain('.meta { break-after: page; }')
    expect(css()).toContain('h2 { break-before: page; }')
  })

  it('never splits a single change across a page break', () => {
    // A change torn in half by a page boundary is a change a reviewer can
    // misread, which is the failure this whole tool exists to prevent.
    expect(css()).toMatch(/tr, \.row, table\.grid td \{ break-inside: avoid; \}/)
  })

  it('repeats the column headings on every page', () => {
    // Without this the second page of a long side-by-side gives no clue which
    // column is the original.
    expect(css()).toContain('thead { display: table-header-group; }')
  })

  it('forces the change colours to survive printing', () => {
    // Browsers drop backgrounds by default to save ink; here they carry meaning.
    expect(css()).toContain('print-color-adjust: exact')
  })

  it('sets a page size and margins', () => {
    expect(css()).toContain('@page { size: A4; margin: 16mm 12mm; }')
  })

  it('renders the report into a frame and asks the browser to print it', async () => {
    const printed: string[] = []
    const framesBefore = document.querySelectorAll('iframe').length

    // jsdom has no print implementation, so it is stubbed on the frame's window
    // as soon as one is created.
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get() {
        const view = original.get!.call(this) as (Window & { print: () => void }) | null
        if (view) {
          view.print = () => printed.push(this.srcdoc as string)
          view.focus = () => {}
        }
        return view
      },
    })

    try {
      await printReport(diff)
      expect(printed).toHaveLength(1)
      expect(printed[0]).toContain('Document comparison')
      expect(printed[0]).toContain('SOP-QA-017_v1.odt')
    } finally {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', original)
    }

    // The frame is removed on a timer, so it may still be present here; what
    // matters is that printing did not leave one per click permanently.
    expect(document.querySelectorAll('iframe').length).toBeLessThanOrEqual(framesBefore + 1)
  })
})

describe('escapeHtml', () => {
  it('escapes every character that could open a tag or close an attribute', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('escapes the ampersand first, so escapes are not double-escaped', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})
