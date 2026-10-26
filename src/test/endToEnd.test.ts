/**
 * End-to-end tests: real files in, comparison out.
 *
 * These run the whole pipeline — parse, align, diff, export — over the sample
 * SOP that `npm run fixtures` writes to disk, so what the tests assert and what
 * a reviewer sees when they drag those files into the app are the same thing.
 */

import { describe, expect, it } from 'vitest'
import { buildDocx, buildOdt, type FixtureParagraph } from './builders.ts'
import { notate } from './helpers.ts'
import {
  RESPONSIBILITY_TABLE,
  SIMPLE_SOP,
  toFixtureParagraphs,
  toMarkdown,
  toPlainText,
  UNICODE_SOP,
  type Version,
} from './sopContent.ts'
import { diffDocuments } from '../services/diffEngine.ts'
import { parseBuffer } from '../services/documentParser.ts'
import { buildReportHtml } from '../services/export.ts'
import type { DocumentDiff, ParagraphDiff } from '../types/diff.ts'
import type { ParsedDocument } from '../types/document.ts'

function encode(source: string): ArrayBuffer {
  return new TextEncoder().encode(source).buffer as ArrayBuffer
}

function sopParagraphs(version: Version): FixtureParagraph[] {
  return [
    ...toFixtureParagraphs(SIMPLE_SOP, version),
    { heading: 2, text: 'Annexe A: Responsibilities' },
    RESPONSIBILITY_TABLE[version],
  ]
}

/** Finds the diff row whose text on either side contains `needle`. */
function rowContaining(diff: DocumentDiff, needle: string): ParagraphDiff {
  const row = diff.paragraphs.find(
    (p) => p.oldParagraph?.text.includes(needle) || p.newParagraph?.text.includes(needle),
  )
  if (!row) throw new Error(`No paragraph containing "${needle}"`)
  return row
}

describe.each([
  ['ODT', 'sop.odt', buildOdt],
  ['DOCX', 'sop.docx', buildDocx],
])('%s sample SOP, v1 against v2', (_label, fileName, build) => {
  async function compare(): Promise<DocumentDiff> {
    const [v1, v2] = await Promise.all([
      parseBuffer(await build(sopParagraphs('v1')), fileName),
      parseBuffer(await build(sopParagraphs('v2')), fileName),
    ])
    return diffDocuments(v1, v2)
  }

  it('finds the role change that matters for compliance', async () => {
    const diff = await compare()
    const row = rowContaining(diff, 'shall review all deviations')

    expect(row.status).toBe('modified')
    const rendered = notate(row.segments)

    // Two edits a single word apart are reported as one replacement rather than
    // two, which is what §5.4's own example ("[-review all-] [+assess all+]")
    // shows: at word granularity a one-word island between edits is harder to
    // read than the phrase it sits in.
    expect(rendered).toContain('[-Manager shall review-] [+Director shall assess+]')
    expect(rendered).toContain('[-five-] [+three+]')

    // The rest of the clause is reported as unchanged, which is the whole point.
    expect(rendered).toContain('The Quality Assurance ')
    expect(rendered).toContain('working days of notification and determine the classification.')
    expect(rendered).not.toContain('[-The Quality')
  })

  it('reports the new responsibility as an added paragraph', async () => {
    const diff = await compare()
    expect(rowContaining(diff, 'Qualified Person: confirm').status).toBe('added')
  })

  it('reports the withdrawn retention clause as removed', async () => {
    const diff = await compare()
    expect(rowContaining(diff, 'retained for the shelf life').status).toBe('removed')
  })

  it('leaves untouched clauses alone', async () => {
    const diff = await compare()
    const untouched = rowContaining(diff, 'SOP-CT-004')

    expect(untouched.status).toBe('unchanged')
    expect(untouched.wordsAdded).toBe(0)
    expect(untouched.wordsDeleted).toBe(0)
    expect(untouched.formattingChanges).toEqual([])
  })

  it('follows changes inside table cells (Phase 1 treats tables as text)', async () => {
    const diff = await compare()

    expect(rowContaining(diff, 'Complete root cause investigation').status).toBe('unchanged')
    expect(notate(rowContaining(diff, '30 calendar days').segments)).toBe(
      '[-30-] [+20+] calendar days',
    )
    expect(rowContaining(diff, 'Confirm batch certification').status).toBe('added')
  })

  it('notes that the emphasised role name moved with the role', async () => {
    const diff = await compare()
    const row = rowContaining(diff, 'shall review all deviations')

    // "Quality Assurance" stays bold across the edit, so there is nothing to
    // report about it; the changed words carry their own highlighting.
    expect(row.formattingChanges).toEqual([])
  })

  it('produces a report that parses as HTML and names both files', async () => {
    const diff = await compare()
    const report = new DOMParser().parseFromString(buildReportHtml(diff), 'text/html')

    expect(report.querySelectorAll('parsererror')).toHaveLength(0)
    expect(report.body.textContent).toContain('Quality Assurance Director')
    expect(report.querySelectorAll('del').length).toBeGreaterThan(3)
    expect(report.querySelectorAll('ins').length).toBeGreaterThan(3)
  })
})

describe('cross-format consistency', () => {
  it('reads the same wording out of ODT, DOCX, Markdown and plain text', async () => {
    const documents: ParsedDocument[] = [
      await parseBuffer(await buildOdt(toFixtureParagraphs(SIMPLE_SOP, 'v1')), 'a.odt'),
      await parseBuffer(await buildDocx(toFixtureParagraphs(SIMPLE_SOP, 'v1')), 'a.docx'),
      await parseBuffer(encode(toMarkdown(SIMPLE_SOP, 'v1')), 'a.md'),
      await parseBuffer(encode(toPlainText(SIMPLE_SOP, 'v1')), 'a.txt'),
    ]

    // Plain text has no way to mark a list, so its bullets survive as text.
    const texts = documents.map((document) =>
      document.paragraphs.map((p) => p.text.replace(/^- /, '')),
    )
    for (const rendering of texts.slice(1)) {
      expect(rendering).toEqual(texts[0])
    }
  })

  it('finds the same changes whichever format the SOP was saved in', async () => {
    const asOdt = diffDocuments(
      await parseBuffer(await buildOdt(toFixtureParagraphs(SIMPLE_SOP, 'v1')), 'a.odt'),
      await parseBuffer(await buildOdt(toFixtureParagraphs(SIMPLE_SOP, 'v2')), 'b.odt'),
    )
    const asMarkdown = diffDocuments(
      await parseBuffer(encode(toMarkdown(SIMPLE_SOP, 'v1')), 'a.md'),
      await parseBuffer(encode(toMarkdown(SIMPLE_SOP, 'v2')), 'b.md'),
    )

    expect(asMarkdown.summary.wordsAdded).toBe(asOdt.summary.wordsAdded)
    expect(asMarkdown.summary.wordsDeleted).toBe(asOdt.summary.wordsDeleted)
    expect(asMarkdown.summary.paragraphsAdded).toBe(asOdt.summary.paragraphsAdded)
    expect(asMarkdown.summary.paragraphsRemoved).toBe(asOdt.summary.paragraphsRemoved)
  })
})

describe('non-English content', () => {
  it('compares accented, CJK and mathematical text without mangling it', async () => {
    const diff = diffDocuments(
      await parseBuffer(encode(toPlainText(UNICODE_SOP, 'v1')), 'a.txt'),
      await parseBuffer(encode(toPlainText(UNICODE_SOP, 'v2')), 'b.txt'),
    )

    expect(notate(rowContaining(diff, 'Température').segments)).toContain('[-2–8-] [+15–25+]')
    expect(rowContaining(diff, '保存期間').status).toBe('unchanged')
    expect(notate(rowContaining(diff, 'Grenzwert').segments)).toContain('[-0,5-] [+0,2+]')
    expect(rowContaining(diff, 'Anexo Ⅲ').status).toBe('unchanged')
  })
})

describe('performance', () => {
  /** Spec §10: a 500 KB document must compare in under three seconds. */
  it('compares a 500 KB document within the target', async () => {
    const clause =
      'The Quality Assurance Manager shall review deviation record number %N% and confirm that the root cause investigation has been completed, that the product impact assessment has been approved, and that all corrective actions have been implemented before the record is closed.'

    const paragraphs: string[] = []
    while (paragraphs.join('\n').length < 500 * 1024) {
      paragraphs.push(clause.replace('%N%', String(paragraphs.length + 1)))
    }
    // Change roughly one clause in twenty, spread through the document.
    const revised = paragraphs.map((text, index) =>
      index % 20 === 0 ? text.replace('Manager shall review', 'Director shall assess') : text,
    )

    const [before, after] = await Promise.all([
      parseBuffer(encode(paragraphs.join('\n')), 'big-v1.txt'),
      parseBuffer(encode(revised.join('\n')), 'big-v2.txt'),
    ])

    const started = performance.now()
    const diff = diffDocuments(before, after)
    const elapsed = performance.now() - started

    expect(diff.summary.paragraphsModified).toBe(Math.ceil(paragraphs.length / 20))
    expect(diff.summary.paragraphsAdded).toBe(0)
    expect(diff.summary.paragraphsRemoved).toBe(0)
    expect(elapsed).toBeLessThan(3000)
  })
})
