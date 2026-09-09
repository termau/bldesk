import { HelpLink } from '../ui/HelpLink'
import React, { useState, useRef } from 'react'
import {
  Shield,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
  Server,
  Unlock,
  ChevronUp,
  ChevronDown,
  Download,
  Upload,
  Share2,
  FileJson,
  Grid3x3,
  X
} from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useFirewallRules, useUpdateFirewallRulesMutation } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { recordChange, updateChange, type ChangeTarget } from '../../lib/changelog'
import { diffLines, describeFirewallRule } from '../../lib/diff'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { describeApiError } from '../../api/queries'
import { FirewallMatrix } from './FirewallMatrix'

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

  // Add Rule Form States
  const [isAdding, setIsAdding] = useState(false)
  const [ruleAction, setRuleAction] = useState<'accept' | 'drop'>('accept')
  const [ruleProtocol, setRuleProtocol] = useState<'tcp' | 'udp' | 'icmp' | 'all'>('tcp')
  const [rulePorts, setRulePorts] = useState('22')
  const [ruleSource, setRuleSource] = useState('0.0.0.0/0')
  const [ruleDescription, setRuleDescription] = useState('Allow SSH')
  const [rulePlacement, setRulePlacement] = useState<'top' | 'bottom' | 'before_drop'>('before_drop')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Import / Export States
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importJsonText, setImportJsonText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  // Clone to Server States
  const [isCloneOpen, setIsCloneOpen] = useState(false)
  const [targetServerId, setTargetServerId] = useState<number | null>(null)
  const [isCloning, setIsCloning] = useState(false)

  const currentRules = (firewallQuery.data || []) as any[]

  // Handle Preset Selection
  const confirmAction = useConfirm()
  const { track } = useTrackedActions()
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
  const applyPreset = (preset: 'ssh' | 'http_https' | 'openvpn' | 'wireguard' | 'drop_all') => {
    switch (preset) {
      case 'ssh':
        setRuleAction('accept')
        setRuleProtocol('tcp')
        setRulePorts('22')
        setRuleSource('0.0.0.0/0')
        setRuleDescription('Allow SSH')
        break
      case 'http_https':
        setRuleAction('accept')
        setRuleProtocol('tcp')
        setRulePorts('80, 443')
        setRuleSource('0.0.0.0/0')
        setRuleDescription('Allow Web HTTP/HTTPS')
        break
      case 'openvpn':
        setRuleAction('accept')
        setRuleProtocol('udp')
        setRulePorts('1194')
        setRuleSource('0.0.0.0/0')
        setRuleDescription('Allow OpenVPN')
        break
      case 'wireguard':
        setRuleAction('accept')
        setRuleProtocol('udp')
        setRulePorts('51820')
        setRuleSource('0.0.0.0/0')
        setRuleDescription('Allow WireGuard VPN')
        break
      case 'drop_all':
        setRuleAction('drop')
        setRuleProtocol('all')
        setRulePorts('')
        setRuleSource('0.0.0.0/0')
        setRuleDescription('Default Drop Inbound')
        setRulePlacement('bottom')
        break
    }
  }

  // Handle Adding Rule
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!activeServerId) return

    const newRule: any = {
      action: ruleAction,
      protocol: ruleProtocol,
      source_addresses: ruleSource
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      description: ruleDescription.trim() || undefined
    }

    if (ruleProtocol === 'tcp' || ruleProtocol === 'udp') {
      if (!rulePorts.trim()) {
        setErrorMsg('Destination port(s) are required for TCP/UDP rules.')
        return
      }
      newRule.destination_ports = rulePorts
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    }

    if (newRule.source_addresses.length === 0) {
      newRule.source_addresses = ['0.0.0.0/0']
    }

    let updatedList = [...currentRules]

    if (rulePlacement === 'top') {
      updatedList.unshift(newRule)
    } else if (rulePlacement === 'bottom') {
      updatedList.push(newRule)
    } else {
      // Insert before first drop-all if exists
      const dropIndex = updatedList.findIndex(
        (r) => r.action === 'drop' && (r.protocol === 'all' || !r.destination_ports || r.destination_ports.length === 0)
      )
      if (dropIndex !== -1) {
        updatedList.splice(dropIndex, 0, newRule)
      } else {
        updatedList.push(newRule)
      }
    }

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

  // Handle Move Up/Down (Re-ordering)
  const handleMoveRule = async (index: number, direction: 'up' | 'down') => {
    if (!activeServerId) return
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= currentRules.length) return

    const reordered = [...currentRules]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(newIndex, 0, moved)

    // Reordering changes which rule wins; worth a log line but not a dialog.
    const changeId = await recordChange({
      label: 'Reorder firewall rules',
      target: fwTarget(),
      severity: 'normal',
      diff: diffLines(currentRules.map(describeFirewallRule), reordered.map(describeFirewallRule)),
      source: 'ui'
    })
    try {
      await finishFirewall(changeId, updateFirewall.mutateAsync(reordered))
    } catch (err: any) {
      alert(`Reorder failed: ${err.message}`)
    }
  }

  // Handle Delete
  const handleDeleteRule = async (index: number) => {
    if (!activeServerId) return
    const rule = currentRules[index]
    const filtered = currentRules.filter((_, i) => i !== index)
    const c = await confirmAction({
      title: 'Delete firewall rule',
      target: fwTarget(),
      summary: `Removes rule #${index + 1} (${rule.description || rule.action}) and writes the remaining rules back to the server.`,
      severity: 'destructive',
      diff: diffLines(currentRules.map(describeFirewallRule), filtered.map(describeFirewallRule)),
      confirmLabel: 'Delete rule'
    })
    if (!c.ok) return

    try {
      await finishFirewall(c.changeId, updateFirewall.mutateAsync(filtered))
      window.bldeskApi?.sendNotification?.({
        title: 'Firewall Rule Removed',
        body: `Rule #${index + 1} removed.`
      })
    } catch (err: any) {
      alert(`Failed to delete rule: ${err.message}`)
    }
  }

  // Handle Disable / Flush Firewall
  const handleFlushFirewall = async () => {
    if (!activeServerId) return
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
      alert(`Flush failed: ${err.message}`)
    }
  }

  // Handle Export Rules JSON
  const handleExportJson = () => {
    const jsonStr = JSON.stringify(currentRules, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `firewall-rules-${activeServer?.name || activeServerId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Handle Import Rules from text/file
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setImportError(null)

    try {
      const parsed = JSON.parse(importJsonText)
      if (!Array.isArray(parsed)) {
        throw new Error('Firewall rules configuration must be a JSON array of rule objects.')
      }

      const c = await confirmAction({
        title: 'Import firewall rules',
        target: fwTarget(),
        summary: `Replaces the current ${currentRules.length} rule${currentRules.length === 1 ? '' : 's'} with the ${parsed.length} imported.`,
        severity: 'destructive',
        diff: diffLines(currentRules.map(describeFirewallRule), parsed.map(describeFirewallRule)),
        confirmLabel: 'Import'
      })
      if (!c.ok) return
      await finishFirewall(c.changeId, updateFirewall.mutateAsync(parsed))
      setIsImportOpen(false)
      setImportJsonText('')
      window.bldeskApi?.sendNotification?.({
        title: 'Firewall Rules Imported',
        body: `Applied ${parsed.length} firewall rules to server #${activeServerId}.`
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
    if (!client || !targetServerId) return

    const targetName = servers.find((s) => s.id === targetServerId)?.name || String(targetServerId)
    // Read the target's current list first so the diff is a true before → after.
    let targetRules: any[] = []
    try {
      const { data } = await client.GET('/v2/servers/{server_id}/advanced_firewall_rules', { params: { path: { server_id: targetServerId } } })
      targetRules = data?.firewall_rules || []
    } catch {
      // shown as "unknown" below rather than blocking the clone
    }
    const c = await confirmAction({
      title: 'Clone firewall rules',
      target: { kind: 'server', id: targetServerId, name: String(targetName) },
      summary: `Replaces the ${targetRules.length} rule${targetRules.length === 1 ? '' : 's'} on ${targetName} with the ${currentRules.length} from ${activeServer?.name}.`,
      severity: 'destructive',
      diff: diffLines(targetRules.map(describeFirewallRule), currentRules.map(describeFirewallRule)),
      confirmLabel: 'Clone rules'
    })
    if (!c.ok) return

    setIsCloning(true)
    try {
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: targetServerId } },
        body: {
          type: 'change_advanced_firewall_rules',
          firewall_rules: currentRules
        }
      })
      if (error) throw new Error(describeApiError(error))
      if (data?.action) track(data.action, 'Clone firewall rules', String(targetName), c.changeId)
      window.bldeskApi?.sendNotification?.({
        title: 'Firewall Rules Cloned',
        body: `Applied ${currentRules.length} rules from ${activeServer?.name} to ${targetName}.`
      })
      setIsCloneOpen(false)
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      alert(`Clone failed: ${err.message}`)
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
              className="bg-transparent text-xs text-[#212529] dark:text-white focus:outline-none cursor-pointer max-w-[160px]"
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id} className="bg-white dark:bg-[#2b3035]">
                  {s.name} (#{s.id})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsCloneOpen(true)}
            disabled={!activeServerId || currentRules.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-40"
            title="Clone rules to another server"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Clone</span>
          </button>

          <button
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm"
            title="Import rules from JSON"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import</span>
          </button>

          <button
            onClick={handleExportJson}
            disabled={currentRules.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-40"
            title="Export rules as JSON file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          <button
            onClick={() => setIsAdding((prev) => !prev)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>{isAdding ? 'Close Form' : 'Add Rule'}</span>
          </button>
          </>
          )}
          <HelpLink slug="firewall" />
        </div>
      </div>

      {view === 'matrix' ? (
        <FirewallMatrix
          client={client}
          servers={servers}
          profileId={profileId}
          onSelectServer={(id) => {
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
          <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
            <h3 className="font-bold text-sm text-[#212529] dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#017cb6]" />
              <span>Add Inbound Firewall Rule</span>
            </h3>

            {/* Presets */}
            <div className="flex items-center gap-1.5">
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

          {errorMsg && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Action</label>
              <select
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value as any)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white font-medium focus:outline-none focus:border-[#017cb6]"
              >
                <option value="accept">ACCEPT</option>
                <option value="drop">DROP</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Protocol</label>
              <select
                value={ruleProtocol}
                onChange={(e) => setRuleProtocol(e.target.value as any)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white uppercase font-mono focus:outline-none focus:border-[#017cb6]"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP (Ping)</option>
                <option value="all">ALL</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Port(s)</label>
              <input
                type="text"
                disabled={ruleProtocol === 'icmp' || ruleProtocol === 'all'}
                placeholder="22 or 80, 443"
                value={rulePorts}
                onChange={(e) => setRulePorts(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white font-mono focus:outline-none focus:border-[#017cb6] disabled:opacity-40"
              />
            </div>

            <div>
              <label className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Source CIDR</label>
              <input
                type="text"
                placeholder="0.0.0.0/0"
                value={ruleSource}
                onChange={(e) => setRuleSource(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white font-mono focus:outline-none focus:border-[#017cb6]"
              />
            </div>

            <div>
              <label className="text-[11px] text-[#495057] dark:text-[#ced4da] block mb-1">Label</label>
              <input
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
              disabled={updateFirewall.isPending}
              className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm"
            >
              {updateFirewall.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Rule</span>
            </button>
          </div>
        </form>
      )}

      {/* Rules Evaluation List */}
      <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-5 space-y-4 flex-1 shadow-sm">
        <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
          <div>
            <h3 className="text-sm font-bold text-[#212529] dark:text-white flex flex-wrap items-baseline gap-x-2 min-w-0">
              <span className="min-w-0 break-words">
                Evaluated Rules for {activeServer?.name || `Server #${activeServerId}`}
              </span>
              {/* `whitespace-nowrap`: squeezed into the leftover column it broke
                  across two lines as "(16" / "rules)". */}
              <span className="text-xs font-normal whitespace-nowrap text-[#6c757d] dark:text-slate-400">
                ({currentRules.length} rules)
              </span>
            </h3>
            <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
              Rules are evaluated sequentially from top to bottom. The first matching rule applies.
            </p>
          </div>

          {currentRules.length > 0 && (
            <button
              onClick={handleFlushFirewall}
              disabled={updateFirewall.isPending}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition border border-rose-300 dark:border-rose-800"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Disable Firewall</span>
            </button>
          )}
        </div>

        {firewallQuery.isLoading && (
          <div className="flex items-center justify-center p-12 text-xs text-[#6c757d]">
            <Loader2 className="w-6 h-6 animate-spin text-[#017cb6] mr-2" />
            <span>Fetching firewall rules from edge hypervisors...</span>
          </div>
        )}

        {!firewallQuery.isLoading && currentRules.length === 0 && (
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

        {!firewallQuery.isLoading && currentRules.length > 0 && (
          <div className="space-y-2">
            {currentRules.map((rule, idx) => {
              const isAccept = rule.action === 'accept'
              const ports = rule.destination_ports?.join(', ') || 'ALL PORTS'
              const sources = rule.source_addresses?.join(', ') || '0.0.0.0/0'

              return (
                <div
                  key={idx}
                  /* Wraps on a phone. The row is index, action, protocol, port,
                     source and the controls; at 412px that is ~140px more than
                     fits, and without wrapping the controls simply spilled out
                     of the card with no way to reach them. */
                  className="p-3 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs hover:border-[#017cb6] transition"
                >
                  <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                    {/* Index & Reordering */}
                    <div className="flex items-center gap-1 bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] px-1.5 py-0.5 rounded">
                      <span className="font-mono text-[10px] text-[#6c757d] font-bold w-4 text-center">
                        {idx + 1}
                      </span>
                      <div className="flex flex-col">
                        <button
                          onClick={() => handleMoveRule(idx, 'up')}
                          disabled={idx === 0}
                          className="text-[#6c757d] hover:text-[#017cb6] disabled:opacity-20 transition"
                          title="Move Rule Up"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleMoveRule(idx, 'down')}
                          disabled={idx === currentRules.length - 1}
                          className="text-[#6c757d] hover:text-[#017cb6] disabled:opacity-20 transition"
                          title="Move Rule Down"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Action Badge */}
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] tracking-wider uppercase ${
                        isAccept
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {rule.action}
                    </span>

                    {/* Protocol & Ports */}
                    <span className="px-2 py-0.5 rounded bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] text-[#017cb6] font-mono text-[11px] uppercase font-semibold">
                      {rule.protocol}
                    </span>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#212529] dark:text-white font-mono text-xs">
                          {ports}
                        </span>
                        <span className="text-[#ced4da]">•</span>
                        <span className="text-[#6c757d] dark:text-slate-400 font-mono text-[11px]">
                          from {sources}
                        </span>
                      </div>
                      {rule.description && (
                        <div className="text-[11px] text-[#6c757d] dark:text-slate-400 font-medium">
                          {rule.description}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => handleDeleteRule(idx)}
                    className="p-1.5 text-[#6c757d] hover:text-rose-500 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                    title="Delete Rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Import Modal */}
      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f1f1f1] dark:bg-[#262a2e]">
              <h3 className="font-bold text-sm text-[#212529] dark:text-white flex items-center gap-2">
                <FileJson className="w-4 h-4 text-[#017cb6]" />
                <span>Import Firewall Rules JSON</span>
              </h3>
              <button
                onClick={() => setIsImportOpen(false)}
                className="p-1 text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="p-5 space-y-4">
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
                  placeholder={`[\n  {\n    "action": "accept",\n    "protocol": "tcp",\n    "destination_ports": ["22", "80", "443"],\n    "source_addresses": ["0.0.0.0/0"],\n    "description": "Production Web & SSH"\n  }\n]`}
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  className="w-full p-3 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-white font-mono text-[11px] focus:outline-none focus:border-[#017cb6]"
                />
              </div>

              {importError && (
                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ced4da] dark:border-[#373b3e]">
                <button
                  type="button"
                  onClick={() => setIsImportOpen(false)}
                  className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateFirewall.isPending}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm"
                >
                  {updateFirewall.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Apply Rules</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clone Modal */}
      {isCloneOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f1f1f1] dark:bg-[#262a2e]">
              <h3 className="font-bold text-sm text-[#212529] dark:text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-[#017cb6]" />
                <span>Clone Rules to Another Server</span>
              </h3>
              <button
                onClick={() => setIsCloneOpen(false)}
                className="p-1 text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCloneSubmit} className="p-5 space-y-4 text-xs">
              <p className="text-[#6c757d] dark:text-slate-400">
                This will overwrite the destination server's firewall rules with the {currentRules.length} rules from {activeServer?.name}.
              </p>

              <div>
                <label className="font-semibold text-[#495057] dark:text-[#ced4da] block mb-1">
                  Destination Server
                </label>
                <select
                  value={targetServerId || ''}
                  onChange={(e) => setTargetServerId(Number(e.target.value))}
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

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ced4da] dark:border-[#373b3e]">
                <button
                  type="button"
                  onClick={() => setIsCloneOpen(false)}
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
            </form>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}
