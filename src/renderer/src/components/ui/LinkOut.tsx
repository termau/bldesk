import React from 'react'
import { ExternalLink } from 'lucide-react'

/**
 * A link to something outside the app, opened in the real browser.
 *
 * A button rather than an anchor: in Electron an `<a href>` would navigate the
 * renderer itself, which has no way back.
 */
export const LinkOut: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <button
    type="button"
    onClick={() => window.bldeskApi?.openExternal?.(href)}
    className="text-fg-link dark:text-[#4db2e0] hover:underline inline-flex items-center gap-0.5"
  >
    {children}
    <ExternalLink className="w-2.5 h-2.5" />
  </button>
)

/** The agreement the create form and Change Plan both require. */
export const TOS_URL = 'https://www.binarylane.com.au/terms-of-service'
export const REFUND_URL = 'https://www.binarylane.com.au/refund-policy'
/** BinaryLane's own control panel, for what the API does not expose. */
export const MPANEL_URL = 'https://home.binarylane.com.au'
