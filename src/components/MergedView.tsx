/**
 * Merged / redlined view. Spec §5.5.
 *
 * Everything appears once, in original document order, with deletions struck
 * through and additions shaded green. Word's Track Changes underlines additions
 * instead, but here underline is a formatting change the tool reports, so an
 * underlined addition would read as underlined in the document.
 */

import { useMemo } from 'react'
import { FormattingNotes } from './FormattingNotes.tsx'
import { ParagraphText } from './ParagraphText.tsx'
import { paragraphClasses, paragraphIndent } from './paragraphStyles.ts'
import { STATUS_LABELS } from '../services/formatting.ts'
import { cellStatus, toBlocks, type TableBlock } from '../services/tableBlocks.ts'
import type { ParagraphDiff } from '../types/diff.ts'

/** Tints a cell by what happened to it, matching the row tinting of prose. */
const CELL_TONE: Record<string, string> = {
  added: 'bg-added-bg/40',
  removed: 'bg-removed-bg/40',
  modified: '',
  unchanged: '',
}

/**
 * One table, redlined in place.
 *
 * A single grid carries both documents at once: each cell shows its own
 * deletions struck through and insertions shaded, so a reviewer reads the
 * table the way they read the prose around it. A row that exists in only one
 * version is tinted whole rather than silently dropped — "this row was added"
 * is exactly the kind of change a table hides best.
 */
function MergedTable({
  block,
  showFormattingNotes,
  hideDeletions,
  hideAdditions,
}: {
  block: TableBlock
  showFormattingNotes: boolean
  hideDeletions: boolean
  hideAdditions: boolean
}) {
  return (
    <table className="mb-4 w-full border-collapse font-document text-sm">
      <tbody>
        {block.rows.map((row, rowIndex) => {
          // Covered positions carry no status of their own; judging the row by
          // them would call a merged row "unchanged" whatever happened in it.
          const drawn = row.filter((cell) => !cell.covered)
          const statuses = row.map((cell) => cellStatus(cell.diffs))
          const drawnStatuses = drawn.map((cell) => cellStatus(cell.diffs))
          const rowStatus = drawnStatuses.every((s) => s === 'added')
            ? 'added'
            : drawnStatuses.every((s) => s === 'removed')
              ? 'removed'
              : 'mixed'

          // A wholly removed row has nothing left to show once deletions are
          // hidden, and the reverse for a wholly added one.
          if (rowStatus === 'removed' && hideDeletions) return null
          if (rowStatus === 'added' && hideAdditions) return null

          return (
            <tr key={rowIndex} data-status={rowStatus}>
              {row.map((cell, columnIndex) => {
                if (cell.covered) return null
                const status = statuses[columnIndex]
                return (
                  <td
                    key={columnIndex}
                    colSpan={cell.columnSpan > 1 ? cell.columnSpan : undefined}
                    rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                    className={`border border-gray-300 px-2 py-1 align-top ${CELL_TONE[status] ?? ''}`}
                    data-status={status}
                  >
                    {cell.diffs.map((diff) => (
                      <div key={diff.key} id={`p-${diff.key}`} className="scroll-anchor break-words">
                        <ParagraphText
                          segments={diff.segments}
                          side="merged"
                          oldParagraph={diff.oldParagraph}
                          newParagraph={diff.newParagraph}
                          hideDeletions={hideDeletions}
                          hideAdditions={hideAdditions}
                        />
                        {showFormattingNotes && <FormattingNotes changes={diff.formattingChanges} />}
                      </div>
                    ))}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface Props {
  paragraphs: ParagraphDiff[]
  showFormattingNotes: boolean
  hideDeletions: boolean
  hideAdditions: boolean
}

export function MergedView({
  paragraphs,
  showFormattingNotes,
  hideDeletions,
  hideAdditions,
}: Props) {
  const blocks = useMemo(() => toBlocks(paragraphs), [paragraphs])

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {blocks.map((block) => {
        if (block.kind === 'table') {
          return (
            <MergedTable
              key={`t-${block.table}`}
              block={block}
              showFormattingNotes={showFormattingNotes}
              hideDeletions={hideDeletions}
              hideAdditions={hideAdditions}
            />
          )
        }

        const diff = block.diff
        // With deletions hidden, a wholly removed paragraph has nothing left to
        // show; the same in reverse for a wholly added one.
        if (diff.status === 'removed' && hideDeletions) return null
        if (diff.status === 'added' && hideAdditions) return null

        const paragraph = diff.newParagraph ?? diff.oldParagraph
        const isHeading = paragraph?.kind === 'heading'

        return (
          <div
            key={diff.key}
            id={`p-${diff.key}`}
            data-status={diff.status}
            className={`row-shell scroll-anchor ${isHeading ? 'mt-6 mb-2 first:mt-0' : 'mb-3'}`}
          >
            <span className="sr-only">{STATUS_LABELS[diff.status]}: </span>
            <div
              className={`font-document leading-relaxed break-words ${paragraphClasses(paragraph)}`}
              style={{ marginLeft: paragraphIndent(paragraph) }}
            >
              <ParagraphText
                segments={diff.segments}
                side="merged"
                oldParagraph={diff.oldParagraph}
                newParagraph={diff.newParagraph}
                hideDeletions={hideDeletions}
                hideAdditions={hideAdditions}
              />
            </div>
            {showFormattingNotes && <FormattingNotes changes={diff.formattingChanges} />}
          </div>
        )
      })}
    </div>
  )
}
