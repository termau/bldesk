import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle, Loader2, Server as ServerIcon } from 'lucide-react'
import { components } from '@shared/api/schema'
import {
  REVIEWED_SERVER_ACTION_TYPES,
  type ProfileAccessMode,
  type ServerOperationClass,
  type ServerSafetyLevel
} from '@shared/binarylane-policy'
import {
  type ActionAwaitingInteraction,
  useActionProceedMutation,
  useActionsAwaitingInteraction
} from '../../api/queries'
import { type BinaryLaneClient } from '../../api/client'
import { useConfirm, type ConfirmRequest } from '../../context/ConfirmContext'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { updateChange } from '../../lib/changelog'
import { Modal } from '../ui/Modal'

type UserInteractionType = components['schemas']['UserInteractionType']
type ServerResponse = components['schemas']['Server']

interface InteractionCopy {
  heading: string
  /** What happened, in the operator's terms. */
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
 * The wording tracks what the OpenAPI interaction names actually establish.
 * In particular, declining is not described as cancelling the parent action,
 * so BLDesk must not make that promise.
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

const REVIEWED_ACTION_TYPES = new Set<string>(REVIEWED_SERVER_ACTION_TYPES)

interface InteractionSafety {
  accessMode: ProfileAccessMode
  serverSafetyLevel: (serverId: unknown) => ServerSafetyLevel
  serverActionBlockReason: (serverId: unknown, operation?: ServerOperationClass) => string | null
}

function serverIdForAction(action: ActionAwaitingInteraction): number | null {
  return Number.isSafeInteger(action.resource_id) && Number(action.resource_id) > 0
    ? Number(action.resource_id)
    : null
}

function operationForAction(action: ActionAwaitingInteraction): ServerOperationClass {
  if (action.type === 'reboot') return 'reboot'
  if (action.type === 'power_cycle') return 'power-cycle'
  return 'mutation'
}

/**
 * Match the privileged broker's action-context checks before offering either
 * answer. The broker resolves the action again under the active credential;
 * this renderer check makes the disabled state clear and immediate.
 */
function interactionAnswerBlockReason(
  action: ActionAwaitingInteraction,
  safety: InteractionSafety,
  clientAvailable: boolean
): string | null {
  if (!clientAvailable) return 'The protected BinaryLane connection is unavailable.'
  if (action.status !== 'in-progress') {
    return 'This action is not currently waiting in a state that can be answered.'
  }
  if (action.resource_type !== 'server') {
    return 'BLDesk cannot verify this question against a specific server.'
  }

  const serverId = serverIdForAction(action)
  if (serverId === null) return 'The server identity for this question cannot be verified safely.'

  const interactionType = action.user_interaction_required.interaction_type
  if (!Object.prototype.hasOwnProperty.call(INTERACTION_COPY, interactionType)) {
    return 'This BinaryLane question type has not been reviewed for an in-app response.'
  }

  const policyReason = safety.serverActionBlockReason(serverId, operationForAction(action))
  if (policyReason) return policyReason

  if (safety.accessMode !== 'guarded') return null

  const level = safety.serverSafetyLevel(serverId)
  if (level === 'maintenance') {
    const isStalledRestart =
      interactionType === 'allow-unclean-power-off' &&
      (action.type === 'reboot' || action.type === 'power_cycle')
    return isStalledRestart
      ? null
      : 'Maintenance can answer only the unclean-power-off question raised by a reboot or power cycle.'
  }

  if (level === 'testable' && !REVIEWED_ACTION_TYPES.has(action.type)) {
    return 'This server action is not in BLDesk’s reviewed action inventory.'
  }

  return null
}

function sameQuestion(left: ActionAwaitingInteraction, right: ActionAwaitingInteraction): boolean {
  return left.id === right.id &&
    left.status === right.status &&
    left.resource_type === right.resource_type &&
    left.resource_id === right.resource_id &&
    left.type === right.type &&
    left.user_interaction_required.interaction_type === right.user_interaction_required.interaction_type
}

function confirmationForAnswer(
  action: ActionAwaitingInteraction,
  serverName: string,
  proceed: boolean
): ConfirmRequest {
  const serverId = serverIdForAction(action)
  const interactionType = action.user_interaction_required.interaction_type
  const target = { kind: 'server' as const, id: serverId ?? undefined, name: serverName }

  if (interactionType === 'allow-unclean-power-off') {
    return proceed
      ? {
          title: 'Permit unclean power off',
          target,
          summary: `Tell BinaryLane it may force the server off so ${operationPhrase(action)} can continue.`,
          severity: 'destructive',
          confirmLabel: 'Force power off',
          notes: [
            'This is equivalent to pulling the power plug. Unwritten data can be lost and the filesystem may need repair.'
          ],
          changes: [{ label: 'Response', from: 'Waiting for an answer', to: 'Permit unclean power off' }]
        }
      : {
          title: 'Decline unclean power off',
          target,
          summary: 'Tell BinaryLane not to force the server off. BLDesk does not assume this cancels the original action.',
          severity: 'normal',
          confirmLabel: 'Send “Do not force”',
          changes: [{ label: 'Response', from: 'Waiting for an answer', to: 'Do not permit unclean power off' }]
        }
  }

  return proceed
    ? {
        title: 'Accept server creation result',
        target,
        summary: 'Tell BinaryLane to assume the server was created successfully despite the failed ping.',
        severity: 'normal',
        confirmLabel: 'Assume it succeeded',
        changes: [{ label: 'Response', from: 'Waiting for an answer', to: 'Assume creation succeeded' }]
      }
    : {
        title: 'Decline server creation result',
        target,
        summary: 'Tell BinaryLane not to assume the server was created successfully after the failed ping.',
        severity: 'normal',
        confirmLabel: 'Send “Do not assume”',
        changes: [{ label: 'Response', from: 'Waiting for an answer', to: 'Do not assume creation succeeded' }]
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
  const confirmAction = useConfirm()
  const { accessMode, serverSafetyLevel, serverActionBlockReason } = useProfileSafety()
  /** A failed answer must not leave its error under the next action's question. */
  const [error, setError] = useState<{ actionId: number; message: string } | null>(null)
  /** Answered or locally deferred actions, hidden until the poll catches up. */
  const [suppressed, setSuppressed] = useState<number[]>([])
  const [handlingAnswer, setHandlingAnswer] = useState(false)

  /**
   * A confirmation can stay open across a query refresh or profile switch.
   * Keep the facts used by the last-moment check current without restarting the
   * user's pending promise.
   */
  const latest = useRef({
    waiting,
    clientAvailable: !!client,
    safety: { accessMode, serverSafetyLevel, serverActionBlockReason }
  })
  latest.current = {
    waiting,
    clientAvailable: !!client,
    safety: { accessMode, serverSafetyLevel, serverActionBlockReason }
  }

  /** Forget suppressions after BinaryLane stops reporting the action as waiting. */
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
  const server = current.resource_type === 'server'
    ? servers.find((item) => item.id === current.resource_id)
    : undefined
  const serverName = server?.name ||
    (serverIdForAction(current) !== null ? `Server #${current.resource_id}` : 'Unknown server')
  const safety = { accessMode, serverSafetyLevel, serverActionBlockReason }
  const blockReason = interactionAnswerBlockReason(current, safety, !!client)

  const suppressCurrent = () => {
    setSuppressed((prev) => prev.includes(current.id) ? prev : [...prev, current.id])
  }

  const answer = async (proceed: boolean) => {
    setError(null)
    const initialBlock = interactionAnswerBlockReason(current, safety, !!client)
    if (initialBlock) {
      setError({ actionId: current.id, message: initialBlock })
      return
    }

    setHandlingAnswer(true)
    let changeId: string | undefined
    try {
      const confirmed = await confirmAction(confirmationForAnswer(current, serverName, proceed))
      if (!confirmed.ok) return
      changeId = confirmed.changeId

      // Recheck the exact action, question, resource and current safety policy
      // immediately before the mutation. The privileged broker checks again.
      const fresh = latest.current.waiting.find((action) => action.id === current.id)
      if (!fresh || !sameQuestion(current, fresh)) {
        const message = 'This BinaryLane question changed or is no longer waiting. Refresh it before answering.'
        await updateChange(changeId, { outcome: 'failed', detail: message })
        setError({ actionId: current.id, message })
        return
      }
      const freshBlock = interactionAnswerBlockReason(
        fresh,
        latest.current.safety,
        latest.current.clientAvailable
      )
      if (freshBlock) {
        await updateChange(changeId, { outcome: 'failed', detail: freshBlock })
        setError({ actionId: current.id, message: freshBlock })
        return
      }

      await proceedMutation.mutateAsync({ actionId: fresh.id, proceed })
      await updateChange(changeId, {
        outcome: 'completed',
        detail: 'BinaryLane accepted this response. The original action may still be running.'
      })
      setSuppressed((prev) => prev.includes(current.id) ? prev : [...prev, current.id])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await updateChange(changeId, { outcome: 'failed', detail: message })
      setError({ actionId: current.id, message })
    } finally {
      setHandlingAnswer(false)
    }
  }

  return (
    <Modal
      title={copy?.heading || 'BinaryLane needs an answer to continue'}
      icon={isDanger ? AlertTriangle : HelpCircle}
      headTone={isDanger ? 'text-red-500' : 'text-[#017cb6]'}
      onClose={suppressCurrent}
      busy={handlingAnswer || proceedMutation.isPending}
      size="md"
      z={60}
      labelledBy="action-interaction-title"
      footer={
        <div className="flex items-center gap-2 px-5 py-4 bg-[#f8f9fa] dark:bg-[#262a2e]">
          <button
            type="button"
            disabled={handlingAnswer || proceedMutation.isPending}
            onClick={suppressCurrent}
            className="px-2 py-1.5 text-xs text-[#495057] dark:text-[#adb5bd] hover:text-[#212529] dark:hover:text-white underline underline-offset-2 disabled:opacity-50 transition"
          >
            Decide later
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={!!blockReason || handlingAnswer || proceedMutation.isPending}
            aria-describedby={blockReason ? 'action-interaction-safety-block' : undefined}
            onClick={() => answer(false)}
            className="px-3 py-1.5 text-xs font-medium rounded border border-[#ced4da] dark:border-[#373b3e] text-[#495057] dark:text-[#ced4da] hover:bg-[#e9ecef] dark:hover:bg-[#343a40] disabled:opacity-50 transition"
          >
            {copy?.declineLabel || 'No'}
          </button>
          <button
            type="button"
            disabled={!!blockReason || handlingAnswer || proceedMutation.isPending}
            aria-describedby={blockReason ? 'action-interaction-safety-block' : undefined}
            onClick={() => answer(true)}
            className={`px-4 py-1.5 text-xs font-medium rounded text-white shadow-sm flex items-center gap-1.5 disabled:opacity-50 transition ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#017cb6] hover:bg-[#016594]'
            }`}
          >
            {(handlingAnswer || proceedMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{copy?.confirmLabel || 'Yes, continue'}</span>
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-4 text-xs">
        <div className="flex items-center gap-2 text-[#495057] dark:text-[#ced4da]">
          <ServerIcon className="w-3.5 h-3.5 text-[#6c757d] flex-shrink-0" />
          <span className="font-semibold">{serverName}</span>
          <span className="text-[#6c757d]">
            · {current.title || current.type} · action #{current.id}
          </span>
        </div>

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

        <p className="text-[11px] text-[#495057] dark:text-[#adb5bd]">
          This action stays paused until it is answered — it will not continue on its own. Closing this prompt chooses “Decide later” and sends nothing.
        </p>

        {outstanding.length > 1 && (
          <p className="text-[11px] text-[#495057] dark:text-[#adb5bd]">
            {outstanding.length - 1} other action{outstanding.length > 2 ? 's are' : ' is'} also waiting.
          </p>
        )}

        {blockReason && (
          <div
            id="action-interaction-safety-block"
            className="bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-300 rounded p-2.5 flex items-start gap-2"
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <span className="font-semibold">Response blocked by local safety.</span> {blockReason}{' '}
              The BinaryLane action remains paused.
            </span>
          </div>
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
