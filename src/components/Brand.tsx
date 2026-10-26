/**
 * DocR3V identity.
 *
 * The mark is a two-column tile: the left column is the original, the right the
 * revision, with one line struck in red and one added in green. It says what the
 * tool does at 16px, which a lettermark would not, and it is the same shape as
 * the side-by-side view the user spends their time in.
 *
 * The wordmark stays monochrome deliberately. Red, green and violet all carry
 * specific meanings in this app — deleted, added, formatting note — and spending
 * them on decoration would weaken the only colour vocabulary the reviewer has to
 * trust. The mark is the one place the diff colours appear without meaning
 * anything, and it is small and fixed enough not to compete.
 */

import { APP_NAME } from '../version.ts'

/** Colours are literal rather than themed: the mark must not restyle with the UI. */
const TILE = '#1F2937'
const PAPER = '#FFFFFF'
const ADDED = '#4ADE80'
const REMOVED = '#F87171'

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={`${APP_NAME} logo`}
      className="shrink-0"
    >
      <rect width="32" height="32" rx="7" fill={TILE} />
      <line x1="16" y1="7" x2="16" y2="25" stroke={PAPER} strokeOpacity="0.22" strokeWidth="1" />

      {/* Original column: three unremarkable lines of text. */}
      <g fill={PAPER} fillOpacity="0.5">
        <rect x="6" y="10" width="7" height="2" rx="1" />
        <rect x="6" y="15" width="7" height="2" rx="1" />
        <rect x="6" y="20" width="5" height="2" rx="1" />
      </g>

      {/* Revision: one line unchanged, one removed, one added. */}
      <rect x="19" y="10" width="7" height="2" rx="1" fill={PAPER} fillOpacity="0.5" />
      <rect x="19" y="15" width="7" height="2" rx="1" fill={REMOVED} />
      <rect x="19" y="20" width="5" height="2" rx="1" fill={ADDED} />
    </svg>
  )
}

/**
 * `size` follows the two placements the app has: the upload screen, where the
 * name is the page's title, and the results toolbar, where it must not compete
 * with the controls beside it.
 */
export function Brand({ size = 'small' }: { size?: 'small' | 'large' }) {
  const large = size === 'large'

  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={large ? 40 : 26} />
      <span
        className={`font-semibold tracking-tight text-ink ${large ? 'text-2xl' : 'text-base'}`}
      >
        Doc<span className="font-bold">R3V</span>
      </span>
    </span>
  )
}
