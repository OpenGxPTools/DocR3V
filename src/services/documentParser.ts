/**
 * Format detection, validation and dispatch. See spec §5.1.
 *
 * Everything below runs in the browser: the file is read from the local File
 * object and never crosses the network, which is what makes the app safe to
 * point at controlled documents.
 */

import {
  DocumentParseError,
  SUPPORTED_EXTENSIONS,
  type ParsedDocument,
  type SupportedFormat,
} from '../types/document.ts'
import { parseDocx } from './parsers/docx.ts'
import { parseMarkdown } from './parsers/markdown.ts'
import { parseOdt } from './parsers/odt.ts'
import { parseText } from './parsers/text.ts'

export const MAX_FILE_BYTES = 5 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

export function detectFormat(fileName: string): SupportedFormat | undefined {
  return SUPPORTED_EXTENSIONS[extensionOf(fileName)]
}

/** Throws a DocumentParseError with a reviewer-facing message, or returns the format. */
export function validateFile(file: File): SupportedFormat {
  const format = detectFormat(file.name)
  if (!format) {
    const extension = extensionOf(file.name)
    throw new DocumentParseError(
      `"${file.name}" is not a supported file type.`,
      extension === 'pdf'
        ? 'PDF text cannot be extracted reliably enough for a clause-level comparison. Save the document as DOCX or ODT first, then compare.'
        : 'We support Word documents (.docx), OpenDocument Text (.odt), Markdown (.md) and plain text (.txt).',
    )
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new DocumentParseError(
      `"${file.name}" is ${formatBytes(file.size)}, but the limit is ${formatBytes(MAX_FILE_BYTES)}.`,
      'Large documents are usually large because of embedded images. Removing them, or splitting the document into sections, will bring it under the limit.',
    )
  }
  if (file.size === 0) {
    throw new DocumentParseError(`"${file.name}" is empty.`)
  }
  return format
}

export async function parseFile(file: File): Promise<ParsedDocument> {
  const format = validateFile(file)

  if (format === 'md' || format === 'txt') {
    const source = await file.text()
    return format === 'md'
      ? parseMarkdown(source, file.name, file.size)
      : parseText(source, file.name, file.size)
  }

  const data = await file.arrayBuffer()
  return format === 'odt'
    ? parseOdt(data, file.name, file.size)
    : parseDocx(data, file.name, file.size)
}

/** Parses raw bytes directly. Used by the test suite and fixture tooling. */
export async function parseBuffer(
  data: ArrayBuffer,
  fileName: string,
): Promise<ParsedDocument> {
  const format = detectFormat(fileName)
  if (!format) throw new DocumentParseError(`Unsupported file type: "${fileName}".`)
  const byteSize = data.byteLength

  if (format === 'md' || format === 'txt') {
    const source = new TextDecoder().decode(data)
    return format === 'md'
      ? parseMarkdown(source, fileName, byteSize)
      : parseText(source, fileName, byteSize)
  }
  return format === 'odt'
    ? parseOdt(data, fileName, byteSize)
    : parseDocx(data, fileName, byteSize)
}
