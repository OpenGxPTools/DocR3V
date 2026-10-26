/**
 * States plainly which formatting attributes the comparison checks.
 *
 * A reviewer signing a GMP change record needs to know the boundary of the
 * tool's evidence, not just what it happened to report: "no formatting changes
 * found" means nothing unless you know what was looked for. Listing the tracked
 * attributes alongside an explicit note of what is *not* checked keeps the
 * reviewer from reading absence as assurance.
 *
 * The list is generated from FORMATTING_KEYS and the same labels the notes use,
 * so it cannot drift from what the engine actually detects.
 */

import { useState } from 'react'
import { FORMATTING_LABELS } from '../services/formatting.ts'
import { FORMATTING_KEYS } from '../types/document.ts'

/** Rendered as the attribute's own formatting, so the list demonstrates itself. */
const SAMPLE_CLASS: Partial<Record<(typeof FORMATTING_KEYS)[number], string>> = {
  bold: 'font-bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'line-through',
  allCaps: 'uppercase',
  smallCaps: 'small-caps',
}

export function FormattingLegend() {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded border border-format/40 bg-format-bg px-2 py-1 text-xs font-medium text-format hover:border-format"
      >
        ◇ What is checked
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-gray-300 bg-white p-3 text-xs shadow-lg">
          <p className="font-semibold text-ink">Formatting changes this tool detects</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-ink">
            {FORMATTING_KEYS.map((key) => (
              <li key={key} className="flex gap-1.5">
                <span aria-hidden="true" className="text-format">
                  ◇
                </span>
                <span className={SAMPLE_CLASS[key]}>
                  {key === 'superscript' ? (
                    <>
                      super<sup>script</sup>
                    </>
                  ) : key === 'subscript' ? (
                    <>
                      sub<sub>script</sub>
                    </>
                  ) : (
                    FORMATTING_LABELS[key]
                  )}
                </span>
              </li>
            ))}
            <li className="flex gap-1.5">
              <span aria-hidden="true" className="text-format">
                ◇
              </span>
              <span>paragraph style</span>
            </li>
          </ul>

          <p className="mt-3 border-t border-gray-200 pt-2 text-note">
            <span className="font-semibold">Not checked:</span> font, size, colour, highlighting,
            alignment, spacing, table layout. A change to any of these is not reported, so no
            formatting note does not mean no formatting change.
          </p>
        </div>
      )}
    </div>
  )
}
