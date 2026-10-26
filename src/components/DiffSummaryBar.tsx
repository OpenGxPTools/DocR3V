import { plural } from '../services/formatting.ts'
import type { DocumentDiff } from '../types/diff.ts'

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-lg font-bold tabular-nums ${tone}`}>{value.toLocaleString()}</span>
      <span className="text-sm text-note">{label}</span>
    </div>
  )
}

export function DiffSummaryBar({ diff }: { diff: DocumentDiff }) {
  const { summary } = diff
  const changedParagraphs =
    summary.paragraphsAdded + summary.paragraphsRemoved + summary.paragraphsModified
  const identical = changedParagraphs === 0 && summary.formattingChanges === 0

  return (
    <div className="border-b border-gray-200 bg-surface px-6 py-3">
      {identical ? (
        <p className="text-sm font-medium">
          No differences found — the two documents match word for word.
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Stat value={summary.wordsAdded} label="words added" tone="text-added" />
          <Stat value={summary.wordsDeleted} label="words deleted" tone="text-removed" />
          <Stat
            value={summary.formattingChanges}
            label="formatting changes"
            tone="text-ink"
          />
          <span className="text-sm text-note">
            in {plural(changedParagraphs, 'paragraph')} of{' '}
            {diff.revised.paragraphCount.toLocaleString()}
          </span>
        </div>
      )}

      <p className="mt-1 text-xs text-note">
        {diff.original.fileName} → {diff.revised.fileName} · compared in {diff.durationMs} ms
      </p>
    </div>
  )
}
