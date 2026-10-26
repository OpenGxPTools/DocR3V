/**
 * Renders one paragraph's diff segments, filtered to the side being shown.
 *
 * The same component backs the left column, the right column and the merged
 * view; only the set of operations it is asked to include changes. That keeps
 * the three views incapable of disagreeing about what changed.
 */

import { Fragment } from 'react'
import { splitTrailingSpace } from '../services/formatting.ts'
import { isPlain, styledPieces } from '../services/segmentPieces.ts'
import type { DiffSegment, SegmentOp, Side } from '../types/diff.ts'
import type { Paragraph } from '../types/document.ts'

const SIDE_OPS: Record<Side, SegmentOp[]> = {
  original: ['equal', 'delete'],
  revised: ['equal', 'insert'],
  merged: ['equal', 'delete', 'insert'],
}

interface Props {
  segments: DiffSegment[]
  side: Side
  /** Source paragraphs, so the document's own bold and italic survive the diff. */
  oldParagraph?: Paragraph
  newParagraph?: Paragraph
  /** Merged view only: lets the reviewer read the before or after text alone. */
  hideDeletions?: boolean
  hideAdditions?: boolean
}

/** Applies the document's own inline formatting within one segment. */
function Formatted({
  segment,
  text,
  side,
  oldParagraph,
  newParagraph,
}: {
  segment: DiffSegment
  text: string
  side: Side
  oldParagraph?: Paragraph
  newParagraph?: Paragraph
}) {
  // Deleted text only exists in the original and inserted text only in the
  // revision. Text present in both is drawn as *its own side* formats it, so a
  // word that gained bold shows plain on the left and bold on the right; taking
  // both from the revision would render the two columns identically and hide
  // the very change the formatting note is reporting. The merged view has only
  // one column to give, and shows the revision's formatting there.
  const fromOriginal = segment.op === 'delete' || (segment.op === 'equal' && side === 'original')
  const source = fromOriginal ? oldParagraph : newParagraph
  const offset = fromOriginal ? segment.oldOffset : segment.newOffset

  return (
    <>
      {styledPieces(source, offset, text).map((piece, index) => {
        if (isPlain(piece.format)) return <Fragment key={index}>{piece.text}</Fragment>

        // Capitalisation is a CSS presentation of the same characters, so it
        // wraps the text before the semantic elements do; the underlying text
        // is untouched and still copies out of the page as the author typed it.
        let node = <>{piece.text}</>
        if (piece.format.allCaps) node = <span className="uppercase">{node}</span>
        if (piece.format.smallCaps) node = <span className="small-caps">{node}</span>
        if (piece.format.superscript) node = <sup>{node}</sup>
        if (piece.format.subscript) node = <sub>{node}</sub>
        if (piece.format.strikethrough) node = <s>{node}</s>
        if (piece.format.underline) node = <u>{node}</u>
        if (piece.format.italic) node = <em>{node}</em>
        if (piece.format.bold) node = <strong>{node}</strong>
        return <Fragment key={index}>{node}</Fragment>
      })}
    </>
  )
}

export function ParagraphText({
  segments,
  side,
  oldParagraph,
  newParagraph,
  hideDeletions,
  hideAdditions,
}: Props) {
  const allowed = SIDE_OPS[side]

  return (
    <>
      {segments.map((segment, index) => {
        if (!allowed.includes(segment.op)) return null
        if (segment.op === 'delete' && hideDeletions) return null
        if (segment.op === 'insert' && hideAdditions) return null

        const formatted = (text: string) => (
          <Formatted
            segment={segment}
            text={text}
            side={side}
            oldParagraph={oldParagraph}
            newParagraph={newParagraph}
          />
        )

        if (segment.op === 'equal') {
          return <Fragment key={index}>{formatted(segment.text)}</Fragment>
        }

        // The separator space sits outside the mark, so the highlight stops at
        // the last letter of the changed word.
        const [core, trailing] = splitTrailingSpace(segment.text)
        if (segment.op === 'delete') {
          return (
            <Fragment key={index}>
              <del className="mark-del" title="Removed from the original">
                {formatted(core)}
              </del>
              {trailing}
            </Fragment>
          )
        }
        return (
          <Fragment key={index}>
            <ins className="mark-ins" title="Added in the revision">
              {formatted(core)}
            </ins>
            {trailing}
          </Fragment>
        )
      })}
    </>
  )
}
