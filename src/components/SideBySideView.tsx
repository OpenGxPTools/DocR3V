/**
 * Side-by-side comparison. Spec §5.4.
 *
 * The two columns are one CSS grid inside one scroll container, so a row's left
 * and right cells are the same grid row and cannot drift apart. That gives
 * synchronised scrolling and aligned paragraphs as a property of the layout,
 * rather than as a scroll handler that has to chase two elements.
 */

import { memo, useMemo } from 'react'
import { FormattingNotes } from './FormattingNotes.tsx'
import { ParagraphText } from './ParagraphText.tsx'
import { paragraphClasses, paragraphIndent } from './paragraphStyles.ts'
import { STATUS_LABELS } from '../services/formatting.ts'
import { cellStatus, toBlocks, type TableBlock } from '../services/tableBlocks.ts'
import type { ParagraphDiff, Side } from '../types/diff.ts'

const CELL_TONE: Record<string, string> = {
  added: 'bg-added-bg/40',
  removed: 'bg-removed-bg/40',
  absent: 'bg-surface',
}

/**
 * Memoised because the toolbar toggles re-render the whole list: with a couple
 * of thousand paragraphs on screen, rebuilding every cell to change one
 * checkbox is the difference between an instant toggle and a visible stall.
 * ParagraphDiff objects are rebuilt only when the comparison is, so identity
 * comparison is exactly the right test here.
 */
const Cell = memo(function Cell({
  diff,
  side,
  showNotes,
  className = '',
}: {
  diff: ParagraphDiff
  side: Extract<Side, 'original' | 'revised'>
  showNotes: boolean
  className?: string
}) {
  const paragraph = side === 'original' ? diff.oldParagraph : diff.newParagraph

  if (!paragraph) {
    return (
      <div className={`h-full px-4 py-2 ${CELL_TONE.absent} ${className}`} aria-hidden="true">
        <span className="text-xs text-note">
          {diff.status === 'added' ? 'Not in the original' : 'Not in the revision'}
        </span>
      </div>
    )
  }

  const tone =
    diff.status === 'added' && side === 'revised'
      ? CELL_TONE.added
      : diff.status === 'removed' && side === 'original'
        ? CELL_TONE.removed
        : ''

  return (
    <div className={`flex h-full gap-3 px-4 py-2 ${tone} ${className}`}>
      <span className="w-8 shrink-0 pt-0.5 text-right font-mono text-xs text-note tabular-nums">
        {paragraph.index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={`font-document leading-relaxed break-words ${paragraphClasses(paragraph)}`}
          style={{ marginLeft: paragraphIndent(paragraph) }}
        >
          <ParagraphText
            segments={diff.segments}
            side={side}
            oldParagraph={diff.oldParagraph}
            newParagraph={diff.newParagraph}
          />
        </div>
        {showNotes && side === 'revised' && <FormattingNotes changes={diff.formattingChanges} />}
      </div>
    </div>
  )
})

/**
 * A table inside one column. The grid is drawn for both documents from the same
 * shape, so the left and right copies stay cell-for-cell comparable even when a
 * row exists on only one side; an absent cell is drawn empty rather than
 * skipped, which would shift the rest of the row.
 */
function TableCells({
  block,
  side,
  showNotes,
}: {
  block: TableBlock
  side: Extract<Side, 'original' | 'revised'>
  showNotes: boolean
}) {
  return (
    <table className="w-full border-collapse font-document text-sm">
      <tbody>
        {block.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, columnIndex) => {
              // A position covered by a merge is not drawn: the merged cell
              // already spans it.
              if (cell.covered) return null
              const diffs = cell.diffs
              const status = cellStatus(diffs)
              const present = diffs.filter((diff) =>
                side === 'original' ? diff.oldParagraph : diff.newParagraph,
              )
              const tone =
                status === 'added' && side === 'revised'
                  ? CELL_TONE.added
                  : status === 'removed' && side === 'original'
                    ? CELL_TONE.removed
                    : ''
              return (
                <td
                  key={columnIndex}
                  colSpan={cell.columnSpan > 1 ? cell.columnSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  className={`border border-gray-300 px-2 py-1 align-top ${tone}`}
                  data-status={status}
                >
                  {present.map((diff) => (
                    <div key={diff.key} className="break-words">
                      <ParagraphText
                        segments={diff.segments}
                        side={side}
                        oldParagraph={diff.oldParagraph}
                        newParagraph={diff.newParagraph}
                      />
                      {showNotes && side === 'revised' && (
                        <FormattingNotes changes={diff.formattingChanges} />
                      )}
                    </div>
                  ))}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface Props {
  paragraphs: ParagraphDiff[]
  showFormattingNotes: boolean
}

export function SideBySideView({ paragraphs, showFormattingNotes }: Props) {
  const blocks = useMemo(() => toBlocks(paragraphs), [paragraphs])

  return (
    <div className="grid grid-cols-2">
      <div className="sticky top-0 z-10 border-b border-gray-300 bg-white/95 px-4 py-2 text-sm font-semibold backdrop-blur">
        Original
      </div>
      <div className="sticky top-0 z-10 border-b border-l border-gray-300 bg-white/95 px-4 py-2 text-sm font-semibold backdrop-blur">
        Revised
      </div>

      {blocks.map((block) => {
        if (block.kind === 'table') {
          const anchor = block.rows.flat().flatMap((c) => c.diffs)[0]
          return (
            <div
              key={`t-${block.table}`}
              className="row-shell col-span-2 grid grid-cols-2 border-b border-gray-200 scroll-anchor"
              id={anchor ? `p-${anchor.key}` : undefined}
            >
              <span className="sr-only">Table with {block.columnCount} columns</span>
              <div className="px-4 py-2">
                <TableCells block={block} side="original" showNotes={showFormattingNotes} />
              </div>
              <div className="border-l border-gray-200 px-4 py-2">
                <TableCells block={block} side="revised" showNotes={showFormattingNotes} />
              </div>
            </div>
          )
        }

        const diff = block.diff
        return (
          <div
            key={diff.key}
            className="row-shell col-span-2 grid grid-cols-2 border-b border-gray-200 scroll-anchor"
            id={`p-${diff.key}`}
            data-status={diff.status}
          >
            {/* The status is announced in text so the row's meaning does not
                depend on its background colour. */}
            <span className="sr-only">{STATUS_LABELS[diff.status]} paragraph</span>
            <Cell diff={diff} side="original" showNotes={showFormattingNotes} />
            <Cell
              diff={diff}
              side="revised"
              showNotes={showFormattingNotes}
              className="border-l border-gray-200"
            />
          </div>
        )
      })}
    </div>
  )
}
