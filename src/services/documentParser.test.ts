/** Parser tests. Spec §9.1: extraction, structure, formatting, graceful failure. */

import { describe, expect, it } from 'vitest'
import { detectFormat, formatBytes, parseBuffer, validateFile } from './documentParser.ts'
import { buildDocx, buildOdt, type FixtureParagraph } from '../test/builders.ts'
import { DocumentParseError, type Paragraph } from '../types/document.ts'

const SAMPLE: FixtureParagraph[] = [
  { heading: 1, text: 'Deviation Management' },
  { text: 'This procedure applies to all manufacturing deviations.' },
  {
    runs: [
      { text: 'Approved by the ' },
      { text: 'Quality Manager', bold: true },
      { text: ' before release.' },
    ],
  },
  { list: true, text: 'Record the deviation within 24 hours.' },
  { list: true, text: 'Notify the site head.' },
  { heading: 2, text: 'Responsibilities' },
  { runs: [{ text: 'Critical', italic: true }, { text: ' deviations escalate immediately.' }] },
]

function textsOf(paragraphs: Paragraph[]): string[] {
  return paragraphs.map((p) => p.text)
}

function encode(source: string): ArrayBuffer {
  return new TextEncoder().encode(source).buffer as ArrayBuffer
}

describe.each([
  ['ODT', 'sop.odt', buildOdt],
  ['DOCX', 'sop.docx', buildDocx],
])('%s parsing', (_label, fileName, build) => {
  it('extracts a single paragraph from a minimal document', async () => {
    const parsed = await parseBuffer(await build([{ text: 'One paragraph only.' }]), fileName)
    expect(textsOf(parsed.paragraphs)).toEqual(['One paragraph only.'])
  })

  it('extracts text, headings, lists and inline formatting', async () => {
    const parsed = await parseBuffer(await build(SAMPLE), fileName)

    expect(textsOf(parsed.paragraphs)).toEqual([
      'Deviation Management',
      'This procedure applies to all manufacturing deviations.',
      'Approved by the Quality Manager before release.',
      'Record the deviation within 24 hours.',
      'Notify the site head.',
      'Responsibilities',
      'Critical deviations escalate immediately.',
    ])

    expect(parsed.paragraphs[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(parsed.paragraphs[5]).toMatchObject({ kind: 'heading', level: 2 })
    expect(parsed.paragraphs[3].kind).toBe('listItem')

    // The bold phrase is its own run, with the plain text either side kept apart.
    const approval = parsed.paragraphs[2]
    expect(approval.runs.map((r) => [r.text, r.format.bold])).toEqual([
      ['Approved by the ', false],
      ['Quality Manager', true],
      [' before release.', false],
    ])

    expect(parsed.paragraphs[6].runs[0]).toMatchObject({
      text: 'Critical',
      format: { italic: true },
    })
  })

  it('reports a human-readable style name', async () => {
    const parsed = await parseBuffer(await build(SAMPLE), fileName)
    expect(parsed.paragraphs[0].styleName.toLowerCase()).toContain('heading 1')
  })

  it('collapses runs of whitespace and trims the paragraph', async () => {
    const parsed = await parseBuffer(
      await build([{ text: '   The   Quality\t\tManager  shall approve.  ' }]),
      fileName,
    )
    expect(parsed.paragraphs[0].text).toBe('The Quality Manager shall approve.')
  })

  it('skips empty spacer paragraphs', async () => {
    const parsed = await parseBuffer(
      await build([{ text: 'First' }, { text: '   ' }, { text: '' }, { text: 'Second' }]),
      fileName,
    )
    expect(textsOf(parsed.paragraphs)).toEqual(['First', 'Second'])
  })

  it('extracts table cells as text and marks them as in-table (Phase 1 behaviour)', async () => {
    const parsed = await parseBuffer(
      await build([
        { text: 'Before the table' },
        {
          table: [
            ['Role', 'Responsibility'],
            ['QA Manager', 'Approve deviations'],
          ],
        },
      ]),
      fileName,
    )

    expect(textsOf(parsed.paragraphs)).toEqual([
      'Before the table',
      'Role',
      'Responsibility',
      'QA Manager',
      'Approve deviations',
    ])
    expect(parsed.paragraphs[1].inTable).toBe(true)
    expect(parsed.paragraphs[0].inTable).toBeUndefined()
  })

  it('records the grid position of every cell', async () => {
    const parsed = await parseBuffer(
      await build([
        {
          table: [
            ['Role', 'Responsibility'],
            ['QA Manager', 'Approve deviations'],
          ],
        },
      ]),
      fileName,
    )

    expect(parsed.paragraphs.map((p) => [p.text, p.cell?.row, p.cell?.column])).toEqual([
      ['Role', 0, 0],
      ['Responsibility', 0, 1],
      ['QA Manager', 1, 0],
      ['Approve deviations', 1, 1],
    ])
  })

  it('records a cell merged across columns, and skips what it covers', async () => {
    const parsed = await parseBuffer(
      await build([
        {
          table: [
            [{ text: 'Responsibilities', colSpan: 2 }],
            ['Role', 'Frequency'],
          ],
        },
      ]),
      fileName,
    )

    const heading = parsed.paragraphs.find((p) => p.text === 'Responsibilities')!
    expect(heading.cell).toMatchObject({ row: 0, column: 0, columnSpan: 2 })

    // The row below still starts at column 0: the merge must not displace it.
    expect(parsed.paragraphs.find((p) => p.text === 'Role')!.cell).toMatchObject({
      row: 1,
      column: 0,
    })
    expect(parsed.paragraphs.find((p) => p.text === 'Frequency')!.cell).toMatchObject({
      row: 1,
      column: 1,
    })
  })

  it('records a cell merged down rows without inventing a cell per row', async () => {
    const parsed = await parseBuffer(
      await build([
        {
          table: [
            [{ text: 'QA Manager', rowSpan: 3 }, 'Approve deviations'],
            ['Review records'],
            ['Release lots'],
          ],
        },
      ]),
      fileName,
    )

    const merged = parsed.paragraphs.filter((p) => p.text === 'QA Manager')
    // One cell spanning three rows, not three cells repeating the name.
    expect(merged).toHaveLength(1)
    expect(merged[0].cell).toMatchObject({ row: 0, column: 0, rowSpan: 3 })

    // Each following row's content stays in column 1, under the merge.
    for (const text of ['Approve deviations', 'Review records', 'Release lots']) {
      expect(parsed.paragraphs.find((p) => p.text === text)!.cell).toMatchObject({ column: 1 })
    }
  })

  it('keeps an empty cell so the rest of the row does not shift left', async () => {
    const parsed = await parseBuffer(
      await build([
        {
          table: [
            ['Role', 'Responsibility'],
            ['', 'Approve deviations'],
          ],
        },
      ]),
      fileName,
    )

    // The blank cell must still occupy (1,0), or "Approve deviations" would be
    // read as column 0 and compared against the wrong cell of the other version.
    const second = parsed.paragraphs.filter((p) => p.cell?.row === 1)
    expect(second.map((p) => [p.text, p.cell?.column])).toEqual([
      ['', 0],
      ['Approve deviations', 1],
    ])
  })

  it('preserves non-Latin characters', async () => {
    const parsed = await parseBuffer(
      await build([{ text: 'Contrôle qualité — 温度 2–8 °C' }]),
      fileName,
    )
    expect(parsed.paragraphs[0].text).toBe('Contrôle qualité — 温度 2–8 °C')
  })

  it('fails gracefully on a file that is not a ZIP archive', async () => {
    await expect(parseBuffer(encode('this is not a document'), fileName)).rejects.toThrow(
      DocumentParseError,
    )
  })

  it('fails gracefully on a ZIP archive with no document part', async () => {
    const empty = await build([{ text: 'placeholder' }])
    // Truncating the archive leaves something JSZip may open but cannot read fully.
    const truncated = empty.slice(0, Math.floor(empty.byteLength / 2))
    await expect(parseBuffer(truncated, fileName)).rejects.toBeInstanceOf(DocumentParseError)
  })
})

describe('Markdown parsing', () => {
  const source = [
    '# Deviation Management',
    '',
    'This procedure applies to **all** manufacturing deviations',
    'across the site.',
    '',
    '## Responsibilities',
    '',
    '- Record the deviation within 24 hours',
    '- Notify the *site head*',
    '  - Escalate if critical',
    '',
    '```',
    'STATUS=open',
    '```',
    '',
    'See the [annexe](https://example.invalid/annexe) for detail.',
  ].join('\n')

  it('recovers headings, lists, emphasis and code blocks', async () => {
    const parsed = await parseBuffer(encode(source), 'sop.md')

    expect(textsOf(parsed.paragraphs)).toEqual([
      'Deviation Management',
      'This procedure applies to all manufacturing deviations across the site.',
      'Responsibilities',
      'Record the deviation within 24 hours',
      'Notify the site head',
      'Escalate if critical',
      'STATUS=open',
      'See the annexe for detail.',
    ])

    expect(parsed.paragraphs[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(parsed.paragraphs[2]).toMatchObject({ kind: 'heading', level: 2 })
    expect(parsed.paragraphs[5]).toMatchObject({ kind: 'listItem', level: 2 })
    expect(parsed.paragraphs[6].kind).toBe('code')
  })

  it('marks emphasised text without keeping the markers', async () => {
    const parsed = await parseBuffer(encode(source), 'sop.md')

    const bold = parsed.paragraphs[1].runs.find((r) => r.format.bold)
    expect(bold?.text).toBe('all')

    const italic = parsed.paragraphs[4].runs.find((r) => r.format.italic)
    expect(italic?.text).toBe('site head')
  })

  it('leaves intra-word underscores alone', async () => {
    const parsed = await parseBuffer(encode('Use SOP_QA_017_v2 for this step.'), 'sop.md')
    expect(parsed.paragraphs[0].text).toBe('Use SOP_QA_017_v2 for this step.')
    expect(parsed.paragraphs[0].runs.every((r) => !r.format.italic)).toBe(true)
  })

  it('keeps indentation inside code blocks', async () => {
    const parsed = await parseBuffer(encode(['```', '    indented line', '```'].join('\n')), 'x.md')
    expect(parsed.paragraphs[0].text).toBe('    indented line')
  })
})

describe('plain text parsing', () => {
  it('makes one paragraph per non-blank line', async () => {
    const parsed = await parseBuffer(encode('Line one\n\n  Line two  \n\nLine three\n'), 'sop.txt')
    expect(textsOf(parsed.paragraphs)).toEqual(['Line one', 'Line two', 'Line three'])
  })

  it('handles Windows line endings', async () => {
    const parsed = await parseBuffer(encode('Alpha\r\nBravo\r\n'), 'sop.txt')
    expect(textsOf(parsed.paragraphs)).toEqual(['Alpha', 'Bravo'])
  })

  it('produces no paragraphs for an empty file', async () => {
    const parsed = await parseBuffer(encode(''), 'sop.txt')
    expect(parsed.paragraphs).toEqual([])
  })
})

describe('format detection and validation', () => {
  it('recognises every supported extension, case-insensitively', () => {
    expect(detectFormat('SOP.DOCX')).toBe('docx')
    expect(detectFormat('sop.odt')).toBe('odt')
    expect(detectFormat('notes.Markdown')).toBe('md')
    expect(detectFormat('notes.md')).toBe('md')
    expect(detectFormat('notes.txt')).toBe('txt')
    expect(detectFormat('scan.pdf')).toBeUndefined()
    expect(detectFormat('noextension')).toBeUndefined()
  })

  it('rejects PDF with advice rather than a bare refusal', () => {
    const file = new File(['%PDF-1.7'], 'SOP_v2.pdf', { type: 'application/pdf' })
    expect(() => validateFile(file)).toThrow(/not a supported file type/)
    try {
      validateFile(file)
    } catch (error) {
      expect((error as DocumentParseError).hint).toContain('DOCX or ODT')
    }
  })

  it('rejects a file over the size limit and says how big it is', () => {
    const file = new File(['x'], 'big.docx')
    Object.defineProperty(file, 'size', { value: 8.2 * 1024 * 1024 })
    expect(() => validateFile(file)).toThrow(/8\.2 MB.*5\.0 MB/)
  })

  it('rejects an empty file', () => {
    expect(() => validateFile(new File([], 'empty.txt'))).toThrow(/is empty/)
  })

  it('accepts a file at the limit', () => {
    const file = new File(['x'], 'ok.docx')
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 })
    expect(validateFile(file)).toBe('docx')
  })

  it('formats sizes the way the error messages quote them', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(200 * 1024)).toBe('200 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
