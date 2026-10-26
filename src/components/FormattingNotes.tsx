import { describeFormattingChange } from '../services/formatting.ts'
import type { FormattingChange } from '../types/diff.ts'

/**
 * Formatting changes ride below the paragraph rather than inline: spec §5.3 is
 * explicit that text detail wins over formatting detail whenever the two
 * compete for the reader's attention. They carry their own violet so a reviewer
 * can spot one while scanning without stopping to read it, and a tinted rule on
 * the left ties several notes under one paragraph into a single block.
 */
export function FormattingNotes({ changes }: { changes: FormattingChange[] }) {
  if (changes.length === 0) return null

  return (
    <ul className="mt-1.5 space-y-0.5 border-l-2 border-format/30 bg-format-bg py-1 pr-2 pl-2 text-xs text-format">
      {changes.map((change, index) => (
        <li key={index} className="flex gap-1.5">
          <span aria-hidden="true">◇</span>
          <span>{describeFormattingChange(change)}</span>
        </li>
      ))}
    </ul>
  )
}
