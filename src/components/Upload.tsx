/**
 * File selection. Spec §5.1 and §6.1 step 1.
 *
 * Two drop targets rather than one, because "original" and "revised" is a
 * distinction the app cannot guess and getting it backwards inverts every
 * addition and deletion in the report.
 */

import { useCallback, useId, useRef, useState } from 'react'
import { Brand } from './Brand.tsx'
import { ErrorNotice } from './ErrorNotice.tsx'
import { formatBytes, MAX_FILE_BYTES, validateFile } from '../services/documentParser.ts'
import { DocumentParseError } from '../types/document.ts'

export interface Selection {
  original: File
  revised: File
}

const ACCEPT = '.odt,.docx,.md,.markdown,.txt'

function FileSlot({
  label,
  description,
  file,
  onPick,
}: {
  label: string
  description: string
  file: File | undefined
  onPick: (file: File) => void
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const dropped = event.dataTransfer.files[0]
      if (dropped) onPick(dropped)
    },
    [onPick],
  )

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-lg border-2 border-dashed p-5 transition-colors ${
        dragging ? 'border-ink bg-surface' : file ? 'border-added/50 bg-added-bg/30' : 'border-gray-300'
      }`}
    >
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {label}
      </label>
      <p className="mt-0.5 text-xs text-note">{description}</p>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) onPick(picked)
          // Reset so re-picking the same file still fires a change event.
          event.target.value = ''
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-3 rounded-md border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium hover:bg-surface focus:outline-2 focus:outline-offset-2 focus:outline-ink"
      >
        {file ? 'Choose a different file' : 'Choose file'}
      </button>

      <p className="mt-2 truncate text-sm" title={file?.name}>
        {file ? (
          <>
            <span className="font-medium">{file.name}</span>{' '}
            <span className="text-note">({formatBytes(file.size)})</span>
          </>
        ) : (
          <span className="text-note">or drag a file here</span>
        )}
      </p>
    </div>
  )
}

interface Props {
  onCompare: (selection: Selection) => void
  busy: boolean
  error: unknown
  onClearError: () => void
}

export function Upload({ onCompare, busy, error, onClearError }: Props) {
  const [original, setOriginal] = useState<File>()
  const [revised, setRevised] = useState<File>()
  const [localError, setLocalError] = useState<unknown>()

  // Validate on selection rather than on compare, so an unsupported file is
  // reported next to the slot that caused it instead of after a long wait.
  const pick = (setter: (file: File) => void) => (file: File) => {
    try {
      validateFile(file)
      setLocalError(undefined)
      onClearError()
      setter(file)
    } catch (problem) {
      setLocalError(problem instanceof DocumentParseError ? problem : new DocumentParseError(String(problem)))
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Brand size="large" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Compare two documents</h1>
      <p className="mt-2 text-sm text-note">
        Word-by-word comparison for document review. Both files are read and compared on this
        machine — nothing is uploaded anywhere.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <FileSlot
          label="Original"
          description="The version you are comparing against"
          file={original}
          onPick={pick(setOriginal)}
        />
        <FileSlot
          label="Revised"
          description="The version with the changes in it"
          file={revised}
          onPick={pick(setRevised)}
        />
      </div>

      {Boolean(localError ?? error) && (
        <div className="mt-4">
          <ErrorNotice
            error={localError ?? error}
            onDismiss={() => {
              setLocalError(undefined)
              onClearError()
            }}
          />
        </div>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          disabled={!original || !revised || busy}
          onClick={() => original && revised && onCompare({ original, revised })}
          className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
        >
          {busy ? 'Comparing…' : 'Compare'}
        </button>
        {!busy && (!original || !revised) && (
          <span className="text-sm text-note">Choose both files to continue.</span>
        )}
      </div>

      <p className="mt-8 border-t border-gray-200 pt-4 text-xs text-note">
        Supported formats: Word (.docx), OpenDocument Text (.odt), Markdown (.md), plain text
        (.txt). Maximum {formatBytes(MAX_FILE_BYTES)} per file. PDF is not supported — its text
        cannot be extracted reliably enough for a word-level comparison, so save the document as
        DOCX or ODT first.
      </p>
    </div>
  )
}
