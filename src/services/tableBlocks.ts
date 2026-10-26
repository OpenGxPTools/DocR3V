/**
 * Regroups the flat paragraph diff into renderable blocks. Spec §5.6, Phase 2.
 *
 * The diff engine works on a flat sequence and should keep doing so — alignment
 * is the delicate part of this app and a tree would complicate it for no gain.
 * The grid only has to exist at the moment of drawing, so it is rebuilt here
 * from the cell coordinates the parsers recorded.
 *
 * A table's shape is taken from both documents at once: a row or column that
 * exists in only one of them still has to appear, or the reviewer cannot see
 * that it was added or removed.
 */

import type { ParagraphDiff } from '../types/diff.ts'
import type { TableCell } from '../types/document.ts'

export interface GridCell {
  diffs: ParagraphDiff[]
  columnSpan: number
  rowSpan: number
  /**
   * True when a merge from above or to the left occupies this position. Such a
   * cell must not be drawn at all — the merged cell already covers the space —
   * but it has to exist in the grid so later columns keep their index.
   */
  covered: boolean
}

export interface TableBlock {
  kind: 'table'
  table: number
  /** Row-major grid. */
  rows: GridCell[][]
  columnCount: number
}

export interface ProseBlock {
  kind: 'prose'
  diff: ParagraphDiff
}

export type Block = TableBlock | ProseBlock

/** The cell a diff belongs to, from whichever side has one. */
function cellOf(diff: ParagraphDiff): TableCell | undefined {
  return diff.newParagraph?.cell ?? diff.oldParagraph?.cell
}

export function toBlocks(paragraphs: ParagraphDiff[]): Block[] {
  const blocks: Block[] = []
  let current: { table: number; entries: Array<{ cell: TableCell; diff: ParagraphDiff }> } | null =
    null

  const flush = () => {
    if (!current) return
    blocks.push(buildTable(current.table, current.entries))
    current = null
  }

  for (const diff of paragraphs) {
    const cell = cellOf(diff)
    if (!cell) {
      flush()
      blocks.push({ kind: 'prose', diff })
      continue
    }
    if (current && current.table !== cell.table) flush()
    current ??= { table: cell.table, entries: [] }
    current.entries.push({ cell, diff })
  }
  flush()

  return blocks
}

function buildTable(
  table: number,
  entries: Array<{ cell: TableCell; diff: ParagraphDiff }>,
): TableBlock {
  let rowCount = 0
  let columnCount = 0
  for (const { cell } of entries) {
    rowCount = Math.max(rowCount, cell.row + (cell.rowSpan ?? 1))
    columnCount = Math.max(columnCount, cell.column + (cell.columnSpan ?? 1))
  }

  const rows: GridCell[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => ({
      diffs: [] as ParagraphDiff[],
      columnSpan: 1,
      rowSpan: 1,
      covered: false,
    })),
  )

  for (const { cell, diff } of entries) {
    const target = rows[cell.row]?.[cell.column]
    if (!target) continue
    target.diffs.push(diff)
    target.columnSpan = cell.columnSpan ?? 1
    target.rowSpan = cell.rowSpan ?? 1
  }

  /*
   * Mark the positions a merged cell covers. They keep their place in the grid
   * so the columns after them stay aligned, but they are never drawn: a merged
   * cell rendered as several separate ones puts empty boxes where the document
   * has one, which is exactly the layout error a reviewer would be checking for.
   */
  for (let row = 0; row < rowCount; row++) {
    for (let column = 0; column < columnCount; column++) {
      const cell = rows[row][column]
      if (cell.covered) continue
      for (let r = row; r < Math.min(rowCount, row + cell.rowSpan); r++) {
        for (let c = column; c < Math.min(columnCount, column + cell.columnSpan); c++) {
          if (r === row && c === column) continue
          rows[r][c].covered = true
        }
      }
    }
  }

  // Several paragraphs in one cell keep their in-cell order.
  for (const row of rows) {
    for (const cell of row) {
      cell.diffs.sort((a, b) => (cellOf(a)?.offset ?? 0) - (cellOf(b)?.offset ?? 0))
    }
  }

  return { kind: 'table', table, rows, columnCount }
}

/** Worst status in a cell, for tinting: added/removed outrank modified. */
export function cellStatus(diffs: ParagraphDiff[]): ParagraphDiff['status'] {
  if (diffs.length === 0) return 'unchanged'
  if (diffs.some((d) => d.status === 'added')) return 'added'
  if (diffs.some((d) => d.status === 'removed')) return 'removed'
  if (diffs.some((d) => d.status === 'modified')) return 'modified'
  return 'unchanged'
}
