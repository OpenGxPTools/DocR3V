import { splitTrailingSpace } from '../services/formatting.ts'
import { makeParagraph, PLAIN, type ParsedDocument, type TextRun } from '../types/document.ts'
import type { DiffSegment } from '../types/diff.ts'

/** Builds a plain-text ParsedDocument, one paragraph per string. */
export function docOf(fileName: string, ...texts: string[]): ParsedDocument {
  return {
    fileName,
    format: 'txt',
    byteSize: texts.join('\n').length,
    paragraphs: texts.map((text, index) =>
      makeParagraph(index, [{ text, format: PLAIN }]),
    ),
  }
}

/**
 * Renders segments in the notation the specification uses, so a failing
 * assertion reads the way §5.2 describes the behaviour. Mirrors what the
 * renderers do, including keeping the separator space outside the marks.
 */
export function notate(segments: DiffSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.op === 'equal') return segment.text
      const [core, trailing] = splitTrailingSpace(segment.text)
      return segment.op === 'delete' ? `[-${core}-]${trailing}` : `[+${core}+]${trailing}`
    })
    .join('')
}

export function runs(...specs: Array<[string, Partial<TextRun['format']>?]>): TextRun[] {
  return specs.map(([text, format]) => ({
    text,
    format: { ...PLAIN, ...format },
  }))
}
