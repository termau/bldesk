import React from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * What the three filters beside the Servers search (Regions, Status, Tags) share, so they read as one set: height,
 * padding, font, border, radius and colours. The right padding leaves room for the chevron of `FilterShell`.
 * The height is a minimum, not fixed: where the system text size enlarges the text but not the box (Android WebView
 * before 146), a fixed height cut "All Regions" in half.
 */
export const FILTER_CONTROL =
  'min-h-9 pl-3 pr-[34px] py-1.5 text-xs cursor-pointer bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-[#212529] dark:text-[#f8f9fa] rounded focus:outline-none focus:border-[#017cb6]'

/**
 * One control of the filter row with the chevron all three share. The chevron is drawn here, over the right edge
 * of the control and out of the way of clicks, so a `<select>` (with its own arrow switched off) and a button
 * look the same on every platform.
 */
export const FilterShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="relative inline-flex">
    {children}
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-muted dark:text-slate-400" />
  </span>
)
