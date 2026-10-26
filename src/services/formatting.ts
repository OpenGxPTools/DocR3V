/** Plain-language phrasing for diff results, shared by the UI and the export. */

import type { DiffSummary, FormattingChange, ParagraphStatus } from '../types/diff.ts'
import type { FormattingKey } from '../types/document.ts'

/**
 * Splits a segment's trailing separator off its text.
 *
 * Segments own the whitespace that follows them so that the original column,
 * the revised column and the merged view can each be rebuilt by concatenating a
 * subset of them. That is right for the data model and wrong for the display: a
 * highlight that runs one space past the last letter looks like a mistake. Every
 * renderer marks the word and emits the space beside it.
 */
export function splitTrailingSpace(text: string): [core: string, trailing: string] {
  const match = /\s+$/.exec(text)
  if (!match) return [text, '']
  return [text.slice(0, match.index), match[0]]
}

/**
 * How each tracked attribute is named to the reviewer. The key names are
 * developer vocabulary ("allCaps"); these are what a Quality reviewer would
 * write in a change record, and they are also what the legend lists, so the
 * wording a reader sees in a note always matches the wording they were told to
 * expect.
 */
export const FORMATTING_LABELS: Record<FormattingKey, string> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underlined',
  strikethrough: 'struck through',
  superscript: 'superscript',
  subscript: 'subscript',
  allCaps: 'in capitals',
  smallCaps: 'in small capitals',
}

export function describeFormattingChange(change: FormattingChange): string {
  if (change.kind === 'style') {
    return `Paragraph style changed from “${change.from}” to “${change.to}”`
  }
  const verb = change.to === 'on' ? 'now' : 'no longer'
  return `“${change.phrase}” is ${verb} ${FORMATTING_LABELS[change.kind]}`
}

export const STATUS_LABELS: Record<ParagraphStatus, string> = {
  unchanged: 'Unchanged',
  modified: 'Edited',
  added: 'Added',
  removed: 'Removed',
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`
}

/** One-line headline for the comparison, e.g. for the export cover block. */
export function describeSummary(summary: DiffSummary): string {
  const changed =
    summary.paragraphsAdded + summary.paragraphsRemoved + summary.paragraphsModified
  if (changed === 0 && summary.formattingChanges === 0) {
    return 'No differences found — the two documents match word for word.'
  }
  const parts = [
    plural(summary.wordsAdded, 'word added', 'words added'),
    plural(summary.wordsDeleted, 'word deleted', 'words deleted'),
    plural(summary.formattingChanges, 'formatting change'),
  ]
  return `${parts.join(', ')} across ${plural(changed, 'paragraph')}.`
}
