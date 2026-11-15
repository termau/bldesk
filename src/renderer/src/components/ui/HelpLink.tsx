import { CircleHelp } from 'lucide-react'
import { openHelp } from '../../lib/helpNavigation'

export function HelpLink({ slug, heading, onOpen }: { slug: string; heading?: string; onOpen?: () => void }) {
  return <button type="button" title="What this page does" aria-label="What this page does"
    onClick={() => { onOpen?.(); const [page, anchor] = slug.split('#'); openHelp({ slug: page, heading: heading ?? anchor }) }}
    className="inline-flex shrink-0 items-center justify-center p-1 rounded text-fg-muted hover:text-fg-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#017cb6] titlebar-no-drag">
    <CircleHelp className="w-4 h-4" />
  </button>
}
