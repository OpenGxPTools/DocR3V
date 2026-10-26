/**
 * Office Open XML (.docx) parser.
 *
 * Like ODT, a DOCX is a ZIP archive:
 *   word/document.xml — the body
 *   word/styles.xml   — style definitions, including the run properties a
 *                       paragraph or character style implies
 *
 * Word's toggle properties are the fiddly part: `<w:b/>` means bold on, but
 * `<w:b w:val="0"/>` means bold explicitly off, which is how a run opts out of
 * a bold paragraph style. Both have to be honoured or headings come back with
 * spurious formatting changes.
 */

import JSZip from 'jszip'
import {
  DocumentParseError,
  makeParagraph,
  PLAIN,
  type Paragraph,
  type ParsedDocument,
  type RunFormatting,
  type TableCell,
} from '../../types/document.ts'
import { RunBuilder } from './runs.ts'
import { attr, childElements, collectByLocalName, mergeFormat, parseXml } from './xml.ts'

interface StyleDefinition {
  basedOn?: string
  name?: string
  format: Partial<RunFormatting>
}

const OFF_VALUES = new Set(['0', 'false', 'off', 'none'])

/** Tracked attributes that Word stores as a plain toggle element under w:rPr. */
const TOGGLE_PROPERTIES: Array<[keyof RunFormatting, string]> = [
  ['bold', 'b'],
  ['italic', 'i'],
  ['strikethrough', 'strike'],
  ['allCaps', 'caps'],
  ['smallCaps', 'smallCaps'],
]

/** Reads a Word toggle property: present means on unless w:val says otherwise. */
function toggle(parent: Element, localName: string): boolean | undefined {
  for (const child of childElements(parent)) {
    if (child.localName !== localName) continue
    const value = attr(child, 'val')
    return value === undefined ? true : !OFF_VALUES.has(value)
  }
  return undefined
}

function readRunProperties(rPr: Element | undefined): Partial<RunFormatting> {
  if (!rPr) return {}
  const format: Partial<RunFormatting> = {}

  // Word's toggle properties: present means on unless w:val says otherwise.
  for (const [key, element] of TOGGLE_PROPERTIES) {
    const value = toggle(rPr, element)
    if (value !== undefined) format[key] = value
  }

  for (const child of childElements(rPr)) {
    // w:u is not a toggle — it carries an underline pattern, "none" meaning off.
    if (child.localName === 'u') {
      const value = attr(child, 'val')
      format.underline = value === undefined ? true : !OFF_VALUES.has(value)
    }
    // Nor is w:vertAlign: one element selects superscript, subscript or
    // baseline, so reading it has to clear the other two rather than only set
    // its own — otherwise a run that returns to the baseline keeps the
    // superscript it inherited from its style.
    if (child.localName === 'vertAlign') {
      const value = attr(child, 'val')
      format.superscript = value === 'superscript'
      format.subscript = value === 'subscript'
    }
  }

  return format
}

function directChild(parent: Element, localName: string): Element | undefined {
  return childElements(parent).find((child) => child.localName === localName)
}

/** Word's near-universal `<w:thing w:val="…"/>` shape. */
function childVal(parent: Element | undefined, localName: string): string | undefined {
  if (!parent) return undefined
  const child = directChild(parent, localName)
  return child ? attr(child, 'val') : undefined
}

class DocxStyles {
  private readonly definitions = new Map<string, StyleDefinition>()
  private readonly formatCache = new Map<string, Partial<RunFormatting>>()

  add(doc: Document): void {
    for (const style of collectByLocalName(doc, 'style')) {
      const id = attr(style, 'styleId')
      if (!id) continue
      this.definitions.set(id, {
        basedOn: childVal(style, 'basedOn'),
        name: childVal(style, 'name'),
        format: readRunProperties(directChild(style, 'rPr')),
      })
    }
  }

  formatFor(styleId: string | undefined): Partial<RunFormatting> {
    if (!styleId) return {}
    const cached = this.formatCache.get(styleId)
    if (cached) return cached

    const chain: StyleDefinition[] = []
    const seen = new Set<string>()
    let current: string | undefined = styleId
    while (current && !seen.has(current)) {
      seen.add(current)
      const def: StyleDefinition | undefined = this.definitions.get(current)
      if (!def) break
      chain.push(def)
      current = def.basedOn
    }

    let format: Partial<RunFormatting> = {}
    for (let i = chain.length - 1; i >= 0; i--) {
      format = { ...format, ...chain[i].format }
    }
    this.formatCache.set(styleId, format)
    return format
  }

  displayNameFor(styleId: string | undefined): string {
    if (!styleId) return 'Normal'
    return this.definitions.get(styleId)?.name ?? styleId
  }
}

/** Word writes headings as a paragraph style, not a distinct element. */
function headingLevel(styleId: string | undefined, styleName: string): number | undefined {
  const byId = /^heading\s*([1-9])$/i.exec(styleId ?? '')
  if (byId) return Number(byId[1])
  const byName = /^heading\s*([1-9])$/i.exec(styleName)
  if (byName) return Number(byName[1])
  return undefined
}

function collectRuns(run: Element, base: RunFormatting, out: RunBuilder): void {
  const format = mergeFormat(base, readRunProperties(directChild(run, 'rPr')))
  for (const child of childElements(run)) {
    switch (child.localName) {
      case 't':
        out.push(child.textContent ?? '', format)
        break
      case 'tab':
      case 'br':
        out.push(' ', format)
        break
      case 'noBreakHyphen':
        out.push('-', format)
        break
      default:
        break // drawings, footnote references, field codes: no text content
    }
  }
}

function parseParagraph(
  element: Element,
  styles: DocxStyles,
  index: number,
  cell: TableCell | undefined,
): Paragraph | undefined {
  const pPr = directChild(element, 'pPr')
  const styleId = childVal(pPr, 'pStyle')
  const isListItem = pPr ? directChild(pPr, 'numPr') !== undefined : false

  // Paragraph mark properties (w:pPr/w:rPr) set the baseline for every run.
  const base = mergeFormat(
    mergeFormat(PLAIN, styles.formatFor(styleId)),
    readRunProperties(pPr ? directChild(pPr, 'rPr') : undefined),
  )

  const builder = new RunBuilder()
  // Runs can be nested inside hyperlinks and revision containers, so collect
  // every descendant w:r rather than only direct children.
  for (const run of collectByLocalName(element, 'r')) {
    collectRuns(run, base, builder)
  }

  const runs = builder.finish()
  // An empty body paragraph is spacing and carries nothing to review. An empty
  // *cell* is different: dropping it would slide every later cell one position
  // left and misalign the whole row, so it is kept as an empty paragraph and
  // the grid stays honest. This is why a blank or vertically-merged cell used
  // to vanish from the comparison.
  if (runs.length === 0 && !cell) return undefined

  const styleName = styles.displayNameFor(styleId)
  const level = headingLevel(styleId, styleName)

  let indentLevel: number | undefined
  if (isListItem && pPr) {
    const ilvl = childVal(directChild(pPr, 'numPr'), 'ilvl')
    indentLevel = Number(ilvl ?? '0') + 1
  }

  return makeParagraph(index, runs, {
    kind: level !== undefined ? 'heading' : isListItem ? 'listItem' : 'paragraph',
    level: level ?? indentLevel,
    styleName,
    cell,
  })
}

/**
 * Works out where each cell of a table sits, before any content is read.
 *
 * Word records a horizontal merge as w:gridSpan on one cell, and a vertical
 * merge as a run of cells carrying w:vMerge — "restart" on the first, bare on
 * every continuation. A continuation is a real w:tc, so counting it as an
 * ordinary cell would shift the rest of its row one column left; the same cell
 * then has different coordinates in the two documents being compared, does not
 * pair with itself, and the table reports changes nobody made.
 *
 * Measuring first, in its own pass, is what lets a merge's rowSpan be known
 * before the paragraphs inside it are built — the span is only discovered on
 * reaching the last continuation, by which time the content is long emitted.
 */
function layOutTable(
  tableElement: Element,
  table: number,
): Array<{ element: Element; cell: Omit<TableCell, 'offset'> }> {
  const placed: Array<{ element: Element; cell: Omit<TableCell, 'offset'> }> = []
  /** Open vertical merges, keyed by starting column, holding the owner's entry. */
  const openMerges = new Map<number, { cell: { rowSpan?: number } }>()
  let row = 0

  for (const child of childElements(tableElement)) {
    if (child.localName !== 'tr') continue
    let column = 0

    for (const cellElement of childElements(child)) {
      if (cellElement.localName !== 'tc') continue

      const properties = directChild(cellElement, 'tcPr')
      const span = Number(childVal(properties, 'gridSpan') ?? '1')
      const columnSpan = Number.isFinite(span) && span > 0 ? span : 1

      const vMerge = properties ? directChild(properties, 'vMerge') : undefined
      const startsMerge = vMerge !== undefined && attr(vMerge, 'val') === 'restart'
      const continuesMerge = vMerge !== undefined && !startsMerge

      if (continuesMerge) {
        // Content belongs to the cell that began the merge; this one only
        // extends it downwards and holds its columns.
        const owner = openMerges.get(column)
        if (owner) owner.cell.rowSpan = (owner.cell.rowSpan ?? 1) + 1
        column += columnSpan
        continue
      }

      const cell: Omit<TableCell, 'offset'> = { table, row, column, columnSpan }
      if (startsMerge) {
        cell.rowSpan = 1
        openMerges.set(column, { cell })
      }
      placed.push({ element: cellElement, cell })
      column += columnSpan
    }
    row++
  }

  return placed
}

/**
 * Walk state that has to survive recursion: how many tables have been seen so
 * far, and which cell we are currently inside.
 */
interface WalkContext {
  tables: { count: number }
  cell?: Omit<TableCell, 'offset'>
  /** Paragraphs emitted so far by the cell we are inside. */
  cellOffset?: { next: number }
}

function walkBody(
  node: Element,
  styles: DocxStyles,
  context: WalkContext,
  paragraphs: Paragraph[],
): void {
  for (const element of childElements(node)) {
    switch (element.localName) {
      case 'p': {
        const cell = context.cell
          ? { ...context.cell, offset: context.cellOffset!.next++ }
          : undefined
        const paragraph = parseParagraph(element, styles, paragraphs.length, cell)
        if (paragraph) paragraphs.push(paragraph)
        break
      }
      case 'tbl': {
        // A nested table is walked as its own table rather than as cells of its
        // parent, which keeps each grid's coordinates internally consistent.
        const table = context.tables.count++
        for (const placed of layOutTable(element, table)) {
          walkBody(
            placed.element,
            styles,
            { tables: context.tables, cell: placed.cell, cellOffset: { next: 0 } },
            paragraphs,
          )
        }
        break
      }
      case 'sectPr':
        break // section layout, no content
      default:
        walkBody(element, styles, context, paragraphs)
    }
  }
}

export async function parseDocx(
  data: ArrayBuffer,
  fileName: string,
  byteSize: number,
): Promise<ParsedDocument> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new DocumentParseError(
      `"${fileName}" could not be read. Check that it is a valid DOCX file.`,
      'DOCX files are ZIP archives; this one could not be opened.',
    )
  }

  const documentEntry = zip.file('word/document.xml')
  if (!documentEntry) {
    throw new DocumentParseError(
      `"${fileName}" could not be read. Check that it is a valid DOCX file.`,
      'The archive has no word/document.xml, so it is not a Word document. Older .doc files must be saved as .docx first.',
    )
  }

  const styles = new DocxStyles()
  const stylesEntry = zip.file('word/styles.xml')
  if (stylesEntry) {
    styles.add(parseXml(await stylesEntry.async('string'), 'word/styles.xml'))
  }

  const doc = parseXml(await documentEntry.async('string'), 'word/document.xml')
  const body = childElements(doc.documentElement).find((el) => el.localName === 'body')

  const paragraphs: Paragraph[] = []
  walkBody(body ?? doc.documentElement, styles, { tables: { count: 0 } }, paragraphs)

  return { fileName, format: 'docx', byteSize, paragraphs }
}
