/**
 * Lines up the rows and columns of a table across two documents.
 *
 * Cells are compared by grid position, which is what stops a table of similar
 * short values pairing row 2 against row 5. But a position is only meaningful
 * if both documents number it the same way, and they do not: inserting a single
 * row pushes every row beneath it down by one, so every cell below the
 * insertion has different coordinates in the two versions, fails the same-cell
 * test, and comes back as a deletion plus an insertion. A one-row edit at the
 * top of a table would rewrite the whole table in the report.
 *
 * So the grids are aligned before they are compared, the same way paragraphs
 * are: rows that correspond are renumbered to a shared index, and rows that
 * exist in only one version keep an index of their own so they still read as
 * added or removed. Columns get the same treatment, since a new leading column
 * shifts a table just as thoroughly.
 */

import { similarity, tokenize } from './tokenDiff.ts'
import type { Paragraph, ParsedDocument, TableCell } from '../types/document.ts'

/**
 * How alike two rows must be to be considered the same row.
 *
 * Low on purpose. Mispairing two rows costs a noisy word diff inside cells that
 * correspond loosely; failing to pair them costs the whole-table rewrite this
 * module exists to prevent. As with paragraphs, the recoverable error is the
 * one to prefer.
 */
const MIN_LINE_SIMILARITY = 0.25

/** Canonical index for each line of each side; matched lines share a number. */
export interface LineAlignment {
  oldToCanonical: number[]
  newToCanonical: number[]
}

/**
 * Order-preserving alignment of two sequences of text.
 *
 * The same longest-common-subsequence shape the paragraph aligner uses, over
 * whole-row (or whole-column) text. Runs of unmatched lines with the same count
 * on both sides are then paired up positionally: a row whose every cell was
 * rewritten scores below the floor, but if it sits between two matched rows and
 * has exactly one counterpart, it is that counterpart.
 */
export function alignLines(oldLines: string[], newLines: string[]): LineAlignment {
  const oldKeys = oldLines.map((line) => tokenize(line).map((t) => t.key))
  const newKeys = newLines.map((line) => tokenize(line).map((t) => t.key))

  const rows = oldLines.length
  const cols = newLines.length
  const score = Array.from({ length: rows + 1 }, () => new Float64Array(cols + 1))
  const pairScore = Array.from({ length: rows }, () => new Float64Array(cols))

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const value = similarity(oldKeys[i], newKeys[j])
      pairScore[i][j] = value >= MIN_LINE_SIMILARITY ? value : 0
    }
  }

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      const paired = pairScore[i - 1][j - 1] > 0 ? score[i - 1][j - 1] + pairScore[i - 1][j - 1] : -1
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], paired)
    }
  }

  const matches: Array<[number, number]> = []
  let i = rows
  let j = cols
  while (i > 0 && j > 0) {
    const paired = pairScore[i - 1][j - 1] > 0 ? score[i - 1][j - 1] + pairScore[i - 1][j - 1] : -1
    if (paired >= score[i - 1][j] && paired >= score[i][j - 1] && paired >= 0) {
      matches.push([i - 1, j - 1])
      i--
      j--
    } else if (score[i - 1][j] >= score[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  matches.reverse()

  // Fill the gaps between matches: equal-sized runs on both sides correspond
  // one to one even when their wording no longer resembles itself.
  const pairs: Array<[number, number]> = []
  let oldCursor = 0
  let newCursor = 0
  const flushGap = (oldEnd: number, newEnd: number) => {
    const oldGap = oldEnd - oldCursor
    const newGap = newEnd - newCursor
    if (oldGap > 0 && oldGap === newGap) {
      for (let k = 0; k < oldGap; k++) pairs.push([oldCursor + k, newCursor + k])
    }
    oldCursor = oldEnd
    newCursor = newEnd
  }
  for (const [o, n] of matches) {
    flushGap(o, n)
    pairs.push([o, n])
    oldCursor = o + 1
    newCursor = n + 1
  }
  flushGap(oldLines.length, newLines.length)

  /*
   * Walk both sides in step, in order. Lines before a match belong only to
   * their own document and take an index of their own; the matched pair then
   * shares one. `pairs` is strictly increasing on both sides, which is what
   * makes a single forward pass enough.
   */
  const oldToCanonical = new Array<number>(oldLines.length).fill(-1)
  const newToCanonical = new Array<number>(newLines.length).fill(-1)

  let next = 0
  let o = 0
  let n = 0
  for (const [matchedOld, matchedNew] of pairs) {
    while (o < matchedOld) oldToCanonical[o++] = next++
    while (n < matchedNew) newToCanonical[n++] = next++
    oldToCanonical[matchedOld] = next
    newToCanonical[matchedNew] = next
    next++
    o = matchedOld + 1
    n = matchedNew + 1
  }
  while (o < oldLines.length) oldToCanonical[o++] = next++
  while (n < newLines.length) newToCanonical[n++] = next++

  return { oldToCanonical, newToCanonical }
}

/** Text of one row (or column) of a table, for comparison purposes. */
function lineTexts(
  paragraphs: Paragraph[],
  table: number,
  axis: 'row' | 'column',
): { count: number; texts: string[] } {
  const byLine = new Map<number, string[]>()
  let count = 0
  for (const paragraph of paragraphs) {
    const cell = paragraph.cell
    if (!cell || cell.table !== table) continue
    const index = cell[axis]
    count = Math.max(count, index + 1)
    const bucket = byLine.get(index)
    if (bucket) bucket.push(paragraph.text)
    else byLine.set(index, [paragraph.text])
  }
  const texts: string[] = []
  for (let i = 0; i < count; i++) texts.push((byLine.get(i) ?? []).join(' '))
  return { count, texts }
}

function tableIndices(paragraphs: Paragraph[]): number[] {
  const seen = new Set<number>()
  for (const paragraph of paragraphs) {
    if (paragraph.cell) seen.add(paragraph.cell.table)
  }
  return [...seen].sort((a, b) => a - b)
}

/** A paragraph with its cell coordinates rewritten to the canonical grid. */
function withCell(paragraph: Paragraph, cell: TableCell): Paragraph {
  return { ...paragraph, cell }
}

/**
 * Renumbers both documents' table coordinates onto a shared grid.
 *
 * Returns new paragraph arrays; the inputs are left alone, since the originals
 * are what the views render and their own row and column numbers are what the
 * reader sees in the source document.
 */
export function alignTables(
  original: ParsedDocument,
  revised: ParsedDocument,
): { original: Paragraph[]; revised: Paragraph[] } {
  const tables = tableIndices(original.paragraphs).filter((t) =>
    tableIndices(revised.paragraphs).includes(t),
  )
  if (tables.length === 0) return { original: original.paragraphs, revised: revised.paragraphs }

  const oldMap = new Map<string, TableCell>()
  const newMap = new Map<string, TableCell>()
  const key = (cell: TableCell) => `${cell.table}:${cell.row}:${cell.column}`

  for (const table of tables) {
    const rows = alignLines(
      lineTexts(original.paragraphs, table, 'row').texts,
      lineTexts(revised.paragraphs, table, 'row').texts,
    )
    const columns = alignLines(
      lineTexts(original.paragraphs, table, 'column').texts,
      lineTexts(revised.paragraphs, table, 'column').texts,
    )

    for (const paragraph of original.paragraphs) {
      const cell = paragraph.cell
      if (!cell || cell.table !== table) continue
      oldMap.set(key(cell), {
        ...cell,
        row: rows.oldToCanonical[cell.row] ?? cell.row,
        column: columns.oldToCanonical[cell.column] ?? cell.column,
      })
    }
    for (const paragraph of revised.paragraphs) {
      const cell = paragraph.cell
      if (!cell || cell.table !== table) continue
      newMap.set(key(cell), {
        ...cell,
        row: rows.newToCanonical[cell.row] ?? cell.row,
        column: columns.newToCanonical[cell.column] ?? cell.column,
      })
    }
  }

  const remap = (paragraphs: Paragraph[], map: Map<string, TableCell>) =>
    paragraphs.map((paragraph) => {
      if (!paragraph.cell) return paragraph
      const replacement = map.get(key(paragraph.cell))
      return replacement ? withCell(paragraph, replacement) : paragraph
    })

  return {
    original: remap(original.paragraphs, oldMap),
    revised: remap(revised.paragraphs, newMap),
  }
}
