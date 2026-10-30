import { HelpLink } from '../ui/HelpLink'
import React, { useEffect, useMemo, useState, useRef } from 'react'
import {
  Shield,
  Plus,
  AlertCircle,
  Loader2,
  Server,
  Unlock,
  Download,
  Upload,
  Share2,
  FileJson,
  Grid3x3,
  RefreshCw
} from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { apiFailure, fetchFirewallRules, readFirewallRules, useFirewallRules, useShowFirewallRules, useUpdateFirewallRulesMutation } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { updateChange, type ChangeTarget } from '../../lib/changelog'
import { diffLines, describeFirewallRule } from '../../lib/diff'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { insertRule, isIpv4OrRange, readImportedRules, ruleCount, ruleLimitNote, rulesAllowed, toRuleRequest } from '../../lib/firewallRules'
import { mpanelText } from '../../lib/firewallMpanel'
import { addressChoicesFor, PORT_CHOICES, presetRule, withChoice, type PresetName } from '../../lib/firewallPicks'
import type { FwRule } from '../../lib/firewallMatrix'
import { describePending, draftApplies, draftFromRules, hasPendingChanges, pendingChanges, rulesToWrite, rowsWithProblems, sameRules, splitList, type DraftRow } from '../../lib/firewallDraft'
import { Modal } from '../ui/Modal'
import { FirewallMatrix } from './FirewallMatrix'
import { FirewallRulesEditor, lines } from './FirewallRulesEditor'
import { PickMenu } from './PickMenu'
import { notifyFailure } from '../../lib/failures'
import { saveTextFile } from '../../lib/saveFile'

interface FirewallManagerProps {
  client: BinaryLaneClient | null
  initialServerId?: number | null
  profileId?: string
  /**
   * The app's server list (cached, power-annotated). The tab must not run its
   * own `useServers`: a second observer on the same cache key replaces the
   * query's function with its own closure, and one with a null client returns
   * [] — which emptied every view for the whole poll interval.
   */
  servers: any[]
}

/** A server's rules as they were when its edits were started, and the rows being edited. */
interface Draft {
  base: FwRule[]
  rows: DraftRow[]
}

/**
 * The edits that have not been saved, by server, kept for the session so that leaving the screen or choosing another server
 * does not lose them. Nothing in here is ever written by itself: it is only what the rows show until Save changes.
 */
let unsavedDrafts: Record<number, Draft> = {}

/**
 * The edits of a save BinaryLane has accepted and not yet applied, by the id of the action that carries them. If that action then
 * fails the rules are as they were, so the edits are put back on screen instead of being lost with the table going back to the old rules.
 */
let sentDrafts: Record<number, { serverId: number; draft: Draft }> = {}

export const FirewallManager: React.FC<FirewallManagerProps> = ({ client, initialServerId, profileId, servers }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<'server' | 'matrix'>('server')

  const [selectedServerId, setSelectedServerId] = useState<number | null>(
    initialServerId || (servers.length > 0 ? servers[0].id : null)
  )

  const activeServerId = selectedServerId || (servers.length > 0 ? servers[0].id : null)
  const activeServer = servers.find((s) => s.id === activeServerId)

  const firewallQuery = useFirewallRules(client, activeServerId)
  const updateFirewall = useUpdateFirewallRulesMutation(client, activeServerId)
  const showFirewallRules = useShowFirewallRules(activeServerId)

  // Add Rule Form States
  const [isAdding, setIsAdding] = useState(false)
  const [ruleAction, setRuleAction] = useState<'accept' | 'drop'>('accept')
  const [ruleProtocol, setRuleProtocol] = useState<'tcp' | 'udp' | 'icmp' | 'all'>('tcp')
  const [rulePorts, setRulePorts] = useState('22')
  // Source and Destination start empty: an empty one is written as the any-address (handleAddRule), and a choice from a list is added to what a cell holds.
  const [ruleSource, setRuleSource] = useState('')
  const [ruleDestination, setRuleDestination] = useState('')
  const [ruleDescription, setRuleDescription] = useState('Allow SSH')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // A save is confirmed and then written; a second press in between would be built from the same list.
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => unsavedDrafts)
  const setDraftFor = (serverId: number, draft: Draft | null) => {
    const next = { ...unsavedDrafts }
    if (draft) next[serverId] = draft
    else delete next[serverId]
    unsavedDrafts = next
    setDrafts(next)
  }

  // Import / Export States
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importJsonText, setImportJsonText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  // Whether the Save as dialog is open, so a second tap on Export cannot open another.
  const [exporting, setExporting] = useState(false)

  // Clone to Server States
  const [isCloneOpen, setIsCloneOpen] = useState(false)
  const [targetServerId, setTargetServerId] = useState<number | null>(null)
  const [isCloning, setIsCloning] = useState(false)
  // Whether the dialog is still open, for a read that finishes after it was cancelled.
  const cloneOpenRef = useRef(false)
  const openClone = () => {
    cloneOpenRef.current = true
    setCloneError(null)
    setIsCloneOpen(true)
  }
  const closeClone = () => {
    cloneOpenRef.current = false
    setIsCloneOpen(false)
  }
  const [cloneError, setCloneError] = useState<string | null>(null)

  const currentRules: FwRule[] = firewallQuery.data || []
  // A server may have 100 rules, or the number it already has if that is more (rulesAllowed): with that many, one more is over.
  const atRuleLimit = currentRules.length + 1 > rulesAllowed(currentRules.length)
  const limitNote = ruleLimitNote(currentRules.length)
  const addressPicks = useMemo(() => addressChoicesFor(activeServer, servers), [activeServer, servers])
  const confirmAction = useConfirm()
  const { track, tracked } = useTrackedActions()
  // A write is applied when its action completes, not when it is queued, so until then the list on screen is the one from
  // before it. An edit built from that list would write the old rules back over the change.
  const writePending = tracked.some(
    (t) =>
      t.actionType === 'change_advanced_firewall_rules' &&
      t.resourceId === activeServerId &&
      (t.state === 'running' || t.state === 'awaiting-interaction' || t.state === 'blocked-by-invoice')
  )
  // The edits not yet saved for this server, if any. Until the first edit the rows are just the saved rules.
  const held = activeServerId != null ? drafts[activeServerId] : undefined
  // A draft is kept while it has changes, and also while it only holds what was typed against these rules: a line break or a trailing space
  // says nothing new, but the cell must not take it back as it is typed.
  const draft = held && draftApplies(held, currentRules) ? held : undefined
  const savedRows = useMemo(() => draftFromRules(currentRules), [firewallQuery.data])
  const rows = draft?.rows ?? savedRows
  const pending = !!draft && hasPendingChanges(draft.rows)
  const badRows = draft ? rowsWithProblems(draft.rows) : 0
  // The server's rules were read again after the edits were started, and they now say something else: what the edits were
  // made against is gone, and writing them would put the old rules back over the change.
  const stale = !!draft && firewallQuery.isSuccess && !firewallQuery.isFetching && !sameRules(draft.base, currentRules)
  const hasEdits = (serverId: number) => !!drafts[serverId] && hasPendingChanges(drafts[serverId].rows)
  // Every save writes the whole list back, so edits are only offered while the
  // last read of this server's rules succeeded, and no write of its own is still being applied.
  // A failed read is not "no rules".
  // Also not while the list is being read again, while one of this tab's own writes is going out, or while edits are waiting to be saved: Add Rule, Import,
  // Clone and Disable Firewall would each write a list built without them.
  const canEdit = firewallQuery.isSuccess && !firewallQuery.isFetching && !writePending && !updateFirewall.isPending && !pending && !saving
  // The cells of the rows: a read that is still going does not stop typing, but a write in flight, or edits made against rules that have changed, do.
  const rowsEditable = firewallQuery.isSuccess && !writePending && !updateFirewall.isPending && !saving && !stale
  const canSave = pending && !stale && badRows === 0 && firewallQuery.isSuccess && !firewallQuery.isFetching && !writePending && !updateFirewall.isPending && !saving

  const fwTarget = (): ChangeTarget => ({ kind: 'server', id: activeServerId ?? undefined, name: activeServer?.name || String(activeServerId) })
  /** Run a rule-list write, hand the action to the tracker, and keep the change log honest. */
  const finishFirewall = async (changeId: string | undefined, write: Promise<any>) => {
    try {
      const action = await write
      if (action) track(action, 'Firewall rules', activeServer?.name, changeId)
      else void updateChange(changeId, { outcome: 'completed' })
      return action
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err?.message || String(err) })
      throw err
    }
  }
  const applyPreset = (preset: PresetName) => {
    const rule = presetRule(preset, activeServer)
    setRuleAction(rule.action)
    setRuleProtocol(rule.protocol)
    setRulePorts(rule.ports)
    setRuleSource(rule.source)
    setRuleDestination(rule.destination)
    setRuleDescription(rule.description)
  }

  // Handle Adding Rule
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!activeServerId || !canEdit) return
    if (atRuleLimit) {
      setErrorMsg(limitNote)
      return
    }

    // One address or port to a line; commas and spaces separate them as well.
    const newRule: FwRule = toRuleRequest({
      action: ruleAction,
      protocol: ruleProtocol,
      source_addresses: splitList(ruleSource),
      destination_addresses: splitList(ruleDestination),
      description: ruleDescription.trim() || undefined
    })

    if (ruleProtocol === 'tcp' || ruleProtocol === 'udp') {
      const ports = splitList(rulePorts)
      // "," or " " has text but names no port, and a rule with no ports matches all of them.
      if (ports.length === 0) {
        setErrorMsg('Destination port(s) are required for TCP/UDP rules.')
        return
      }
      newRule.destination_ports = ports
    }

    if (newRule.source_addresses.length === 0) {
      newRule.source_addresses = ['0.0.0.0/0']
    }
    if (!newRule.source_addresses.every(isIpv4OrRange)) {
      setErrorMsg('Source must be IPv4 addresses or ranges, such as 192.0.2.1 or 192.0.2.0/24.')
      return
    }
    if (!newRule.destination_addresses.every(isIpv4OrRange)) {
      setErrorMsg('Destination must be IPv4 addresses or ranges, such as 192.0.2.1 or 192.0.2.0/24.')
      return
    }

    // Rules are evaluated first to last: a catch-all drop goes last, anything else goes ahead of it so that it can match.
    const updatedList = insertRule(currentRules, newRule)

    const c = await confirmAction({
      title: 'Add firewall rule',
      target: fwTarget(),
      summary: `Adds "${newRule.description || ruleAction}" and writes the full rule list back to the server.`,
      diff: diffLines(currentRules.map(describeFirewallRule), updatedList.map(describeFirewallRule))
    })
    if (!c.ok) return

    try {
      await finishFirewall(c.changeId, updateFirewall.mutateAsync(updatedList))
      setIsAdding(false)
      setRuleDescription('')
      window.bldeskApi?.sendNotification?.({
        title: 'Firewall Updated',
        body: `Added rule "${newRule.description || ruleAction}" to server #${activeServerId}.`
      })
    } catch (err: any) {
      setErrorMsg(`Failed to save rule: ${err.message}`)
    }
  }

  // The rows changed in the table. Back to what the server has means nothing is pending, but the cells keep what was typed, so a separator
  // typed on the way to the next value (a line break, a space) is not taken back.
  const editRows = (next: DraftRow[]) => {
    if (activeServerId == null) return
    setDraftFor(activeServerId, { base: draft?.base ?? currentRules, rows: next })
  }

  const discardDraft = () => {
    if (activeServerId != null) setDraftFor(activeServerId, null)
  }

  // Read the server's rules now and say whether they are still the ones the edits began from. What is on screen can be old: nothing reads
  // them again by itself, so a change made from another client, or another app, is not in it. Saving writes the whole list, and would put
  // the old rules back over that change. When the rules cannot be read, or have moved, nothing is sent, the reason is shown, and the edits
  // stay as they are.
  const rulesUnchanged = async (serverId: number, base: FwRule[], moment: string): Promise<FwRule[] | null> => {
    let fresh: FwRule[]
    try {
      fresh = await fetchFirewallRules(client!, serverId)
    } catch (err: any) {
      notifyFailure("Couldn't save the firewall changes", err, {
        note: `Saving writes the whole list back, so the server's current rules are read ${moment}, and they could not be read. Nothing was sent, and your changes are still here.`
      })
      return null
    }
    if (!sameRules(base, fresh)) {
      // Showing them marks the edits as made against rules that have changed, which is what the bar then says.
      await showFirewallRules(fresh)
      notifyFailure("Couldn't save the firewall changes", "The server's rules changed after you started editing.", {
        note: 'Nothing was sent, and your changes are still here. Discard them to load the current rules, then make them again.'
      })
      return null
    }
    return fresh
  }

  // Save the edits. Nothing has been sent until here: the whole list is written back after one confirmation that shows it as
  // it will be, and one History entry records it. The server's rules are read before the confirmation, so it shows the list that
  // will be replaced, and again once it is confirmed, because a change can be made while it is open. A read just before the write
  // narrows the window; it is not an atomic check, which the API does not offer.
  const handleSaveDraft = async () => {
    if (!client || !activeServerId || !draft || !canSave) return
    setSaving(true)
    try {
      const serverId = activeServerId
      const base = draft.base
      const after = rulesToWrite(draft.rows)
      const counts = pendingChanges(draft.rows)
      // Saving with every rule removed leaves no rules, which is Disable firewall, and it is confirmed as strictly.
      const leavesNone = after.length === 0
      const name = activeServer?.name || String(activeServerId)
      const before = await rulesUnchanged(serverId, base, 'before it is confirmed')
      if (!before) return
      const c = await confirmAction({
        title: 'Save firewall rule changes',
        target: fwTarget(),
        summary: leavesNone
          ? `Removes every rule. With no rules, BinaryLane's external firewall allows all inbound traffic to ${name}.`
          : `${describePending(counts)}. Writes the whole rule list back to the server.`,
        severity: leavesNone ? 'irreversible' : counts.removed > 0 ? 'destructive' : 'normal',
        helpSlug: leavesNone ? 'firewall#disable-firewall' : 'firewall#edit-reorder-and-remove-rules',
        notes: leavesNone ? ['Export the rules first if you may want them back — there is no undo on the BinaryLane side.'] : undefined,
        diff: diffLines(before.map(describeFirewallRule), after.map(describeFirewallRule)),
        confirmLabel: 'Save changes'
      })
      if (!c.ok) return
      if (!(await rulesUnchanged(serverId, base, 'again once it is confirmed'))) {
        void updateChange(c.changeId, { outcome: 'failed', detail: "Not sent: the server's rules could not be confirmed unchanged since the edits began." })
        return
      }
      try {
        const action = await finishFirewall(c.changeId, updateFirewall.mutateAsync(after))
        // Accepted is not applied: if the action then fails, the edits come back (see the effect on the tracked actions).
        if (action?.id != null) sentDrafts = { ...sentDrafts, [action.id]: { serverId, draft } }
        // The write lands a few seconds from now; until then a read would show the edits undone.
        await showFirewallRules(after)
        setDraftFor(serverId, null)
        window.bldeskApi?.sendNotification?.({
          title: 'Firewall Updated',
          body: `Saved the rule changes on ${name}.`
        })
      } catch (err: any) {
        // The edits stay on screen, so they can be corrected or tried again.
        notifyFailure("Couldn't save the firewall changes", err)
      }
    } finally {
      setSaving(false)
    }
  }

  // A save that BinaryLane accepted and then failed to apply left the rules as they were: the edits come back as unsaved changes, so a
  // failure that happens after the table has moved on costs nothing the person typed. A save that completed no longer needs them.
  // An action that was lost track of is left alone: whether it landed is not known, and the rules are read again.
  useEffect(() => {
    for (const t of tracked) {
      const sent = sentDrafts[t.actionId]
      if (!sent || (t.state !== 'errored' && t.state !== 'completed')) continue
      sentDrafts = { ...sentDrafts }
      delete sentDrafts[t.actionId]
      if (t.state === 'errored' && !unsavedDrafts[sent.serverId]) setDraftFor(sent.serverId, sent.draft)
    }
  }, [tracked])

  // Handle Disable / Flush Firewall
  const handleFlushFirewall = async () => {
    if (!activeServerId || !canEdit) return
    const c = await confirmAction({
      title: 'Disable firewall',
      target: fwTarget(),
      summary: `Removes every rule. With no rules, BinaryLane's external firewall allows all inbound traffic to ${activeServer?.name || activeServerId}.`,
      severity: 'irreversible',
      helpSlug: 'firewall#disable-firewall',
      notes: ['Export the rules first if you may want them back — there is no undo on the BinaryLane side.'],
      diff: diffLines(currentRules.map(describeFirewallRule), []),
      confirmLabel: 'Disable firewall'
    })
    if (!c.ok) return

    try {
      await finishFirewall(c.changeId, updateFirewall.mutateAsync([]))
      window.bldeskApi?.sendNotification?.({
        title: 'Firewall Disabled',
        body: `Flushed all firewall rules on #${activeServerId}.`
      })
    } catch (err: any) {
      notifyFailure('Flush failed', err)
    }
  }

  // Handle Export Rules JSON: the text mPanel's Import/Export dialog shows, which Import reads back.
  // The Android app opens Android's Save as dialog; the desktop app and the browser build download the file as before.
  const handleExportJson = async () => {
    setExporting(true)
    try {
      await saveTextFile(`firewall-rules-${activeServer?.name || activeServerId}.json`, mpanelText(currentRules))
    } catch (err) {
      notifyFailure('Could not export firewall rules', err)
    } finally {
      setExporting(false)
    }
  }

  // Handle Import Rules from text/file
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setImportError(null)
    if (!canEdit) return

    try {
      // What is written is checked against the API reference first: a rule list it would refuse is never sent.
      const read = readImportedRules(JSON.parse(importJsonText), currentRules.length, currentRules)
      if (read.error !== undefined) throw new Error(read.error)
      const parsed = read.rules
      if (parsed.length === 0 && currentRules.length === 0) throw new Error('The file has no rules, and this server has none, so there is nothing to import.')

      // An empty list removes every rule: that is Disable firewall, and it is confirmed as strictly.
      const clearsAll = parsed.length === 0
      const c = await confirmAction({
        title: 'Import firewall rules',
        target: fwTarget(),
        summary: clearsAll
          ? `Replaces the current ${ruleCount(currentRules.length)} with none. With no rules, BinaryLane's external firewall allows all inbound traffic to ${activeServer?.name || activeServerId}.`
          : `Replaces the current ${ruleCount(currentRules.length)} with the ${parsed.length} imported.`,
        severity: clearsAll ? 'irreversible' : 'destructive',
        helpSlug: clearsAll ? 'firewall#disable-firewall' : undefined,
        notes: clearsAll ? ['Export the rules first if you may want them back — there is no undo on the BinaryLane side.'] : undefined,
        diff: diffLines(currentRules.map(describeFirewallRule), parsed.map(describeFirewallRule)),
        confirmLabel: 'Import'
      })
      if (!c.ok) return
      await finishFirewall(c.changeId, updateFirewall.mutateAsync(parsed))
      setIsImportOpen(false)
      setImportJsonText('')
      window.bldeskApi?.sendNotification?.({
        title: 'Firewall Rules Imported',
        body: `Applied ${ruleCount(parsed.length)} to server #${activeServerId}.`
      })
    } catch (err: any) {
      setImportError(err.message || 'Invalid JSON format.')
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setImportJsonText(content)
    }
    reader.readAsText(file)
  }

  // Handle Clone to Target Server
  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client || !targetServerId || isCloning) return
    setCloneError(null)

    const targetName = servers.find((s) => s.id === targetServerId)?.name || String(targetServerId)
    // Read the target's current list first so the diff is a true before → after.
    // A clone replaces the whole list, so a target that cannot be read is not
    // written to: the empty list a failed read would give looks like "0 rules".
    // Busy while it loads: a second click would queue a second confirmation.
    setIsCloning(true)
    const targetRules = await readFirewallRules(client, targetServerId)
    setIsCloning(false)
    // Cancelled while it was reading: nothing more is asked or shown.
    if (!cloneOpenRef.current) return
    if (!targetRules) {
      setCloneError(`Couldn't read the firewall rules on ${targetName}. Nothing was changed: a clone replaces the target's whole list, so it needs the current one first.`)
      return
    }
    const outgoing = currentRules.map(toRuleRequest)
    const c = await confirmAction({
      title: 'Clone firewall rules',
      target: { kind: 'server', id: targetServerId, name: String(targetName) },
      summary: `Replaces the ${ruleCount(targetRules.length)} on ${targetName} with the ${currentRules.length} from ${activeServer?.name}.`,
      severity: 'destructive',
      diff: diffLines(targetRules.map(describeFirewallRule), outgoing.map(describeFirewallRule)),
      confirmLabel: 'Clone rules'
    })
    if (!c.ok) return

    setIsCloning(true)
    try {
      const { data, error, response } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: targetServerId } },
        body: {
          type: 'change_advanced_firewall_rules',
          firewall_rules: outgoing
        }
      })
      if (error || !response.ok) throw apiFailure(error, response)
      if (data?.action) track(data.action, 'Clone firewall rules', String(targetName), c.changeId)
      window.bldeskApi?.sendNotification?.({
        title: 'Firewall Rules Cloned',
        body: `Applied ${ruleCount(currentRules.length)} from ${activeServer?.name} to ${targetName}.`
      })
      closeClone()
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Clone failed', err)
    } finally {
      setIsCloning(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header & Target Server Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-[#017cb6]" />
            <span>Cloud Network Firewall</span>
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Hardware edge packet filtering evaluated before traffic reaches your VM.
          </p>
        </div>

        {/* Server Picker Dropdown & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded shadow-sm overflow-hidden text-xs">
            <button
              onClick={() => setView('server')}
              className={`px-3 py-1.5 flex items-center gap-1.5 ${view === 'server' ? 'bg-[#017cb6] text-white' : 'text-[#212529] dark:text-slate-200 hover:bg-[#f1f1f1] dark:hover:bg-[#343a40]'}`}
            >
              <Server className="w-3.5 h-3.5" /> Server
            </button>
            <button
              onClick={() => setView('matrix')}
              className={`px-3 py-1.5 flex items-center gap-1.5 ${view === 'matrix' ? 'bg-[#017cb6] text-white' : 'text-[#212529] dark:text-slate-200 hover:bg-[#f1f1f1] dark:hover:bg-[#343a40]'}`}
              title="Every server × every rule, with an audit"
            >
              <Grid3x3 className="w-3.5 h-3.5" /> Fleet matrix
            </button>
          </div>
          {view === 'matrix' ? null : (
          <>
          <div className="flex items-center gap-2 bg-white dark:bg-[#2b3035] px-3 py-1.5 border border-[#ced4da] dark:border-[#373b3e] rounded shadow-sm">
            <Server className="w-3.5 h-3.5 text-[#017cb6]" />
            <select
              value={activeServerId || ''}
              onChange={(e) => setSelectedServerId(Number(e.target.value))}
              // The save in progress is for this server: the write is made for whichever one is chosen when it goes out.
              disabled={saving}
              className="bg-transparent text-xs text-[#212529] dark:text-white focus:outline-none cursor-pointer max-w-[160px]"
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id} className="bg-white dark:bg-[#2b3035]">
                  {s.name} (#{s.id}){hasEdits(s.id) ? ' · unsaved changes' : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={openClone}
            disabled={!activeServerId || currentRules.length === 0 || writePending || pending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-40"
            title="Clone rules to another server"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Clone</span>
          </button>

          <button
            onClick={() => setIsImportOpen(true)}
            disabled={!canEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-40"
            title="Import rules from JSON"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import</span>
          </button>

          <button
            onClick={() => void handleExportJson()}
            disabled={currentRules.length === 0 || pending || exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-40"
            title="Export rules as JSON file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          <button
            onClick={() => setIsAdding((prev) => !prev)}
            disabled={(!canEdit || atRuleLimit) && !isAdding}
            title={atRuleLimit && !isAdding ? limitNote : undefined}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            <span>{isAdding ? 'Close Form' : 'Add Rule'}</span>
          </button>
          </>
          )}
          <HelpLink slug="firewall" />
        </div>
      </div>
      {/* Under the buttons, not among them: inside the row it made the row so wide that the heading wrapped. */}
      {view === 'server' && atRuleLimit && <p className="-mt-3 md:text-right text-[11px] text-[#6c757d] dark:text-slate-400">{limitNote}</p>}

      {view === 'matrix' ? (
        <FirewallMatrix
          client={client}
          servers={servers}
          profileId={profileId}
          onSelectServer={(id) => {
            if (saving) return
            setSelectedServerId(id)
            setView('server')
          }}
        />
      ) : (
      <>
      {/* Add Rule Drawer Form */}
      {isAdding && (
        <form
          onSubmit={handleAddRule}
          className="p-5 bg-white dark:bg-[#2b3035] border border-[#017cb6]/40 rounded-lg space-y-4 text-xs shadow-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
            <h3 className="font-bold text-sm text-[#212529] dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#017cb6]" />
              <span>Add Inbound Firewall Rule</span>
            </h3>

            {/* Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[#6c757d] mr-1">Presets:</span>
              <button
                type="button"
                onClick={() => applyPreset('ssh')}
                className="px-2 py-0.5 text-[10px] font-medium bg-[#f1f1f1] dark:bg-[#343a40] text-[#212529] dark:text-slate-200 rounded hover:bg-[#e9ecef]"
              >
                SSH (22)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('http_https')}
                className="px-2 py-0.5 text-[10px] font-medium bg-[#f1f1f1] dark:bg-[#343a40] text-[#212529] dark:text-slate-200 rounded hover:bg-[#e9ecef]"
              >
                HTTP/HTTPS
              </button>
              <button
                type="button"
                onClick={() => applyPreset('wireguard')}
                className="px-2 py-0.5 text-[10px] font-medium bg-[#f1f1f1] dark:bg-[#343a40] text-[#212529] dark:text-slate-200 rounded hover:bg-[#e9ecef]"
              >
                WireGuard
              </button>
              <button
                type="button"
                onClick={() => applyPreset('drop_all')}
                className="px-2 py-0.5 text-[10px] font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded hover:bg-rose-100"
              >
                Drop All
              </button>
            </div>
          </div>

          {(errorMsg ?? (atRuleLimit ? limitNote : null)) && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg ?? limitNote}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-6 gap-3 items-start">
            <div>
              <label htmlFor="fw-add-source" className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Source</label>
              <textarea
                id="fw-add-source"
                rows={lines(ruleSource)}
                placeholder="0.0.0.0/0"
                spellCheck={false}
                value={ruleSource}
                onChange={(e) => setRuleSource(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white resize-none font-mono focus:outline-none focus:border-[#017cb6]"
              />
              <PickMenu label="source addresses" choices={addressPicks} onPick={(c) => setRuleSource((held) => withChoice(held, c.values))} />
            </div>

            <div>
              <label htmlFor="fw-add-destination" className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Destination</label>
              <textarea
                id="fw-add-destination"
                rows={lines(ruleDestination)}
                placeholder="0.0.0.0/0"
                spellCheck={false}
                value={ruleDestination}
                onChange={(e) => setRuleDestination(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white resize-none font-mono focus:outline-none focus:border-[#017cb6]"
              />
              <PickMenu label="destination addresses" choices={addressPicks} onPick={(c) => setRuleDestination((held) => withChoice(held, c.values))} />
            </div>

            <div>
              <label htmlFor="fw-add-ports" className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Destination ports</label>
              <textarea
                id="fw-add-ports"
                rows={lines(rulePorts)}
                disabled={ruleProtocol === 'icmp' || ruleProtocol === 'all'}
                placeholder="22 or 80, 443"
                spellCheck={false}
                value={rulePorts}
                onChange={(e) => setRulePorts(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white resize-none font-mono focus:outline-none focus:border-[#017cb6] disabled:opacity-40"
              />
              <PickMenu label="destination ports" choices={PORT_CHOICES} disabled={ruleProtocol === 'icmp' || ruleProtocol === 'all'} onPick={(c) => setRulePorts((held) => withChoice(held, c.values))} />
            </div>

            <div>
              <label htmlFor="fw-add-protocol" className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Protocol</label>
              <select
                id="fw-add-protocol"
                value={ruleProtocol}
                onChange={(e) => setRuleProtocol(e.target.value as FwRule['protocol'])}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white uppercase font-mono focus:outline-none focus:border-[#017cb6]"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP (Ping)</option>
                <option value="all">ALL</option>
              </select>
            </div>

            <div>
              <label htmlFor="fw-add-action" className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Action</label>
              <select
                id="fw-add-action"
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value as FwRule['action'])}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white font-medium focus:outline-none focus:border-[#017cb6]"
              >
                <option value="accept">ACCEPT</option>
                <option value="drop">DROP</option>
              </select>
            </div>

            <div>
              <label htmlFor="fw-add-description" className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Description</label>
              <input
                id="fw-add-description"
                type="text"
                placeholder="Description"
                value={ruleDescription}
                onChange={(e) => setRuleDescription(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white focus:outline-none focus:border-[#017cb6]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ced4da] dark:border-[#373b3e]">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateFirewall.isPending || !canEdit || atRuleLimit}
              className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {updateFirewall.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Rule</span>
            </button>
          </div>
        </form>
      )}

      {/* Rules Evaluation List */}
      <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-5 space-y-4 flex-1 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
          <div className="flex-1 min-w-[14rem]">
            <h3 className="text-sm font-bold text-[#212529] dark:text-white flex flex-wrap items-baseline gap-x-2 min-w-0">
              <span className="min-w-0 break-words">
                Evaluated Rules for {activeServer?.name || `Server #${activeServerId}`}
              </span>
              {/* `whitespace-nowrap`: squeezed into the leftover column it broke
                  across two lines as "(16" / "rules)". */}
              {firewallQuery.data && (
                <span className="text-xs font-normal whitespace-nowrap text-[#6c757d] dark:text-slate-400">
                  ({ruleCount(currentRules.length)})
                </span>
              )}
            </h3>
            <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
              Rules are evaluated sequentially from top to bottom. The first matching rule applies.
            </p>
            <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5 [@media(pointer:coarse)]:hidden">
              Edit a rule in place, drag it anywhere outside its fields or use the arrows to move it, and remove it with its remove button. Nothing is applied until you press Save changes.
            </p>
            <p className="hidden [@media(pointer:coarse)]:block text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
              Edit a rule in place. To move one, touch and hold it outside its fields until it lifts, then drag it, or use the arrows. Remove it with its remove button. Nothing is applied until you press Save changes.
            </p>
          </div>

          {currentRules.length > 0 && (
            <button
              onClick={handleFlushFirewall}
              disabled={updateFirewall.isPending || !canEdit}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition border border-rose-300 dark:border-rose-800 disabled:opacity-40"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Disable Firewall</span>
            </button>
          )}
        </div>

        {firewallQuery.isPending && firewallQuery.fetchStatus !== 'idle' && (
          <div className="flex items-center justify-center p-12 text-xs text-[#6c757d]">
            <Loader2 className="w-6 h-6 animate-spin text-[#017cb6] mr-2" />
            <span>Fetching firewall rules from edge hypervisors...</span>
          </div>
        )}

        {writePending && firewallQuery.isSuccess && (
          <div role="status" className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-xs">
            <Loader2 className="w-4 h-4 flex-shrink-0 mt-px animate-spin" />
            <p>A change to this server's firewall rules is still being applied. Editing is switched off until it lands, because every save writes the whole list back.</p>
          </div>
        )}

        {firewallQuery.isError && (
          <div
            role="alert"
            className="flex items-start gap-2 p-3 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="font-semibold break-words">
                {firewallQuery.data
                  ? "Couldn't refresh this server's firewall rules."
                  : "Couldn't read this server's firewall rules."}
              </p>
              <p className="break-words line-clamp-3">{firewallQuery.error?.message}</p>
              {firewallQuery.data && <p>The list below is from the last successful load.</p>}
              <p>Editing is switched off until they load, because every save writes the whole list back.</p>
              <button
                onClick={() => void firewallQuery.refetch()}
                disabled={firewallQuery.isFetching}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${firewallQuery.isFetching ? 'animate-spin' : ''}`} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {firewallQuery.isSuccess && currentRules.length === 0 && (
          <div className="text-xs text-[#6c757d] p-8 text-center bg-[#f8f9fa] dark:bg-[#212529] border border-dashed border-[#ced4da] dark:border-[#373b3e] rounded-lg space-y-2">
            <Unlock className="w-8 h-8 text-[#6c757d]/50 mx-auto" />
            <div className="font-semibold text-[#212529] dark:text-white">Firewall Inactive / Open</div>
            <p className="text-[#6c757d] dark:text-slate-400 max-w-sm mx-auto text-[11px]">
              No external packet filtering rules configured. All inbound traffic is routed directly to the guest OS.
            </p>
            <button
              onClick={() => setIsAdding(true)}
              className="mt-2 px-3 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white rounded text-xs font-medium"
            >
              Add First Filter Rule
            </button>
          </div>
        )}

        {(pending || stale) && (
          <div
            role={stale ? 'alert' : 'status'}
            className={`sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-lg border text-xs shadow-sm ${
              stale
                ? 'border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200'
                : 'border-[#017cb6]/40 bg-sky-50 dark:bg-[#10242f] text-[#212529] dark:text-slate-100'
            }`}
          >
            {stale ? (
              <p className="flex-1 min-w-[12rem]">
                This server's rules changed after you started editing. Discard your changes to load the current rules, then make them again.
              </p>
            ) : (
              <div className="flex-1 min-w-[12rem]">
                <span className="font-semibold">Unsaved changes</span>
                <span className="text-[#495057] dark:text-slate-300"> · {draft ? describePending(pendingChanges(draft.rows)) : ''}</span>
                {badRows > 0 && (
                  <p className="mt-0.5 text-rose-600 dark:text-rose-400">Fix the rules marked below before saving.</p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={discardDraft}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition disabled:opacity-40"
              >
                Discard
              </button>
              {!stale && (
                <button
                  type="button"
                  onClick={() => void handleSaveDraft()}
                  disabled={!canSave}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:opacity-40 flex items-center gap-1.5"
                >
                  {(saving || updateFirewall.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save changes</span>
                </button>
              )}
            </div>
          </div>
        )}

        {!firewallQuery.isLoading && rows.length > 0 && <FirewallRulesEditor rows={rows} editable={rowsEditable} addressChoices={addressPicks} onChange={editRows} />}
      </div>

      {/* Import dialog */}
      {isImportOpen && (
        <Modal
          title="Import Firewall Rules JSON"
          icon={FileJson}
          onClose={() => setIsImportOpen(false)}
          as="form"
          onSubmit={handleImportSubmit}
          footer={
            <div className="flex items-center justify-end gap-2 p-4">
              <button
                type="button"
                onClick={() => setIsImportOpen(false)}
                className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateFirewall.isPending || !canEdit}
                className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {updateFirewall.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Apply Rules</span>
              </button>
            </div>
          }
        >
          <div className="p-5 space-y-4">
            <p className="text-xs text-[#6c757d] dark:text-slate-400">
              Reads the text from mPanel&apos;s firewall Import/Export dialog, which is also what Export saves, or a list in the API&apos;s own rule fields (source_addresses, destination_addresses,
              destination_ports, protocol, action, description).
            </p>
            <div>
              <label className="text-xs font-semibold text-[#495057] dark:text-[#ced4da] block mb-1">
                Upload .json configuration file:
              </label>
              <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 px-3 border border-dashed border-[#ced4da] dark:border-[#373b3e] hover:border-[#017cb6] bg-[#f8f9fa] dark:bg-[#212529] rounded text-xs text-[#6c757d] dark:text-slate-300 transition flex items-center justify-center gap-2"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Choose JSON File...</span>
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#495057] dark:text-[#ced4da] block mb-1">
                Or paste JSON rules array directly:
              </label>
              <textarea
                required
                rows={8}
                placeholder={`[\n  {\n    "sourceaddr": "0.0.0.0/0",\n    "destaddr": "203.0.113.17",\n    "destport": "22,80,443",\n    "action": "ACCEPT",\n    "description": "Production Web & SSH",\n    "protocol": "TCP"\n  }\n]`}
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                className="w-full p-3 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white font-mono text-[11px] focus:outline-none focus:border-[#017cb6]"
              />
            </div>

            {importError && (
              <div role="alert" className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{importError}</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Clone dialog */}
      {isCloneOpen && (
        <Modal
          title="Clone Rules to Another Server"
          size="sm"
          icon={Share2}
          onClose={closeClone}
          as="form"
          onSubmit={handleCloneSubmit}
          footer={
            <div className="flex items-center justify-end gap-2 p-4 text-xs">
              <button
                type="button"
                onClick={closeClone}
                className="px-3 py-1.5 text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCloning || !targetServerId}
                className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {isCloning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Apply Rules</span>
              </button>
            </div>
          }
        >
          <div className="p-5 space-y-4 text-xs">
            <p className="text-[#6c757d] dark:text-slate-400">
              This will overwrite the destination server's firewall rules with the {ruleCount(currentRules.length)} from {activeServer?.name}.
            </p>

            <div>
              <label className="font-semibold text-[#495057] dark:text-[#ced4da] block mb-1">
                Destination Server
              </label>
              <select
                value={targetServerId || ''}
                onChange={(e) => {
                  setTargetServerId(Number(e.target.value))
                  setCloneError(null)
                }}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
              >
                <option value="">Select a server...</option>
                {servers
                  .filter((s) => s.id !== activeServerId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (#{s.id})
                    </option>
                  ))}
              </select>
            </div>

            {cloneError && (
              <div role="alert" className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{cloneError}</span>
              </div>
            )}
          </div>
        </Modal>
      )}
      </>
      )}
    </div>
  )
}
