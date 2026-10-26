/**
 * Plain-text parser.
 *
 * Every non-blank line becomes a paragraph. Splitting on lines rather than on
 * blank-line-separated blocks gives the diff engine finer alignment anchors,
 * which matters for the numbered clause lists that fill an SOP.
 */

import { makeParagraph, PLAIN, type Paragraph, type ParsedDocument } from '../../types/document.ts'

export function parseText(source: string, fileName: string, byteSize: number): ParsedDocument {
  const paragraphs: Paragraph[] = []
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const text = raw.trim()
    if (text === '') continue
    paragraphs.push(makeParagraph(paragraphs.length, [{ text, format: { ...PLAIN } }]))
  }
  return { fileName, format: 'txt', byteSize, paragraphs }
}
