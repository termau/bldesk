import React from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { isCapacityBlock, type PlanBlock } from '../../lib/serverPricing'

/**
 * How the create form and Change Plan mark plans that can't be chosen, the way
 * the web panel does: the row's radio becomes a crossed-out circle, and every
 * capacity reason collapses into the panel's one line, word for word, whatever
 * else is listed with it (a Windows image's memory minimum used to replace it
 * with "Out of stock in this region.").
 */

export const CAPACITY_NOTE = 'We currently do not have resources available to provision a server on these plans.'

/** The crossed-out circle shown in place of a blocked plan's radio. */
export const BlockedMark: React.FC = () => (
  <XCircle
    aria-hidden
    className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 fill-[#adb5bd] dark:fill-[#6c757d] text-white dark:text-[#2b3035]"
  />
)

/** A retired current plan while it is still what the server runs: ticked, but greyed. */
export const CurrentMark: React.FC = () => (
  <CheckCircle2 aria-hidden className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-[#adb5bd] dark:text-[#6c757d]" />
)

export const PlanBlockNotes: React.FC<{ blocks: PlanBlock[] }> = ({ blocks }) => {
  if (!blocks.length) return null
  const capacity = blocks.some((b) => isCapacityBlock(b))
  const other = blocks.filter((b) => !isCapacityBlock(b))
  return (
    <div className="px-3 py-2 border-t border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-[11px] text-[#6c757d] dark:text-[#adb5bd] space-y-1">
      {other.map((b) => (
        <div key={b.message} className="flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-px" />
          <span>{b.message}</span>
        </div>
      ))}
      {capacity && (
        <div className="flex items-start gap-2">
          <BlockedMark />
          <span>{CAPACITY_NOTE}</span>
        </div>
      )}
    </div>
  )
}
