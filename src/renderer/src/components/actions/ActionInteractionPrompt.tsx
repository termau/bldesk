import { useEffect, useState } from 'react'
import { AlertTriangle, HelpCircle, Loader2, Server as ServerIcon } from 'lucide-react'
import { components } from '@shared/api/schema'
import {
  ActionAwaitingInteraction,
  useActionProceedMutation,
  useActionsAwaitingInteraction
} from '../../api/queries'
import { BinaryLaneClient } from '../../api/client'
import { Modal } from '../ui/Modal'

type UserInteractionType = components['schemas']['UserInteractionType']
type ServerResponse = components['schemas']['Server']

interface InteractionCopy {
  heading: string
  /**
   * What happened, in the operator's terms. Takes the action because the same
   * interaction can be raised by more than one request: a stalled clean
   * shutdown is equally reachable from Shutdown, Reboot or Power Cycle, and
   * "would not shut down" reads wrong under a title that says "Reboot".
   */
  explanation: (action: ActionAwaitingInteraction) => string
  /** The exact question being asked, phrased as the API documents it. */
  question: string
  confirmLabel: string
  declineLabel: string
  /** `danger` gets the red treatment — reserved for answers that can lose data. */
  tone: 'danger' | 'normal'
}

/** Lower-cased operation name for prose, e.g. "reboot". Falls back to neutral wording. */
function operationPhrase(action: ActionAwaitingInteraction): string {
  const label = (action.title || action.type || '').trim()
  return label ? `the ${label.toLowerCase()}` : 'this operation'
}

/**
 * Plain-language copy for each interaction type.
 *
 * The wording of `question` deliberately tracks what the OpenAPI enum documents
 * `proceed: true` to mean, and nothing further. The spec says only "see the
 * documentation for each type of interaction for the effect of providing 'true'
 * or 'false'", and that per-interaction documentation is not in the spec — so
 * this UI states what agreeing does and does not claim what BinaryLane does on
 * a decline. Better a slightly bare button than a confident wrong promise about
 * someone's server.
 */
const INTERACTION_COPY: Record<UserInteractionType, InteractionCopy> = {
  'continue-after-ping-failure': {
    heading: 'Server did not answer after it was created',
    explanation: () =>
      'BinaryLane finished creating this server but got no reply when it pinged it. Often the server is up and simply is not answering pings — a firewall rule, or an image that blocks ICMP. It can also mean the server did not boot.',
    question: 'Assume the server was created successfully despite the failed ping?',
    confirmLabel: 'Assume it succeeded',
    declineLabel: 'Do not assume',
    tone: 'normal'
  },
  'allow-unclean-power-off': {
    heading: 'Server would not shut down cleanly',
    explanation: (action) =>
      `BinaryLane asked this server to shut down as part of ${operationPhrase(action)} and it did not comply. An unclean power off is the equivalent of pulling the plug: anything not yet written to disk is lost, and the filesystem may need repair on the next boot.`,
    question: 'Permit an unclean power off?',
    confirmLabel: 'Force power off',
    declineLabel: 'Do not force it',
    tone: 'danger'
  }
}

interface ActionInteractionPromptProps {
  client: BinaryLaneClient | null
  profileId?: string
  servers?: ServerResponse[]
}

export function ActionInteractionPrompt({ client, profileId, servers = [] }: ActionInteractionPromptProps) {
  const { data: waiting = [] } = useActionsAwaitingInteraction(client, profileId)
  const proceedMutation = useActionProceedMutation(client)
  /**
   * Scoped to the action it came from: a failed answer must not leave its error
   * sitting under the next action's question once the poll moves on.
   */
  const [error, setError] = useState<{ actionId: number; message: string } | null>(null)
  /**
   * Actions not to show right now — either just answered (hidden until the poll
   * catches up, so the modal cannot flash back) or deferred by the user.
   */
  const [suppressed, setSuppressed] = useState<number[]>([])

  /**
   * Forget suppressions once BinaryLane stops reporting the action as waiting.
   * Keeps the list from growing for the life of the session, and means a fresh
   * question raised later on the same action is not silently swallowed.
   */
  useEffect(() => {
    setSuppressed((prev) => {
      const next = prev.filter((id) => waiting.some((action) => action.id === id))
      return next.length === prev.length ? prev : next
    })
  }, [waiting])

  const outstanding = waiting.filter((action) => !suppressed.includes(action.id))
  const current: ActionAwaitingInteraction | undefined = outstanding[0]

  if (!current) return null

  const copy = INTERACTION_COPY[current.user_interaction_required.interaction_type]
  const isDanger = copy?.tone === 'danger'

  const server =
    current.resource_type === 'server'
      ? servers.find((s) => s.id === current.resource_id)
      : undefined

  const answer = async (proceed: boolean) => {
    setError(null)
    try {
      await proceedMutation.mutateAsync({ actionId: current.id, proceed })
      setSuppressed((prev) => [...prev, current.id])
    } catch (err) {
      setError({ actionId: current.id, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    /* Both answers are submissions, so neither is a safe close: the dialog is given no onClose, so it has no close button
       and Escape and the backdrop do nothing. The watch is account-wide, though, so an action left paused in an earlier
       session shows up here on launch; without a way to defer, the app would be unusable until someone made a data-loss
       decision about a server they may not have been thinking about. "Decide later" answers nothing and lasts only for
       this session. */
    <Modal
      title={copy?.heading || 'BinaryLane needs an answer to continue'}
      icon={isDanger ? AlertTriangle : HelpCircle}
      headTone={isDanger ? 'text-red-500' : undefined}
      footer={
        // Wraps rather than overflowing the panel when a large system text size makes the three buttons too wide for one line.
        <div className="flex flex-wrap items-center justify-end gap-2 p-4">
          <button
            type="button"
            disabled={proceedMutation.isPending}
            onClick={() => setSuppressed((prev) => [...prev, current.id])}
            className="mr-auto px-2 py-1.5 text-xs text-[#495057] dark:text-[#adb5bd] hover:text-[#212529] dark:hover:text-white underline underline-offset-2 disabled:opacity-50 transition"
          >
            Decide later
          </button>
          <button
            type="button"
            disabled={proceedMutation.isPending}
            onClick={() => answer(false)}
            className="px-3 py-1.5 text-xs font-medium rounded border border-[#ced4da] dark:border-[#373b3e] text-[#495057] dark:text-[#ced4da] hover:bg-[#e9ecef] dark:hover:bg-[#343a40] disabled:opacity-50 transition"
          >
            {copy?.declineLabel || 'No'}
          </button>
          <button
            type="button"
            disabled={proceedMutation.isPending}
            onClick={() => answer(true)}
            className={`px-4 py-1.5 text-xs font-medium rounded text-white shadow-sm flex items-center gap-1.5 disabled:opacity-50 transition ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#017cb6] hover:bg-[#016594]'
            }`}
          >
            {proceedMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{copy?.confirmLabel || 'Yes, continue'}</span>
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-4 text-xs">
        {/* Which machine this is about */}
        <div className="flex items-center gap-2 text-[#495057] dark:text-[#ced4da]">
          <ServerIcon className="w-3.5 h-3.5 text-fg-muted flex-shrink-0" />
          <span className="font-semibold">
            {server?.name || (current.resource_id ? `Resource #${current.resource_id}` : 'Your account')}
          </span>
          <span className="text-fg-muted">
            · {current.title} · action #{current.id}
          </span>
        </div>

        {/* BinaryLane's own description of this specific action */}
        {current.reason && (
          <div className="bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded p-3 text-[#212529] dark:text-white">
            {current.reason}
          </div>
        )}

        <p className="text-[#495057] dark:text-[#ced4da] leading-relaxed">
          {copy
            ? copy.explanation(current)
            : 'This action is paused until you answer. BLDesk does not recognise this interaction type, so please check the BinaryLane control panel before answering.'}
        </p>

        <p className="font-semibold text-[#212529] dark:text-white">
          {copy?.question || 'Proceed with this action?'}
        </p>

        {/* Deliberately not the app's usual #6c757d small-print grey: that is
            2.8:1 on this panel, and the fact that nothing moves until someone
            answers is the whole reason the modal is interrupting anyone. */}
        <p className="text-[0.6875rem] text-[#495057] dark:text-[#adb5bd]">
          This action stays paused until it is answered — it will not continue on its own.
        </p>

        {outstanding.length > 1 && (
          <p className="text-[0.6875rem] text-[#495057] dark:text-[#adb5bd]">
            {outstanding.length - 1} other action{outstanding.length > 2 ? 's are' : ' is'} also waiting.
          </p>
        )}

        {error?.actionId === current.id && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-500 rounded p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error.message}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
