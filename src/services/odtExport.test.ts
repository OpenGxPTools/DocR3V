/**
 * ODT tracked-changes export. Spec §5.7.
 *
 * The definitive check for this feature is opening the output in LibreOffice
 * and confirming that rejecting every change reproduces the original and
 * accepting every change reproduces the revision. That was done against
 * LibreOffice 24.2 while building it, but it cannot run here, so these tests
 * assert the structural properties that round trip depends on:
 *
 *   - deleted text is absent from the body and present in its changed-region
 *   - inserted text is present in the body and bracketed by change markers
 *   - every marker in the body resolves to a region that exists
 *
 * A regression in any one of those is what would silently turn the export back
 * into an unreviewable redline.
 */

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { diffDocuments } from './diffEngine.ts'
import { buildTrackedChangesOdt, trackedOdtFileName } from './odtExport.ts'
import { docOf, runs } from '../test/helpers.ts'
import { makeParagraph, type ParsedDocument } from '../types/document.ts'
import { APP_NAME } from '../version.ts'

async function contentOf(diff: Parameters<typeof buildTrackedChangesOdt>[0]): Promise<string> {
  const zip = await JSZip.loadAsync(await buildTrackedChangesOdt(diff))
  return zip.file('content.xml')!.async('string')
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

/** Body text with every tracked-changes region stripped out. */
function bodyOf(xml: string): string {
  return xml.replace(/<text:tracked-changes[\s\S]*?<\/text:tracked-changes>/, '')
}

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

describe('ODT tracked changes', () => {
  it('produces a well-formed OpenDocument package', async () => {
    const zip = await JSZip.loadAsync(await buildTrackedChangesOdt(diff))

    expect(await zip.file('mimetype')!.async('string')).toBe(
      'application/vnd.oasis.opendocument.text',
    )
    for (const entry of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) {
      expect(zip.file(entry), entry).not.toBeNull()
    }

    const parsed = parseXml(await zip.file('content.xml')!.async('string'))
    expect(parsed.querySelector('parsererror')).toBeNull()
  })

  it('keeps deleted text out of the body and inside its changed region', async () => {
    const xml = await contentOf(diff)

    // "review" was replaced by "assess": it must survive only as deleted content.
    expect(xml).toContain('review')
    expect(bodyOf(xml)).not.toContain('review')

    const tracked = /<text:tracked-changes[\s\S]*?<\/text:tracked-changes>/.exec(xml)![0]
    expect(tracked).toContain('review')
    expect(tracked).toContain('This clause was withdrawn.')
  })

  it('keeps inserted text in the body, bracketed by change markers', async () => {
    const body = bodyOf(await contentOf(diff))

    expect(body).toContain('assess')
    expect(body).toContain('Records are retained for ten years.')
    expect(body).toMatch(/<text:change-start text:change-id="[^"]+"\/>/)
    expect(body).toMatch(/<text:change-end text:change-id="[^"]+"\/>/)
  })

  it('resolves every marker in the body to a region that exists', async () => {
    const xml = await contentOf(diff)
    const parsed = parseXml(xml)

    const declared = new Set(
      [...parsed.getElementsByTagName('text:changed-region')].map((node) =>
        node.getAttribute('text:id'),
      ),
    )
    expect(declared.size).toBeGreaterThan(0)

    const referenced = [...xml.matchAll(/text:change-id="([^"]+)"/g)].map((m) => m[1])
    expect(referenced.length).toBeGreaterThan(0)
    for (const id of referenced) {
      expect(declared.has(id), `change-id ${id} has no region`).toBe(true)
    }
  })

  it('pairs every change-start with a change-end for the same region', async () => {
    const body = bodyOf(await contentOf(diff))
    const starts = [...body.matchAll(/<text:change-start text:change-id="([^"]+)"\/>/g)].map(
      (m) => m[1],
    )
    const ends = [...body.matchAll(/<text:change-end text:change-id="([^"]+)"\/>/g)].map((m) => m[1])

    expect(starts.length).toBeGreaterThan(0)
    expect(starts.sort()).toEqual(ends.sort())
  })

  it('gives an inserted paragraph a region covering the paragraph break', async () => {
    // The region opens in the preceding paragraph and closes in the inserted
    // one. Without that, rejecting the insertion empties the paragraph but
    // leaves the element behind, and reject-all no longer restores the
    // original — it leaves a stray blank line.
    const body = bodyOf(await contentOf(diff))
    // A change-start sitting immediately before a paragraph's closing tag is
    // the signature of a region that continues into the next paragraph.
    const inserted = /<text:change-start text:change-id="([^"]+)"\/><\/text:(?:p|h)>/.exec(body)

    expect(inserted, 'no change-start closes out a paragraph').not.toBeNull()
    expect(body).toContain(`<text:change-end text:change-id="${inserted![1]}"/>`)
  })

  /**
   * Segments own the separator that follows them, which means the segment text
   * at a paragraph's edge includes a space the document does not have. On
   * screen that is invisible; written into an ODT it survives accept/reject and
   * the round trip stops being exact. Both directions are covered here.
   */
  describe('paragraph-edge whitespace', () => {
    const cell = (fileName: string, text: string): ParsedDocument => ({
      fileName,
      format: 'odt',
      byteSize: 0,
      paragraphs: [makeParagraph(0, runs([text]))],
    })

    it('stores a deletion without a trailing space the original never had', async () => {
      const xml = await contentOf(diffDocuments(cell('a.odt', 'QA Manager'), cell('b.odt', 'QA Director')))
      const region = /<text:deletion>[\s\S]*?<\/text:deletion>/.exec(xml)![0]

      expect(region).toContain('>Manager<')
      expect(region).not.toContain('>Manager <')
    })

    it('puts the space before an appended phrase inside the insertion', async () => {
      // Otherwise rejecting the insertion strands the space and the paragraph
      // comes back one character longer than it started.
      const body = bodyOf(
        await contentOf(
          diffDocuments(
            cell('a.odt', 'Record the deviation'),
            cell('b.odt', 'Record the deviation within 24 hours'),
          ),
        ),
      )

      expect(body).toMatch(/deviation<text:change-start/)
      expect(body).not.toMatch(/deviation <text:change-start/)
    })
  })

  it('attributes the changes to the tool rather than to a person', async () => {
    // Nobody typed these edits, and naming the reviewer who opened the file
    // would misrepresent the audit trail the document becomes part of.
    const xml = await contentOf(diff)
    expect(xml).toContain(`<dc:creator>${APP_NAME}`)
  })

  it('carries the document formatting through as ODF text styles', async () => {
    const styled = (fileName: string, bold: boolean): ParsedDocument => ({
      fileName,
      format: 'odt',
      byteSize: 0,
      paragraphs: [makeParagraph(0, runs(['Approved by the '], ['Quality Manager', { bold }]))],
    })

    const xml = await contentOf(diffDocuments(styled('a.odt', true), styled('b.odt', true)))
    expect(xml).toContain('fo:font-weight="bold"')
    expect(xml).toMatch(/<text:span text:style-name="[^"]+">Quality Manager<\/text:span>/)
  })

  it('writes a table as a grid rather than as loose paragraphs', async () => {
    const table = (fileName: string, role: string): ParsedDocument => ({
      fileName,
      format: 'odt',
      byteSize: 0,
      paragraphs: [
        makeParagraph(0, runs(['Role']), { cell: { table: 0, row: 0, column: 0, offset: 0 } }),
        makeParagraph(1, runs([role]), { cell: { table: 0, row: 1, column: 0, offset: 0 } }),
      ],
    })

    const xml = await contentOf(diffDocuments(table('a.odt', 'QA Manager'), table('b.odt', 'QA Director')))
    const parsed = parseXml(xml)

    expect(parsed.getElementsByTagName('table:table')).toHaveLength(1)
    expect(parsed.getElementsByTagName('table:table-row')).toHaveLength(2)
    expect(bodyOf(xml)).toContain('Director')
  })

  it('produces a document with no changes when the two files match', async () => {
    const same = docOf('a.odt', 'Deviation Management', 'Unchanged throughout.')
    const xml = await contentOf(diffDocuments(same, docOf('b.odt', 'Deviation Management', 'Unchanged throughout.')))

    expect(xml).not.toContain('<text:tracked-changes')
    expect(xml).toContain('Unchanged throughout.')
  })

  it('names the file after both documents and the comparison date', () => {
    expect(trackedOdtFileName(diff)).toBe(
      `tracked_SOP-QA-017_v1_vs_SOP-QA-017_v2_${diff.generatedAt.slice(0, 10)}.odt`,
    )
  })
})
