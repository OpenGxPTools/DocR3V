/**
 * Results screen. Spec §6.1 step 3.
 *
 * Holds the view-mode toggle, the display filters, export, and change-to-change
 * navigation. The views themselves are dumb renderers of the same
 * ParagraphDiff array.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { Brand } from './Brand.tsx'
import { DiffSummaryBar } from './DiffSummaryBar.tsx'
import { FormattingLegend } from './FormattingLegend.tsx'
import { MergedView } from './MergedView.tsx'
import { SideBySideView } from './SideBySideView.tsx'
import { buildRedlineFragment, downloadReport, printReport } from '../services/export.ts'
import { downloadTrackedChangesOdt } from '../services/odtExport.ts'
import { plural } from '../services/formatting.ts'
import type { DocumentDiff } from '../types/diff.ts'

type ViewMode = 'side-by-side' | 'merged'

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-ink"
      />
      {children}
    </label>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-2 focus:outline-offset-2 focus:outline-ink ${
        active ? 'bg-ink text-white' : 'text-ink hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

export function ComparisonView({ diff, onReset }: { diff: DocumentDiff; onReset: () => void }) {
  const [mode, setMode] = useState<ViewMode>('side-by-side')
  const [changesOnly, setChangesOnly] = useState(false)
  const [showFormattingNotes, setShowFormattingNotes] = useState(true)
  const [hideDeletions, setHideDeletions] = useState(false)
  const [hideAdditions, setHideAdditions] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [odtState, setOdtState] = useState<'idle' | 'working' | 'failed'>('idle')
  const [printState, setPrintState] = useState<'idle' | 'failed'>('idle')
  const cursor = useRef(-1)

  const changed = useMemo(
    () => diff.paragraphs.filter((p) => p.status !== 'unchanged' || p.formattingChanges.length > 0),
    [diff],
  )

  /*
   * "Changes only" still keeps one unchanged paragraph on each side of a change
   * — spec §2 lists preserved context as a primary goal, and a bare list of
   * edited clauses is exactly the sort of context-free output the app exists to
   * improve on.
   */
  const visible = useMemo(() => {
    if (!changesOnly) return diff.paragraphs
    const keep = new Set<number>()
    diff.paragraphs.forEach((paragraph, index) => {
      if (paragraph.status === 'unchanged' && paragraph.formattingChanges.length === 0) return
      for (let i = Math.max(0, index - 1); i <= Math.min(diff.paragraphs.length - 1, index + 1); i++) {
        keep.add(i)
      }
    })
    return diff.paragraphs.filter((_, index) => keep.has(index))
  }, [diff, changesOnly])

  const jump = useCallback(
    (step: number) => {
      if (changed.length === 0) return
      cursor.current = (cursor.current + step + changed.length) % changed.length
      const target = document.getElementById(`p-${changed[cursor.current].key}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [changed],
  )

  const printPdf = useCallback(async () => {
    try {
      await printReport(diff)
      setPrintState('idle')
    } catch {
      setPrintState('failed')
      setTimeout(() => setPrintState('idle'), 3000)
    }
  }, [diff])

  const downloadTrackedOdt = useCallback(async () => {
    setOdtState('working')
    try {
      await downloadTrackedChangesOdt(diff)
      setOdtState('idle')
    } catch {
      setOdtState('failed')
      setTimeout(() => setOdtState('idle'), 3000)
    }
  }, [diff])

  const copyTrackedChanges = useCallback(async () => {
    const html = buildRedlineFragment(diff)
    try {
      // Rich HTML on the clipboard is what makes the paste land in Word with
      // its colours intact; the plain-text alternative is the fallback.
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([html.replace(/<[^>]+>/g, '')], { type: 'text/plain' }),
        }),
      ])
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 3000)
  }, [diff])

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-gray-300 bg-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5">
          <Brand />
          <div className="flex gap-1 rounded-lg bg-surface p-1">
            <ModeButton active={mode === 'side-by-side'} onClick={() => setMode('side-by-side')}>
              Side by side
            </ModeButton>
            <ModeButton active={mode === 'merged'} onClick={() => setMode('merged')}>
              Merged
            </ModeButton>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => jump(-1)}
              disabled={changed.length === 0}
              className="rounded border border-gray-400 px-2 py-1 text-sm disabled:opacity-40"
              aria-label="Previous change"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => jump(1)}
              disabled={changed.length === 0}
              className="rounded border border-gray-400 px-2 py-1 text-sm disabled:opacity-40"
              aria-label="Next change"
            >
              ↓
            </button>
            <span className="ml-1 text-xs text-note">{plural(changed.length, 'change')}</span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <Toggle checked={changesOnly} onChange={setChangesOnly}>
              Changes only
            </Toggle>
            <Toggle checked={showFormattingNotes} onChange={setShowFormattingNotes}>
              Formatting notes
            </Toggle>
            <FormattingLegend />
            {mode === 'merged' && (
              <>
                <Toggle checked={!hideDeletions} onChange={(value) => setHideDeletions(!value)}>
                  Deletions
                </Toggle>
                <Toggle checked={!hideAdditions} onChange={(value) => setHideAdditions(!value)}>
                  Additions
                </Toggle>
              </>
            )}

            <button
              type="button"
              onClick={copyTrackedChanges}
              className="rounded-md border border-gray-400 px-3 py-1.5 text-sm font-medium hover:bg-surface"
            >
              {copyState === 'copied'
                ? 'Copied'
                : copyState === 'failed'
                  ? 'Copy blocked'
                  : 'Copy redline'}
            </button>
            <button
              type="button"
              onClick={downloadTrackedOdt}
              disabled={odtState === 'working'}
              className="rounded-md border border-gray-400 px-3 py-1.5 text-sm font-medium hover:bg-surface disabled:opacity-50"
              title="OpenDocument file with native tracked changes, to accept or reject in LibreOffice Writer"
            >
              {odtState === 'working'
                ? 'Preparing…'
                : odtState === 'failed'
                  ? 'Export failed'
                  : 'Download ODT (tracked)'}
            </button>
            <button
              type="button"
              onClick={printPdf}
              className="rounded-md border border-gray-400 px-3 py-1.5 text-sm font-medium hover:bg-surface"
              title="Opens your browser's print dialog — choose “Save as PDF” as the destination"
            >
              {printState === 'failed' ? 'Print blocked' : 'Print / PDF'}
            </button>
            <button
              type="button"
              onClick={() => downloadReport(diff)}
              className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white"
            >
              Download HTML
            </button>
            <button
              type="button"
              onClick={onReset}
              className="text-sm font-medium text-note underline hover:text-ink"
            >
              New comparison
            </button>
          </div>
        </div>
      </header>

      <DiffSummaryBar diff={diff} />

      {changesOnly && visible.length < diff.paragraphs.length && (
        <p className="no-print border-b border-gray-200 bg-surface px-6 py-1.5 text-xs text-note">
          Showing {visible.length} of {diff.paragraphs.length} paragraphs — changes plus one
          paragraph of context either side.
        </p>
      )}

      {mode === 'side-by-side' ? (
        <SideBySideView paragraphs={visible} showFormattingNotes={showFormattingNotes} />
      ) : (
        <MergedView
          paragraphs={visible}
          showFormattingNotes={showFormattingNotes}
          hideDeletions={hideDeletions}
          hideAdditions={hideAdditions}
        />
      )}
    </div>
  )
}
