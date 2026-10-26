import { DocumentParseError } from '../types/document.ts'

/**
 * Error messages name the file, say what is wrong in plain language, and offer
 * a way forward. Spec §6.3.
 */
export function ErrorNotice({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  const message =
    error instanceof Error ? error.message : 'Something went wrong while comparing the documents.'
  const hint =
    error instanceof DocumentParseError
      ? error.hint
      : 'If this keeps happening, try opening the document in Word or LibreOffice and saving a fresh copy.'

  return (
    <div
      role="alert"
      className="rounded-lg border border-removed/30 bg-removed-bg/50 px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-removed">{message}</p>
          {hint && <p className="mt-1 text-ink/80">{hint}</p>}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium text-note underline hover:text-ink"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}
