/**
 * OpenDocument Text (.odt) parser.
 *
 * An ODT file is a ZIP archive. Everything we need lives in two entries:
 *   content.xml — the body, plus "automatic" styles generated per-document
 *   styles.xml  — the named styles (Heading 1, Body Text, …) those inherit from
 *
 * Style resolution matters because LibreOffice rarely writes `fo:font-weight`
 * directly on a span; it writes a reference to an automatic style whose parent
 * chain eventually carries the bold flag.
 */

import JSZip from 'jszip'
import {
  DocumentParseError,
  makeParagraph,
  PLAIN,
  type Paragraph,
  type ParsedDocument,
  type TableCell,
  type RunFormatting,
} from '../../types/document.ts'
import { RunBuilder } from './runs.ts'
import {
  attr,
  childElements,
  collectByLocalName,
  findByLocalName,
  mergeFormat,
  parseXml,
} from './xml.ts'

interface StyleDefinition {
  parent?: string
  displayName?: string
  format: Partial<RunFormatting>
}

/** Elements whose text is commentary or revision history, not document content. */
const SKIPPED_ELEMENTS = new Set(['annotation', 'note', 'tracked-changes', 'changed-region'])

/** ODF encodes characters that are illegal in style names, e.g. "Heading_20_1". */
function decodeStyleName(name: string): string {
  return name.replace(/_([0-9a-fA-F]{2})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
}

function readTextProperties(styleElement: Element): Partial<RunFormatting> {
  const format: Partial<RunFormatting> = {}
  for (const props of collectByLocalName(styleElement, 'text-properties')) {
    const weight = attr(props, 'font-weight')
    if (weight !== undefined) format.bold = weight !== 'normal'

    const fontStyle = attr(props, 'font-style')
    if (fontStyle !== undefined) format.italic = fontStyle !== 'normal'

    const underline = attr(props, 'text-underline-style')
    if (underline !== undefined) format.underline = underline !== 'none'

    const strike = attr(props, 'text-line-through-style')
    if (strike !== undefined) format.strikethrough = strike !== 'none'

    // ODF expresses both small caps and all caps through two different
    // attributes, and LibreOffice may write either. fo:font-variant carries
    // small-caps; fo:text-transform carries uppercase. Neither implies the
    // other, so they are read independently.
    const variant = attr(props, 'font-variant')
    if (variant !== undefined) format.smallCaps = variant === 'small-caps'

    const transform = attr(props, 'text-transform')
    if (transform !== undefined) format.allCaps = transform === 'uppercase'

    // style:text-position is "<vertical-position> [<size>]", where the position
    // is a percentage, or the keyword "super"/"sub". A positive percentage is
    // raised text, a negative one lowered, and 0% returns to the baseline —
    // which must clear both flags, not leave an inherited one standing.
    const position = attr(props, 'text-position')
    if (position !== undefined) {
      const [raise] = position.trim().split(/\s+/)
      const percent = Number.parseFloat(raise)
      format.superscript = raise === 'super' || (Number.isFinite(percent) && percent > 0)
      format.subscript = raise === 'sub' || (Number.isFinite(percent) && percent < 0)
    }
  }
  return format
}

class OdtStyles {
  private readonly definitions = new Map<string, StyleDefinition>()
  private readonly formatCache = new Map<string, Partial<RunFormatting>>()

  add(doc: Document): void {
    for (const style of collectByLocalName(doc, 'style')) {
      const name = attr(style, 'name')
      if (!name) continue
      this.definitions.set(name, {
        parent: attr(style, 'parent-style-name'),
        displayName: attr(style, 'display-name'),
        format: readTextProperties(style),
      })
    }
  }

  /** Resolves a style's inline formatting, walking the parent chain. */
  formatFor(name: string | undefined): Partial<RunFormatting> {
    if (!name) return {}
    const cached = this.formatCache.get(name)
    if (cached) return cached

    const chain: StyleDefinition[] = []
    const seen = new Set<string>()
    let current: string | undefined = name
    while (current && !seen.has(current)) {
      seen.add(current)
      const def: StyleDefinition | undefined = this.definitions.get(current)
      if (!def) break
      chain.push(def)
      current = def.parent
    }

    // Nearest definition wins, so apply the chain from the far ancestor inward.
    let format: Partial<RunFormatting> = {}
    for (let i = chain.length - 1; i >= 0; i--) {
      format = { ...format, ...chain[i].format }
    }
    this.formatCache.set(name, format)
    return format
  }

  /**
   * Human-readable name for a paragraph style. Automatic styles have opaque
   * names like "P7", so we report the named style they inherit from instead.
   */
  displayNameFor(name: string | undefined): string {
    if (!name) return 'Default'
    const seen = new Set<string>()
    let current: string | undefined = name
    while (current && !seen.has(current)) {
      seen.add(current)
      const def: StyleDefinition | undefined = this.definitions.get(current)
      if (!def) break
      if (def.displayName) return def.displayName
      // "P7"-style automatic names carry no meaning; keep climbing.
      if (!/^(P|T|Table|fr|gr)\d+$/.test(current)) return decodeStyleName(current)
      current = def.parent
    }
    return decodeStyleName(name)
  }
}

/** Walks a text:p / text:h subtree, collecting formatted runs. */
function collectRuns(node: Element, styles: OdtStyles, format: RunFormatting, out: RunBuilder): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]

    if (child.nodeType === 3) {
      out.push(child.nodeValue ?? '', format)
      continue
    }
    if (child.nodeType !== 1) continue

    const element = child as Element
    const name = element.localName ?? ''
    if (SKIPPED_ELEMENTS.has(name)) continue

    switch (name) {
      case 's': {
        // <text:s text:c="3"/> encodes a run of collapsed spaces.
        const count = Number(attr(element, 'c') ?? '1')
        out.push(' '.repeat(Number.isFinite(count) && count > 0 ? count : 1), format)
        break
      }
      case 'tab':
      case 'line-break':
        // Both are intra-paragraph layout; a single space keeps the paragraph on
        // one logical line for word-level diffing without gluing words together.
        out.push(' ', format)
        break
      case 'span': {
        const spanFormat = mergeFormat(format, styles.formatFor(attr(element, 'style-name')))
        collectRuns(element, styles, spanFormat, out)
        break
      }
      default:
        // Hyperlinks, bookmarks, soft page breaks, inline fields: descend and
        // keep whatever text they contain.
        collectRuns(element, styles, format, out)
    }
  }
}

interface WalkContext {
  listDepth: number
  tables: { count: number }
  cell?: Omit<TableCell, 'offset'>
  /** Paragraphs emitted so far by the cell we are inside. */
  cellOffset?: { next: number }
}

/** Rows may be wrapped in header-row or row-group containers; both are transparent. */
function collectRows(node: Element, rows: Element[]): void {
  for (const child of childElements(node)) {
    const name = child.localName ?? ''
    if (name === 'table-row') rows.push(child)
    else if (name === 'table-header-rows' || name === 'table-row-group') collectRows(child, rows)
  }
}

function walkTable(
  element: Element,
  styles: OdtStyles,
  context: WalkContext,
  paragraphs: Paragraph[],
): void {
  const table = context.tables.count++
  const rows: Element[] = []
  collectRows(element, rows)

  /**
   * Columns held by a vertical merge from an earlier row, and how many rows
   * each still covers.
   *
   * ODF marks those positions with <table:covered-table-cell/>, but tracking
   * the merges directly means the column numbering survives a producer that
   * omits them. Getting this wrong shifts every later cell in the row, so the
   * same cell would carry different coordinates in the two documents being
   * compared and would stop pairing with itself.
   */
  const openMerges = new Map<number, number>()

  rows.forEach((rowElement, row) => {
    let column = 0

    /** Steps over any column still covered from above, consuming one row of it. */
    const skipCovered = () => {
      for (let remaining = openMerges.get(column); remaining; remaining = openMerges.get(column)) {
        if (remaining <= 1) openMerges.delete(column)
        else openMerges.set(column, remaining - 1)
        column++
      }
    }

    for (const cellElement of childElements(rowElement)) {
      const name = cellElement.localName ?? ''
      // A covered cell is the hidden half of a merge. It holds no content but
      // still occupies a column, so it advances the counter without emitting.
      if (name === 'covered-table-cell') {
        const repeat = Number(attr(cellElement, 'number-columns-repeated') ?? '1')
        column += Number.isFinite(repeat) && repeat > 0 ? repeat : 1
        continue
      }
      if (name !== 'table-cell') continue

      skipCovered()

      // ODF states both spans on the merged cell itself, so unlike Word's
      // vertical merges they are known without looking ahead.
      const columns = Number(attr(cellElement, 'number-columns-spanned') ?? '1')
      const rows_ = Number(attr(cellElement, 'number-rows-spanned') ?? '1')
      const columnSpan = Number.isFinite(columns) && columns > 0 ? columns : 1
      const rowSpan = Number.isFinite(rows_) && rows_ > 0 ? rows_ : 1

      walkBody(
        cellElement,
        styles,
        {
          ...context,
          cell: {
            table,
            row,
            column,
            columnSpan,
            rowSpan: rowSpan > 1 ? rowSpan : undefined,
          },
          cellOffset: { next: 0 },
        },
        paragraphs,
      )

      if (rowSpan > 1) {
        for (let i = 0; i < columnSpan; i++) openMerges.set(column + i, rowSpan - 1)
      }
      column += columnSpan
    }
  })
}

function walkBody(
  node: Element,
  styles: OdtStyles,
  context: WalkContext,
  paragraphs: Paragraph[],
): void {
  for (const element of childElements(node)) {
    const name = element.localName ?? ''
    if (SKIPPED_ELEMENTS.has(name)) continue

    if (name === 'p' || name === 'h') {
      const styleName = attr(element, 'style-name')
      const builder = new RunBuilder()
      collectRuns(element, styles, mergeFormat(PLAIN, styles.formatFor(styleName)), builder)
      const runs = builder.finish()
      // Outside a table an empty paragraph is a spacer. Inside one it is an
      // empty cell, and dropping it would shift the rest of the row left.
      if (runs.length === 0 && !context.cell) continue

      const outlineLevel = Number(attr(element, 'outline-level') ?? '1')
      const isHeading = name === 'h'
      paragraphs.push(
        makeParagraph(paragraphs.length, runs, {
          kind: isHeading ? 'heading' : context.listDepth > 0 ? 'listItem' : 'paragraph',
          level: isHeading
            ? Math.min(Math.max(Number.isFinite(outlineLevel) ? outlineLevel : 1, 1), 6)
            : context.listDepth > 0
              ? context.listDepth
              : undefined,
          styleName: styles.displayNameFor(styleName),
          cell: context.cell ? { ...context.cell, offset: context.cellOffset!.next++ } : undefined,
        }),
      )
      continue
    }

    if (name === 'list') {
      walkBody(element, styles, { ...context, listDepth: context.listDepth + 1 }, paragraphs)
      continue
    }
    if (name === 'table') {
      walkTable(element, styles, context, paragraphs)
      continue
    }

    walkBody(element, styles, context, paragraphs)
  }
}

export async function parseOdt(
  data: ArrayBuffer,
  fileName: string,
  byteSize: number,
): Promise<ParsedDocument> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new DocumentParseError(
      `"${fileName}" could not be read. Check that it is a valid ODT file.`,
      'ODT files are ZIP archives; this one could not be opened.',
    )
  }

  const contentEntry = zip.file('content.xml')
  if (!contentEntry) {
    throw new DocumentParseError(
      `"${fileName}" could not be read. Check that it is a valid ODT file.`,
      'The archive has no content.xml, so it is not an OpenDocument text file.',
    )
  }

  const styles = new OdtStyles()
  const stylesEntry = zip.file('styles.xml')
  if (stylesEntry) {
    styles.add(parseXml(await stylesEntry.async('string'), 'styles.xml'))
  }

  const contentDoc = parseXml(await contentEntry.async('string'), 'content.xml')
  styles.add(contentDoc)

  // Restrict the walk to office:body so the automatic-styles section, which can
  // contain text elements of its own, never contributes paragraphs.
  const root = findByLocalName(contentDoc, 'body') ?? contentDoc.documentElement

  const paragraphs: Paragraph[] = []
  walkBody(root, styles, { listDepth: 0, tables: { count: 0 } }, paragraphs)

  return { fileName, format: 'odt', byteSize, paragraphs }
}
