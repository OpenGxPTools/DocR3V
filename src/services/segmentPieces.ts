/**
 * Intersects a diff segment with the source paragraph's formatting runs.
 *
 * A segment is a stretch of text with one diff operation; a run is a stretch
 * with one set of formatting. Neither respects the other's boundaries, so
 * showing a document's own bold and italic inside a diff means cutting the
 * segment wherever a run starts or ends. Without this the comparison renders
 * every SOP as unformatted prose, and a heading that reads as bold in Word
 * reads as body text in the report.
 */

import { formatsEqual, PLAIN, type Paragraph, type RunFormatting } from '../types/document.ts'

export interface StyledPiece {
  text: string
  format: RunFormatting
}

/**
 * `text` is the segment's display text and `offset` is where it starts in
 * `paragraph.text`. The segment may run one character past the paragraph, since
 * segments carry the separator that follows them; that tail is unformatted.
 */
export function styledPieces(
  paragraph: Paragraph | undefined,
  offset: number | undefined,
  text: string,
): StyledPiece[] {
  if (!paragraph || offset === undefined || text === '') return [{ text, format: PLAIN }]

  const end = offset + text.length
  const pieces: StyledPiece[] = []
  let position = 0

  for (const run of paragraph.runs) {
    const runStart = position
    const runEnd = position + run.text.length
    position = runEnd

    const from = Math.max(offset, runStart)
    const to = Math.min(end, runEnd)
    if (to <= from) continue

    const slice = text.slice(from - offset, to - offset)
    const last = pieces[pieces.length - 1]
    if (last && formatsEqual(last.format, run.format)) last.text += slice
    else pieces.push({ text: slice, format: run.format })
  }

  // Whatever of the segment lies past the end of the paragraph's runs.
  const consumed = pieces.reduce((total, piece) => total + piece.text.length, 0)
  if (consumed < text.length) pieces.push({ text: text.slice(consumed), format: PLAIN })

  return pieces.length > 0 ? pieces : [{ text, format: PLAIN }]
}

export { isPlain } from '../types/document.ts'
