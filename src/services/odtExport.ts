/**
 * OpenDocument Text export with native tracked changes. Spec §5.7.
 *
 * This is the deliverable that turns the tool from something you read into
 * something you act on. Pasting the merged view into Writer produces red
 * strikethrough and green underline as *character formatting* — it reads
 * correctly but there is nothing to accept or reject. This module writes the
 * real thing: `<text:tracked-changes>` regions that LibreOffice Writer offers
 * up in Edit ▸ Track Changes ▸ Manage, one accept/reject decision per change.
 *
 * The schema here was taken from a tracked-changes file that LibreOffice 24.2
 * produced itself (spec §5.7 warns that producer quirks, not the ODF standard,
 * are where this kind of export usually breaks). What that file showed:
 *
 *   - `<text:tracked-changes>` is the first child of `<office:text>`, holding
 *     one `<text:changed-region>` per change, each with an xml:id AND a
 *     matching text:id.
 *   - An insertion is `<text:insertion>` carrying only change-info. The
 *     inserted text lives in the body, bracketed by `<text:change-start>` and
 *     `<text:change-end>` referencing the region id.
 *   - A deletion is `<text:deletion>` carrying change-info *and the deleted
 *     content* as `<text:p>` elements. The body gets only a point marker,
 *     `<text:change>`. The deleted text is therefore absent from the body.
 *
 * So the body reads as the revised document, and rejecting every change
 * reconstructs the original exactly. That is the property a reviewer relies on.
 */

import JSZip from 'jszip'
import { describeSummary, plural } from './formatting.ts'
import { styledPieces } from './segmentPieces.ts'
import { toBlocks, type TableBlock } from './tableBlocks.ts'
import { APP_NAME, APP_VERSION } from '../version.ts'
import type { DocumentDiff, ParagraphDiff } from '../types/diff.ts'
import {
  FORMATTING_KEYS,
  isPlain,
  type Paragraph,
  type RunFormatting,
} from '../types/document.ts'

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
].join(' ')

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Collects the distinct formatting combinations in use and names one automatic
 * text style for each, so the export carries the document's own bold and italic
 * rather than flattening every SOP to plain prose.
 */
class SpanStyles {
  private readonly names = new Map<string, string>()

  nameFor(format: RunFormatting): string | undefined {
    if (isPlain(format)) return undefined
    const key = FORMATTING_KEYS.filter((k) => format[k]).join('|')
    let name = this.names.get(key)
    if (!name) {
      name = `DR3V_T${this.names.size + 1}`
      this.names.set(key, name)
    }
    return name
  }

  toXml(): string {
    return [...this.names.entries()]
      .map(([key, name]) => {
        const on = new Set(key.split('|'))
        const properties: string[] = []
        if (on.has('bold')) properties.push('fo:font-weight="bold"')
        if (on.has('italic')) properties.push('fo:font-style="italic"')
        if (on.has('underline')) properties.push('style:text-underline-style="solid"')
        if (on.has('strikethrough')) properties.push('style:text-line-through-style="solid"')
        if (on.has('superscript')) properties.push('style:text-position="super 58%"')
        if (on.has('subscript')) properties.push('style:text-position="sub 58%"')
        if (on.has('allCaps')) properties.push('fo:text-transform="uppercase"')
        if (on.has('smallCaps')) properties.push('fo:font-variant="small-caps"')
        return (
          `<style:style style:name="${name}" style:family="text">` +
          `<style:text-properties ${properties.join(' ')}/></style:style>`
        )
      })
      .join('')
  }
}

/** Accumulates changed-regions and hands out the ids the body refers to. */
class ChangeSet {
  private readonly regions: string[] = []
  private next = 1

  private readonly creator: string
  private readonly date: string

  constructor(creator: string, date: string) {
    this.creator = creator
    this.date = date
  }

  private info(): string {
    return (
      '<office:change-info>' +
      `<dc:creator>${escapeXml(this.creator)}</dc:creator>` +
      `<dc:date>${this.date}</dc:date>` +
      '</office:change-info>'
    )
  }

  private open(): string {
    return `DR3Vct${this.next++}`
  }

  insertion(): string {
    const id = this.open()
    this.regions.push(
      `<text:changed-region xml:id="${id}" text:id="${id}">` +
        `<text:insertion>${this.info()}</text:insertion>` +
        '</text:changed-region>',
    )
    return id
  }

  /** `content` is the deleted material, already marked up as text:p elements. */
  deletion(content: string): string {
    const id = this.open()
    this.regions.push(
      `<text:changed-region xml:id="${id}" text:id="${id}">` +
        `<text:deletion>${this.info()}${content}</text:deletion>` +
        '</text:changed-region>',
    )
    return id
  }

  toXml(): string {
    if (this.regions.length === 0) return ''
    // track-changes="false" means recording is off, not that these are absent;
    // it matches what LibreOffice writes after a compare.
    return `<text:tracked-changes text:track-changes="false">${this.regions.join('')}</text:tracked-changes>`
  }
}

/** Paragraph style name and element for a parsed paragraph. */
function styleOf(paragraph: Paragraph | undefined, inCell: boolean): string {
  if (inCell) return 'Table_20_Contents'
  if (!paragraph) return 'Standard'
  if (paragraph.kind === 'heading') {
    return `Heading_20_${Math.min(Math.max(paragraph.level ?? 1, 1), 6)}`
  }
  if (paragraph.kind === 'listItem') return 'List_20_Paragraph'
  if (paragraph.kind === 'code') return 'Preformatted_20_Text'
  return 'Standard'
}

/**
 * Trims a segment back to text the source paragraph actually contains.
 *
 * Segments own the separator that follows them, and the last segment of a
 * paragraph is given one that does not exist in the document. The HTML views
 * can be careless about that — a stray trailing space changes nothing on
 * screen. Here it would be written into the file, so rejecting a deletion at
 * the end of a paragraph would restore the original word *plus a space it
 * never had*, and the round trip would no longer be exact.
 */
function clampToSource(
  source: Paragraph | undefined,
  offset: number | undefined,
  text: string,
): string {
  if (!source || offset === undefined) return text
  return text.slice(0, Math.max(0, source.text.length - offset))
}

/** Renders one segment's text with the source document's inline formatting. */
function spans(
  source: Paragraph | undefined,
  offset: number | undefined,
  rawText: string,
  styles: SpanStyles,
): string {
  const text = clampToSource(source, offset, rawText)
  let xml = ''
  for (const piece of styledPieces(source, offset, text)) {
    const name = styles.nameFor(piece.format)
    xml += name
      ? `<text:span text:style-name="${name}">${escapeXml(piece.text)}</text:span>`
      : escapeXml(piece.text)
  }
  return xml
}

/**
 * The inside of one paragraph: unchanged text as-is, inserted text bracketed by
 * change markers, deleted text lifted out into a region and replaced by a point
 * marker. Deleted spans keep the *original* paragraph's formatting, since that
 * is the version they came from.
 */
function renderSegments(
  diff: ParagraphDiff,
  changes: ChangeSet,
  styles: SpanStyles,
  cellStyle: string,
): string {
  let xml = ''
  /**
   * Text an "equal" segment claimed that exists only in the revision.
   *
   * A segment owns the separator that follows it, so when a word is appended at
   * the end of a paragraph the preceding equal segment claims the space before
   * it — a space the original never had. Left in the unchanged part, rejecting
   * the insertion would strand it and the paragraph would come back one
   * character longer than it started. It belongs to the insertion, so it is
   * carried forward and emitted inside the change region.
   */
  let carry = 0

  for (const [index, segment] of diff.segments.entries()) {
    if (segment.op === 'equal') {
      const shared = clampToSource(diff.oldParagraph, segment.oldOffset, segment.text)
      xml += spans(diff.newParagraph, segment.newOffset, shared, styles)
      const overflow = segment.text.length - shared.length
      // Only an insertion can absorb it; otherwise it is genuinely unchanged.
      if (overflow > 0 && diff.segments[index + 1]?.op === 'insert') carry = overflow
      else if (overflow > 0) {
        xml += spans(diff.newParagraph, (segment.newOffset ?? 0) + shared.length,
          segment.text.slice(shared.length), styles)
      }
      continue
    }

    if (segment.op === 'insert') {
      const id = changes.insertion()
      const offset = (segment.newOffset ?? 0) - carry
      const text = (diff.newParagraph?.text ?? '').slice(offset, offset + carry) + segment.text
      xml +=
        `<text:change-start text:change-id="${id}"/>` +
        spans(diff.newParagraph, offset, text, styles) +
        `<text:change-end text:change-id="${id}"/>`
      carry = 0
      continue
    }

    const deleted = spans(diff.oldParagraph, segment.oldOffset, segment.text, styles)
    const id = changes.deletion(`<text:p text:style-name="${cellStyle}">${deleted}</text:p>`)
    xml += `<text:change text:change-id="${id}"/>`
  }

  return xml
}

/** Opens and closes the right element for a paragraph's kind. */
function wrapParagraph(paragraph: Paragraph | undefined, style: string, inner: string): string {
  if (paragraph?.kind === 'heading') {
    const level = Math.min(Math.max(paragraph.level ?? 1, 1), 6)
    return `<text:h text:style-name="${style}" text:outline-level="${level}">${inner}</text:h>`
  }
  if (paragraph?.kind === 'listItem') {
    return `<text:list><text:list-item><text:p text:style-name="${style}">${inner}</text:p></text:list-item></text:list>`
  }
  return `<text:p text:style-name="${style}">${inner}</text:p>`
}

/**
 * A wholly removed paragraph leaves no body element — its text lives in the
 * deletion region. LibreOffice attaches the point marker to the end of the
 * preceding paragraph and stores an empty `<text:p/>` ahead of the content to
 * stand for the paragraph break being removed; this matches that.
 */
function removedMarker(diff: ParagraphDiff, changes: ChangeSet, styles: SpanStyles): string {
  const paragraph = diff.oldParagraph
  const style = styleOf(paragraph, Boolean(paragraph?.cell))
  const text = spans(paragraph, 0, paragraph?.text ?? '', styles)
  const id = changes.deletion(
    `<text:p text:style-name="${style}"/><text:p text:style-name="${style}">${text}</text:p>`,
  )
  return `<text:change text:change-id="${id}"/>`
}

/** Appends content just inside a paragraph element's closing tag. */
function appendInside(element: string, extra: string): string {
  return element.replace(/(<\/text:(?:p|h)>)$/, `${extra}$1`)
}

/**
 * Assembles the body, deferring the markers for wholly removed paragraphs.
 *
 * A removed paragraph contributes no element of its own — its text lives in the
 * deletion region — so its marker has to ride on a neighbouring paragraph.
 * LibreOffice attaches it to the end of the preceding one, and matching that
 * matters: giving the marker a paragraph of its own leaves an empty paragraph
 * behind after the change is rejected, so rejecting everything would no longer
 * reproduce the original exactly. That round trip is the whole point of this
 * export, and a reviewer would see the drift as unexplained blank lines.
 */
function renderBody(diff: DocumentDiff, changes: ChangeSet, styles: SpanStyles): string {
  const parts: string[] = []
  /** Index into `parts` of the last paragraph a marker may be appended to. */
  let lastProse = -1
  /** Markers waiting for a paragraph to attach to. */
  let pending = ''

  for (const block of toBlocks(diff.paragraphs)) {
    if (block.kind === 'table') {
      parts.push(renderTable(block, changes, styles))
      lastProse = -1
      continue
    }

    const paragraphDiff = block.diff

    if (paragraphDiff.status === 'removed') {
      const marker = removedMarker(paragraphDiff, changes, styles)
      if (lastProse >= 0) parts[lastProse] = appendInside(parts[lastProse], marker)
      else pending += marker
      continue
    }

    const paragraph = paragraphDiff.newParagraph ?? paragraphDiff.oldParagraph
    const style = styleOf(paragraph, false)

    if (paragraphDiff.status === 'added') {
      // The insertion has to cover the paragraph *break* as well as the text,
      // or rejecting it empties the paragraph but leaves the element behind as
      // a stray blank line. ODF allows a change region to span paragraphs, so
      // the region opens at the end of the previous paragraph and closes at the
      // end of this one — which is how LibreOffice writes an inserted
      // paragraph, and what makes reject-all restore the original exactly.
      const id = changes.insertion()
      const start = `<text:change-start text:change-id="${id}"/>`
      if (lastProse >= 0) parts[lastProse] = appendInside(parts[lastProse], start)
      const inner =
        (lastProse >= 0 ? '' : start) +
        pending +
        spans(paragraphDiff.newParagraph, 0, paragraphDiff.newParagraph?.text ?? '', styles) +
        `<text:change-end text:change-id="${id}"/>`
      parts.push(wrapParagraph(paragraph, style, inner))
    } else {
      parts.push(
        wrapParagraph(
          paragraph,
          style,
          pending + renderSegments(paragraphDiff, changes, styles, style),
        ),
      )
    }

    pending = ''
    lastProse = parts.length - 1
  }

  // Every paragraph was removed, or the document ended on one: the markers
  // still have to reach the file, so they get a paragraph of their own.
  if (pending) parts.push(`<text:p text:style-name="Standard">${pending}</text:p>`)

  return parts.join('')
}

function renderTable(block: TableBlock, changes: ChangeSet, styles: SpanStyles): string {
  const columns = `<table:table-column table:number-columns-repeated="${block.columnCount}"/>`

  const rows = block.rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          // ODF marks the positions a merge covers with an explicit element,
          // rather than omitting them, so the row keeps its column count.
          if (cell.covered) return '<table:covered-table-cell/>'

          const content = cell.diffs
            .map((diff) => {
              if (diff.status === 'removed') {
                return `<text:p text:style-name="Table_20_Contents">${removedMarker(diff, changes, styles)}</text:p>`
              }
              if (diff.status === 'added') {
                const id = changes.insertion()
                return (
                  '<text:p text:style-name="Table_20_Contents">' +
                  `<text:change-start text:change-id="${id}"/>` +
                  spans(diff.newParagraph, 0, diff.newParagraph?.text ?? '', styles) +
                  `<text:change-end text:change-id="${id}"/></text:p>`
                )
              }
              return `<text:p text:style-name="Table_20_Contents">${renderSegments(diff, changes, styles, 'Table_20_Contents')}</text:p>`
            })
            .join('')
          const span =
            (cell.columnSpan > 1 ? ` table:number-columns-spanned="${cell.columnSpan}"` : '') +
            (cell.rowSpan > 1 ? ` table:number-rows-spanned="${cell.rowSpan}"` : '')
          // Every cell is emitted, empty ones included, or the row loses shape.
          return (
            `<table:table-cell office:value-type="string"${span}>` +
            `${content || '<text:p text:style-name="Table_20_Contents"/>'}</table:table-cell>`
          )
        })
        .join('')
      return `<table:table-row>${cells}</table:table-row>`
    })
    .join('')

  return `<table:table table:name="Table${block.table + 1}">${columns}${rows}</table:table>`
}

const HEADING_STYLES = [1, 2, 3, 4, 5, 6]
  .map(
    (level) =>
      `<style:style style:name="Heading_20_${level}" style:display-name="Heading ${level}" style:family="paragraph" style:parent-style-name="Standard"/>`,
  )
  .join('')

export function buildTrackedChangesOdt(diff: DocumentDiff): Promise<ArrayBuffer> {
  const generated = new Date(diff.generatedAt)
  const styles = new SpanStyles()
  // The change author is the comparison, not a person: nobody typed these
  // edits here, and attributing them to the reviewer opening the file would
  // misrepresent the audit trail this document becomes part of.
  const changes = new ChangeSet(
    `${APP_NAME} ${APP_VERSION}`,
    generated.toISOString().replace('Z', ''),
  )

  const body = renderBody(diff, changes, styles)

  // The tracked-changes element must precede the body content, and the span
  // styles are only known once the body has been rendered — hence the ordering
  // of these two lines after the map above.
  const trackedChanges = changes.toXml()
  const automaticStyles = styles.toXml()

  const contentXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-content ${NS} office:version="1.3">` +
    `<office:automatic-styles>${automaticStyles}</office:automatic-styles>` +
    '<office:body><office:text>' +
    trackedChanges +
    body +
    '</office:text></office:body></office:document-content>'

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-styles ${NS} office:version="1.3"><office:styles>` +
    '<style:style style:name="Standard" style:display-name="Default Paragraph Style" style:family="paragraph"/>' +
    '<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard"/>' +
    '<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard"/>' +
    '<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard"/>' +
    HEADING_STYLES +
    '</office:styles></office:document-styles>'

  // Spec §5.7: every export carries the file names, the timestamp, the summary
  // and the software version, so a document found later can be traced back.
  const metaXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-meta ${NS} office:version="1.3"><office:meta>` +
    `<meta:generator>${escapeXml(`${APP_NAME} ${APP_VERSION}`)}</meta:generator>` +
    `<dc:title>${escapeXml(`Comparison of ${diff.original.fileName} and ${diff.revised.fileName}`)}</dc:title>` +
    `<dc:date>${generated.toISOString().replace('Z', '')}</dc:date>` +
    `<dc:description>${escapeXml(
      `${describeSummary(diff.summary)} Original: ${diff.original.fileName} (${plural(diff.original.wordCount, 'word')}). ` +
        `Revised: ${diff.revised.fileName} (${plural(diff.revised.wordCount, 'word')}).`,
    )}</dc:description>` +
    '</office:meta></office:document-meta>'

  const zip = new JSZip()
  // The mimetype entry must be first and stored uncompressed, or the file is
  // not recognised as an ODT without unzipping it.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file(
    'META-INF/manifest.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
      '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
      '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>' +
      '</manifest:manifest>',
  )
  zip.file('content.xml', contentXml)
  zip.file('styles.xml', stylesXml)
  zip.file('meta.xml', metaXml)

  return zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/vnd.oasis.opendocument.text',
  })
}

export function trackedOdtFileName(diff: DocumentDiff): string {
  const clean = (value: string) =>
    value.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 40)
  return `tracked_${clean(diff.original.fileName)}_vs_${clean(diff.revised.fileName)}_${diff.generatedAt.slice(0, 10)}.odt`
}

export async function downloadTrackedChangesOdt(diff: DocumentDiff): Promise<void> {
  const data = await buildTrackedChangesOdt(diff)
  const blob = new Blob([data], { type: 'application/vnd.oasis.opendocument.text' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = trackedOdtFileName(diff)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

