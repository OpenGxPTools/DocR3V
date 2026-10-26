/**
 * Diff engine tests. Spec §9.1 lists the cases; the first two are lifted
 * verbatim from §5.2, which is where the app's whole reason for existing is
 * written down.
 */

import { describe, expect, it } from 'vitest'
import { diffDocuments } from './diffEngine.ts'
import { docOf, notate } from '../test/helpers.ts'
import { makeParagraph } from '../types/document.ts'
import { runs } from '../test/helpers.ts'
import type { ParsedDocument } from '../types/document.ts'

describe('word-level precision', () => {
  it('shows an appended word as an insertion, not a replaced phrase', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'approved by Quality'),
      docOf('b.txt', 'approved by Quality Manager'),
    )

    expect(notate(diff.paragraphs[0].segments)).toBe('approved by Quality [+Manager+]')
    expect(diff.summary.wordsAdded).toBe(1)
    expect(diff.summary.wordsDeleted).toBe(0)
  })

  it('keeps the untouched part of a rewritten clause as unchanged text', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'The batch must be released by the Quality Assurance Manager'),
      docOf('b.txt', 'The batch must be released by QA Manager'),
    )

    const rendered = notate(diff.paragraphs[0].segments)
    expect(rendered.startsWith('The batch must be released by ')).toBe(true)
    expect(rendered).toContain('[-')
    expect(rendered).toContain('[+')

    // The point of the exercise: the leading clause is not re-reported as
    // deleted and re-inserted.
    expect(rendered).not.toContain('[-The batch')
  })

  it('detects a single deleted word', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'Deviations shall be closed within five working days'),
      docOf('b.txt', 'Deviations shall be closed within five days'),
    )

    expect(notate(diff.paragraphs[0].segments)).toBe(
      'Deviations shall be closed within five [-working-] days',
    )
    expect(diff.summary.wordsDeleted).toBe(1)
    expect(diff.summary.wordsAdded).toBe(0)
  })

  it('catches a single-word substitution that changes who is responsible', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'Approved by the Quality Manager'),
      docOf('b.txt', 'Approved by the Quality Director'),
    )

    expect(notate(diff.paragraphs[0].segments)).toBe(
      'Approved by the Quality [-Manager-] [+Director+]',
    )
  })

  it('never splits a word in the middle', () => {
    // Character-level diffing would report this as inserting a single "s".
    const diff = diffDocuments(docOf('a.txt', 'the Manager'), docOf('b.txt', 'the Managers'))
    const segments = diff.paragraphs[0].segments

    // Every changed segment is whole words: the whole word appears on the side
    // it belongs to, not a fragment of one.
    for (const segment of segments) {
      if (segment.op === 'equal') continue
      const source = segment.op === 'delete' ? 'the Manager' : 'the Managers'
      expect(source.split(/\s+/)).toContain(segment.text.trim())
    }
    expect(notate(segments)).toBe('the [-Manager-] [+Managers+]')
  })
})

describe('paragraph-level changes', () => {
  it('reports a wholly deleted paragraph as removed, not as an edit', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'Section 1 text', 'Section 2 text', 'Section 3 text'),
      docOf('b.txt', 'Section 1 text', 'Section 3 text'),
    )

    expect(diff.paragraphs.map((p) => p.status)).toEqual(['unchanged', 'removed', 'unchanged'])
    expect(diff.summary.paragraphsRemoved).toBe(1)
    expect(diff.summary.paragraphsModified).toBe(0)
  })

  it('reports an inserted paragraph as added', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'First clause', 'Third clause'),
      docOf('b.txt', 'First clause', 'Second clause', 'Third clause'),
    )

    expect(diff.paragraphs.map((p) => p.status)).toEqual(['unchanged', 'added', 'unchanged'])
    expect(diff.summary.paragraphsAdded).toBe(1)
  })

  it('pairs an edited paragraph rather than reporting a delete plus an add', () => {
    const diff = diffDocuments(
      docOf(
        'a.txt',
        'Introduction',
        'The Quality Assurance Manager shall review all deviations within five days.',
        'Conclusion',
      ),
      docOf(
        'b.txt',
        'Introduction',
        'The Quality Assurance Manager shall assess all deviations within five days.',
        'Conclusion',
      ),
    )

    expect(diff.paragraphs.map((p) => p.status)).toEqual(['unchanged', 'modified', 'unchanged'])
    expect(notate(diff.paragraphs[1].segments)).toBe(
      'The Quality Assurance Manager shall [-review-] [+assess+] all deviations within five days.',
    )
  })

  it('does not pair two unrelated paragraphs just because both were replaced', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'Anchor', 'Store retained samples at 2–8 °C.'),
      docOf('a.txt', 'Anchor', 'Training records are retained for ten years.'),
    )

    const statuses = diff.paragraphs.map((p) => p.status)
    expect(statuses).toContain('removed')
    expect(statuses).toContain('added')
    expect(statuses).not.toContain('modified')
  })
})

describe('no false positives', () => {
  it('reports nothing when the documents are identical', () => {
    const text = ['Heading', 'Body paragraph one.', 'Body paragraph two.']
    const diff = diffDocuments(docOf('a.txt', ...text), docOf('b.txt', ...text))

    expect(diff.summary).toMatchObject({
      wordsAdded: 0,
      wordsDeleted: 0,
      paragraphsAdded: 0,
      paragraphsRemoved: 0,
      paragraphsModified: 0,
      formattingChanges: 0,
    })
    expect(diff.paragraphs.every((p) => p.status === 'unchanged')).toBe(true)
  })

  it('ignores whitespace-only differences', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'The   Quality\tManager  shall   approve.'),
      docOf('b.txt', 'The Quality Manager shall approve.'),
    )

    expect(diff.summary.wordsAdded).toBe(0)
    expect(diff.summary.wordsDeleted).toBe(0)
    expect(diff.paragraphs[0].status).toBe('unchanged')
  })

  it('leaves surrounding paragraphs untouched when one paragraph changes', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'Alpha', 'Bravo one', 'Charlie', 'Delta'),
      docOf('b.txt', 'Alpha', 'Bravo two', 'Charlie', 'Delta'),
    )

    expect(diff.paragraphs.filter((p) => p.status !== 'unchanged')).toHaveLength(1)
  })
})

describe('empty and degenerate input', () => {
  it('handles an empty original', () => {
    const diff = diffDocuments(docOf('a.txt'), docOf('b.txt', 'One', 'Two'))

    expect(diff.summary.paragraphsAdded).toBe(2)
    expect(diff.summary.wordsAdded).toBe(2)
    expect(diff.summary.paragraphsRemoved).toBe(0)
  })

  it('handles an empty revision', () => {
    const diff = diffDocuments(docOf('a.txt', 'One', 'Two'), docOf('b.txt'))

    expect(diff.summary.paragraphsRemoved).toBe(2)
    expect(diff.summary.wordsDeleted).toBe(2)
  })

  it('handles two empty documents', () => {
    const diff = diffDocuments(docOf('a.txt'), docOf('b.txt'))
    expect(diff.paragraphs).toEqual([])
    expect(diff.summary.wordsAdded).toBe(0)
  })

  it('preserves non-Latin text and typographic punctuation', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'Température de stockage : 2–8 °C — voir l’annexe Ⅲ'),
      docOf('b.txt', 'Température de stockage : 15–25 °C — voir l’annexe Ⅲ'),
    )

    expect(notate(diff.paragraphs[0].segments)).toBe(
      'Température de stockage : [-2–8-] [+15–25+] °C — voir l’annexe Ⅲ',
    )
  })
})

describe('formatting changes', () => {
  function styled(fileName: string, paragraphs: ReturnType<typeof makeParagraph>[]): ParsedDocument {
    return { fileName, format: 'docx', byteSize: 0, paragraphs }
  }

  it('flags text that became bold without calling it a text change', () => {
    const before = styled('a.docx', [
      makeParagraph(0, runs(['Approved by the '], ['Quality Manager'])),
    ])
    const after = styled('b.docx', [
      makeParagraph(0, runs(['Approved by the '], ['Quality Manager', { bold: true }])),
    ])

    const diff = diffDocuments(before, after)
    const paragraph = diff.paragraphs[0]

    expect(paragraph.status).toBe('unchanged')
    expect(paragraph.wordsAdded).toBe(0)
    expect(paragraph.wordsDeleted).toBe(0)
    expect(paragraph.formattingChanges).toEqual([
      { kind: 'bold', phrase: 'Quality Manager', from: 'off', to: 'on' },
    ])
    expect(diff.summary.formattingChanges).toBe(1)
  })

  it('flags emphasis that was removed', () => {
    const before = styled('a.docx', [makeParagraph(0, runs(['Critical', { italic: true }]))])
    const after = styled('b.docx', [makeParagraph(0, runs(['Critical']))])

    const changes = diffDocuments(before, after).paragraphs[0].formattingChanges
    expect(changes).toEqual([{ kind: 'italic', phrase: 'Critical', from: 'on', to: 'off' }])
  })

  it.each([
    ['strikethrough', { strikethrough: true }],
    ['superscript', { superscript: true }],
    ['subscript', { subscript: true }],
    ['allCaps', { allCaps: true }],
    ['smallCaps', { smallCaps: true }],
  ])('flags %s the same way it flags bold', (kind, format) => {
    const before = styled('a.docx', [makeParagraph(0, runs(['Section '], ['4.2']))])
    const after = styled('b.docx', [makeParagraph(0, runs(['Section '], ['4.2', format]))])

    const paragraph = diffDocuments(before, after).paragraphs[0]

    expect(paragraph.status).toBe('unchanged')
    expect(paragraph.wordsAdded).toBe(0)
    expect(paragraph.formattingChanges).toEqual([
      { kind, phrase: '4.2', from: 'off', to: 'on' },
    ])
  })

  it('reports each attribute separately when several change at once', () => {
    const before = styled('a.docx', [makeParagraph(0, runs(['Obsolete']))])
    const after = styled('b.docx', [
      makeParagraph(0, runs(['Obsolete', { strikethrough: true, allCaps: true }])),
    ])

    const kinds = diffDocuments(before, after).paragraphs[0].formattingChanges.map((c) => c.kind)
    expect(kinds).toEqual(['strikethrough', 'allCaps'])
  })

  it('flags a paragraph style change', () => {
    const before = styled('a.docx', [
      makeParagraph(0, runs(['Deviation Handling']), { styleName: 'Body Text' }),
    ])
    const after = styled('b.docx', [
      makeParagraph(0, runs(['Deviation Handling']), {
        styleName: 'Heading 2',
        kind: 'heading',
        level: 2,
      }),
    ])

    expect(diffDocuments(before, after).paragraphs[0].formattingChanges).toEqual([
      { kind: 'style', phrase: 'Deviation Handling', from: 'Body Text', to: 'Heading 2' },
    ])
  })

  it('does not re-report formatting on text that was itself rewritten', () => {
    const before = styled('a.docx', [makeParagraph(0, runs(['review all deviations']))])
    const after = styled('b.docx', [
      makeParagraph(0, runs(['assess all', { bold: true }], [' deviations'])),
    ])

    const paragraph = diffDocuments(before, after).paragraphs[0]
    expect(paragraph.status).toBe('modified')

    // "assess" replaced "review" and is already visible as a text change, so it
    // must not also be listed as a formatting change. "all" survived the edit
    // and did become bold, so that one is a genuine formatting note.
    expect(paragraph.formattingChanges).toEqual([
      { kind: 'bold', phrase: 'all', from: 'off', to: 'on' },
    ])
  })
})

describe('heavily edited paragraphs', () => {
  const LONG =
    'The Quality Assurance Manager shall review all deviations raised during manufacturing within five working days of the deviation being recorded in the electronic batch record system, and shall document the outcome of that review together with any corrective action required before the affected lot is released for distribution.'
  const REWRITTEN =
    'Deviations identified at any stage of manufacture are assessed by the site Qualified Person, who determines whether corrective and preventive action is required and records that determination in the quality management system prior to lot disposition.'

  it('reports a heavily rewritten long paragraph as one edit, not a swap', () => {
    // Reported: a long paragraph that had not changed completely came back as a
    // whole deletion plus a whole insertion, the behaviour of the tools this app
    // exists to improve on. Presenting it as one edited paragraph keeps the two
    // versions side by side in a single row and describes the change the way a
    // change record would.
    //
    // It does not conjure up shared wording that is not there: where a rewrite
    // keeps almost nothing, the word diff inside the row is still mostly marked
    // up. A paragraph that keeps a recognisable half of itself scores about 0.6
    // and paired even before this floor was lowered.
    const diff = diffDocuments(docOf('a.txt', LONG), docOf('b.txt', REWRITTEN))

    expect(diff.paragraphs.map((p) => p.status)).toEqual(['modified'])
    expect(diff.paragraphs[0].oldParagraph?.text).toBe(LONG)
    expect(diff.paragraphs[0].newParagraph?.text).toBe(REWRITTEN)
  })

  it('word-diffs a long paragraph whose opening survives verbatim', () => {
    const kept =
      'The Quality Assurance Manager shall review all deviations raised during manufacturing within five working days of the deviation being recorded in the electronic batch record system, '
    const diff = diffDocuments(
      docOf('a.txt', kept + 'and shall document the outcome before the lot is released for distribution.'),
      docOf('b.txt', kept + 'escalating to the site Qualified Person where a critical classification applies.'),
    )

    const equal = diff.paragraphs[0].segments.filter((s) => s.op === 'equal')
    expect(diff.paragraphs[0].status).toBe('modified')
    expect(equal.some((s) => s.text.length > 100)).toBe(true)
  })

  it('leaves the surrounding clauses alone while doing so', () => {
    const other =
      'The Training Coordinator shall ensure that all personnel have completed the required training within thirty days of the procedure being issued.'
    const diff = diffDocuments(
      docOf('a.txt', other, LONG),
      docOf('b.txt', other, REWRITTEN),
    )

    expect(diff.paragraphs.map((p) => p.status)).toEqual(['unchanged', 'modified'])
  })

  it('still refuses to pair two short lines that merely share a number', () => {
    // Short lines are where boilerplate dominates: a quarter of a six-word
    // heading is one word, most likely "the", and pairing on that evidence
    // would align two headings that have nothing to do with each other.
    const diff = diffDocuments(
      docOf('a.txt', 'Deviation Management', 'Unchanged body text for context here'),
      docOf('b.txt', 'Equipment Calibration', 'Unchanged body text for context here'),
    )

    expect(diff.paragraphs.map((p) => p.status).sort()).toEqual(['added', 'removed', 'unchanged'])
  })
})

describe('table cells', () => {
  /** A one-table document: rows of single-paragraph cells. */
  function tableDoc(fileName: string, rows: string[][]): ParsedDocument {
    const paragraphs = rows.flatMap((cells, row) =>
      cells.map((text, column) =>
        makeParagraph(row * cells.length + column, runs([text]), {
          cell: { table: 0, row, column, offset: 0 },
        }),
      ),
    )
    return { fileName, format: 'docx', byteSize: 0, paragraphs }
  }

  it('pairs a rewritten cell with the cell in the same position', () => {
    const before = tableDoc('a.docx', [
      ['Role', 'Responsibility'],
      ['QA Manager', 'Approve deviations'],
    ])
    const after = tableDoc('b.docx', [
      ['Role', 'Responsibility'],
      ['QA Director', 'Approve deviations'],
    ])

    const diff = diffDocuments(before, after)
    const changed = diff.paragraphs.filter((p) => p.status !== 'unchanged')

    expect(changed).toHaveLength(1)
    expect(changed[0].oldParagraph?.text).toBe('QA Manager')
    expect(changed[0].newParagraph?.text).toBe('QA Director')
    expect(notate(changed[0].segments)).toBe('QA [-Manager-] [+Director+]')
  })

  it('never pairs cells from different positions, however alike they read', () => {
    // Both columns hold the same word in the original. If the aligner were free
    // to match on text alone it could pair (0,0) with (1,1) and invent changes.
    const before = tableDoc('a.docx', [
      ['Daily', 'Daily'],
      ['Daily', 'Daily'],
    ])
    const after = tableDoc('b.docx', [
      ['Daily', 'Weekly'],
      ['Daily', 'Daily'],
    ])

    const diff = diffDocuments(before, after)
    const changed = diff.paragraphs.filter((p) => p.status !== 'unchanged')

    expect(changed).toHaveLength(1)
    expect(changed[0].oldParagraph?.cell).toMatchObject({ row: 0, column: 1 })
    expect(changed[0].newParagraph?.text).toBe('Weekly')
  })

  /**
   * Cells are compared by grid position, so both documents have to number that
   * grid the same way. Inserting one row used to push every row beneath it down
   * by one, at which point no cell below matched its counterpart and the rest of
   * the table came back as wholesale deletions and insertions — a one-row edit
   * rewriting the whole table in the report.
   */
  describe('grids that gained or lost a line', () => {
    const OLD_TEXT =
      'The operator shall record the deviation in the batch record within one working day and notify the supervisor.'
    const NEW_TEXT =
      'Deviations are logged by the operator and escalated to the shift supervisor before the end of the working day.'

    it('still pairs a cell after a row is inserted above it', () => {
      const diff = diffDocuments(
        tableDoc('a.docx', [
          ['Role', 'Responsibility'],
          ['Operator', OLD_TEXT],
        ]),
        tableDoc('b.docx', [
          ['Role', 'Responsibility'],
          ['QA Manager', 'Approve deviations'],
          ['Operator', NEW_TEXT],
        ]),
      )

      const edited = diff.paragraphs.filter((p) => p.status === 'modified')
      expect(edited).toHaveLength(1)
      expect(edited[0].oldParagraph?.text).toBe(OLD_TEXT)
      expect(edited[0].newParagraph?.text).toBe(NEW_TEXT)

      // The new row reads as added, which is what it is.
      const added = diff.paragraphs.filter((p) => p.status === 'added').map((p) => p.newParagraph?.text)
      expect(added).toEqual(['QA Manager', 'Approve deviations'])
    })

    it('still pairs a cell after a column is inserted before it', () => {
      const diff = diffDocuments(
        tableDoc('a.docx', [
          ['Role', 'Responsibility'],
          ['Operator', OLD_TEXT],
        ]),
        tableDoc('b.docx', [
          ['Ref', 'Role', 'Responsibility'],
          ['1', 'Operator', NEW_TEXT],
        ]),
      )

      const edited = diff.paragraphs.filter((p) => p.status === 'modified')
      expect(edited).toHaveLength(1)
      expect(edited[0].newParagraph?.text).toBe(NEW_TEXT)
    })

    it('reports a deleted row as removed rather than shifting the rest', () => {
      const diff = diffDocuments(
        tableDoc('a.docx', [
          ['Role', 'Responsibility'],
          ['QA Manager', 'Approve deviations'],
          ['Operator', 'Record the deviation'],
        ]),
        tableDoc('b.docx', [
          ['Role', 'Responsibility'],
          ['Operator', 'Record the deviation'],
        ]),
      )

      const removed = diff.paragraphs
        .filter((p) => p.status === 'removed')
        .map((p) => p.oldParagraph?.text)
      expect(removed).toEqual(['QA Manager', 'Approve deviations'])
      // Everything else survived untouched.
      expect(diff.paragraphs.filter((p) => p.status === 'modified')).toHaveLength(0)
    })
  })

  it('does not pair a table cell with ordinary body text', () => {
    const before: ParsedDocument = {
      fileName: 'a.docx',
      format: 'docx',
      byteSize: 0,
      paragraphs: [
        makeParagraph(0, runs(['Retention period'])),
        makeParagraph(1, runs(['Five years']), { cell: { table: 0, row: 0, column: 0, offset: 0 } }),
      ],
    }
    const after: ParsedDocument = {
      fileName: 'b.docx',
      format: 'docx',
      byteSize: 0,
      paragraphs: [
        makeParagraph(0, runs(['Retention period'])),
        makeParagraph(1, runs(['Seven years']), { cell: { table: 0, row: 0, column: 0, offset: 0 } }),
      ],
    }

    const diff = diffDocuments(before, after)
    const changed = diff.paragraphs.filter((p) => p.status !== 'unchanged')

    expect(changed).toHaveLength(1)
    expect(changed[0].oldParagraph?.cell).toBeDefined()
    expect(changed[0].newParagraph?.text).toBe('Seven years')
  })
})

describe('summary statistics', () => {
  it('counts words and paragraphs across the whole comparison', () => {
    const diff = diffDocuments(
      docOf('a.txt', 'Alpha one two', 'Bravo', 'Charlie'),
      docOf('b.txt', 'Alpha one three four', 'Delta', 'Charlie'),
    )

    expect(diff.summary.paragraphsUnchanged).toBe(1)
    expect(diff.summary.wordsAdded).toBeGreaterThan(0)
    expect(diff.summary.wordsDeleted).toBeGreaterThan(0)
    expect(diff.original.wordCount).toBe(5)
    expect(diff.revised.wordCount).toBe(6)
    expect(diff.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
