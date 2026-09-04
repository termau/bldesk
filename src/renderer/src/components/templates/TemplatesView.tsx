import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutTemplate,
  Plus,
  Search,
  Download,
  Upload,
  Copy,
  Pencil,
  Trash2,
  Rocket,
  Sparkles,
  Server as ServerIcon,
  Shield,
  Braces,
  FileCode2,
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  Wand2,
  ClipboardPaste
} from 'lucide-react'
import type { components } from '@shared/api/schema'
import { templateSlug } from '@shared/templates'
import type { BinaryLaneClient } from '../../api/client'
import { useRegions, useSizes, useDistributionImages, useVpcs, useSshKeys } from '../../api/queries'
import { Modal } from '../ui/Modal'
import { useConfirm } from '../../context/ConfirmContext'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { CreateServerModal } from '../servers/CreateServerModal'
import { SafetyPolicyBadge } from '../ui/SafetyPolicyBadge'
import {
  TEMPLATE_KIND,
  TEMPLATES_EVENT,
  listServerTemplates,
  saveServerTemplate,
  removeServerTemplate,
  templateToYaml,
  bundleToYaml,
  templatesFromImport,
  templateVariables,
  extractVariables,
  describeTemplate,
  prefillFromTemplate,
  renderRules,
  withBuiltins,
  type ServerTemplate,
  type ListedServerTemplate,
  type TemplateVariable,
  type CreateServerPrefill
} from '../../lib/serverTemplates'
import { STARTER_TEMPLATES } from '../../lib/starterTemplates'
import type { FwRule } from '../../lib/firewallMatrix'
import { listTemplateJobs, dismissTemplateJob, startTemplateJob, TEMPLATE_JOBS_EVENT, type TemplateJob } from '../../lib/templateJobs'

type Server = components['schemas']['Server']

interface TemplatesViewProps {
  client: BinaryLaneClient | null
  servers: Server[]
  profileId?: string
  /** A capture from a server or the create form, to open in the editor. */
  draft?: ServerTemplate | null
  onDraftConsumed?: () => void
  /** From the palette: `create <hostname> from <template>`. */
  applyRequest?: { template: string; hostname: string } | null
  onApplyConsumed?: () => void
}

const card = 'bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm'
const input = 'w-full px-2.5 py-1.5 text-xs rounded border bg-white dark:bg-[#212529] border-[#ced4da] dark:border-[#495057] text-[#212529] dark:text-white outline-none focus:border-[#017cb6]'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#ced4da] dark:border-[#495057] hover:border-[#017cb6] disabled:opacity-40 text-[#212529] dark:text-white'
const btnPrimary = 'inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded bg-[#017cb6] hover:bg-[#016594] text-white disabled:opacity-40 shadow-sm'
const label = 'block text-[11px] font-semibold uppercase tracking-wide text-[#6c757d] dark:text-slate-400 mb-1'

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-yaml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function randomSecret(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': 'a', '/': 'b', '=': '' })[c] as string)
}

function emptyTemplate(): ServerTemplate {
  return { kind: TEMPLATE_KIND, name: '', created_at: new Date().toISOString(), spec: { region: 'syd', image: 'ubuntu-24.04', size: 'std-1vcpu', options: { ipv4_addresses: 1 } } }
}

// ---------------------------------------------------------------------------

export const TemplatesView: React.FC<TemplatesViewProps> = ({ client, servers, profileId, draft, onDraftConsumed, applyRequest, onApplyConsumed }) => {
  const confirmAction = useConfirm()
  const { accessMode, collectionMutationBlockReason, resourceActionBlockReason } = useProfileSafety()
  const collectionMutationBlockReasonRef = useRef(collectionMutationBlockReason)
  const resourceActionBlockReasonRef = useRef(resourceActionBlockReason)
  collectionMutationBlockReasonRef.current = collectionMutationBlockReason
  resourceActionBlockReasonRef.current = resourceActionBlockReason
  const [stored, setStored] = useState<ListedServerTemplate[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ template: ServerTemplate; oldSlug?: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [applying, setApplying] = useState<{ template: ServerTemplate; hostname: string } | null>(null)
  const [create, setCreate] = useState<{ prefill: CreateServerPrefill; template: ServerTemplate; rules: FwRule[] } | null>(null)
  const [jobs, setJobs] = useState<TemplateJob[]>(listTemplateJobs())
  const fileRef = useRef<HTMLInputElement>(null)
  const deploymentBlockReason = accessMode === 'observe'
    ? 'Observe-only safety blocks creating servers.'
    : null
  const collectionBlockReason = collectionMutationBlockReason()

  const refresh = async () => {
    try {
      setStored(await listServerTemplates())
    } catch (err: any) {
      setError(err?.message || 'Could not read the template store.')
    }
  }
  useEffect(() => {
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener(TEMPLATES_EVENT, onChange)
    return () => window.removeEventListener(TEMPLATES_EVENT, onChange)
  }, [])
  useEffect(() => {
    const onJobs = () => setJobs(listTemplateJobs())
    window.addEventListener(TEMPLATE_JOBS_EVENT, onJobs)
    return () => window.removeEventListener(TEMPLATE_JOBS_EVENT, onJobs)
  }, [])
  useEffect(() => {
    if (!deploymentBlockReason) return
    setApplying(null)
    setCreate(null)
  }, [deploymentBlockReason])

  const items = useMemo<ListedServerTemplate[]>(() => {
    const own = new Set(stored.map((s) => s.slug))
    const starters = STARTER_TEMPLATES.filter((s) => !own.has(s.slug)).map((s) => ({ slug: s.slug, template: s.template, builtin: true }))
    return [...stored, ...starters]
  }, [stored])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => [i.template.name, i.template.description ?? '', ...(i.template.labels ?? []), i.template.spec.image ?? '', i.template.spec.size ?? ''].join(' ').toLowerCase().includes(q))
  }, [items, search])

  const selected = items.find((i) => i.slug === selectedSlug) ?? null
  useEffect(() => {
    if (!selectedSlug && items.length) setSelectedSlug(items[0].slug)
  }, [items, selectedSlug])

  // Captures arrive from the server page or the create form.
  useEffect(() => {
    if (!draft) return
    setEditing({ template: draft })
    onDraftConsumed?.()
  }, [draft])

  // Palette: create <hostname> from <template>
  useEffect(() => {
    if (!applyRequest || !items.length) return
    const q = applyRequest.template.toLowerCase().replace(/^@/, '')
    const hit = items.find((i) => i.template.name.toLowerCase() === q || i.slug === q) ?? items.find((i) => i.template.name.toLowerCase().startsWith(q))
    if (hit) {
      setSelectedSlug(hit.slug)
      if (deploymentBlockReason) setError(deploymentBlockReason)
      else setApplying({ template: hit.template, hostname: applyRequest.hostname })
    } else setError(`No template called “${applyRequest.template}”.`)
    onApplyConsumed?.()
  }, [applyRequest, items, deploymentBlockReason])

  // --- actions

  const handleSave = async (t: ServerTemplate, oldSlug?: string) => {
    const blockReason = oldSlug
      ? resourceActionBlockReasonRef.current('template', oldSlug, 'maintenance')
      : collectionMutationBlockReasonRef.current()
    if (blockReason) throw new Error(`Blocked locally: ${blockReason}`)
    if (oldSlug && templateSlug(t.name) !== oldSlug) {
      const renameBlockReason = resourceActionBlockReasonRef.current('template', oldSlug, 'destructive')
      if (renameBlockReason) {
        throw new Error(`Blocked locally: ${renameBlockReason} Template renaming is available only at the Normal tier.`)
      }
    }
    const slug = await saveServerTemplate(t, oldSlug)
    setEditing(null)
    setSelectedSlug(slug)
    setNotice(`Saved “${t.name}”.`)
  }

  const handleDelete = async (item: ListedServerTemplate) => {
    const initialBlockReason = resourceActionBlockReasonRef.current('template', item.slug, 'destructive')
    if (initialBlockReason) {
      setError(`Blocked locally: ${initialBlockReason}`)
      return
    }
    const result = await confirmAction({
      title: 'Delete template',
      target: { kind: 'account', name: item.template.name },
      summary: 'Removes the template from this device. Servers built from it are not affected.',
      severity: 'destructive',
      confirmLabel: 'Delete template',
      log: false
    })
    if (!result.ok) return
    try {
      const currentBlockReason = resourceActionBlockReasonRef.current('template', item.slug, 'destructive')
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      await removeServerTemplate(item.slug)
      if (selectedSlug === item.slug) setSelectedSlug(null)
    } catch (err: any) {
      setError(err?.message || 'Could not delete the template.')
    }
  }

  const handleDuplicate = (item: ListedServerTemplate) => {
    const blockReason = collectionMutationBlockReasonRef.current()
    if (blockReason) {
      setError(`Blocked locally: ${blockReason}`)
      return
    }
    const copy: ServerTemplate = JSON.parse(JSON.stringify(item.template))
    copy.name = item.builtin ? item.template.name.replace(/^/, 'My ') : `${item.template.name} copy`
    copy.created_at = new Date().toISOString()
    copy.updated_at = undefined
    copy.labels = (copy.labels ?? []).filter((l) => l !== 'starter')
    setEditing({ template: copy })
  }

  const handleExport = (item: ListedServerTemplate) => {
    try {
      download(`${item.slug}.yaml`, templateToYaml(item.template))
    } catch (err: any) {
      setError(err?.message || 'Could not export.')
    }
  }

  const handleExportAll = () => {
    const mine = stored.filter((s) => !s.error).map((s) => s.template)
    if (!mine.length) return setNotice('Nothing of your own to export yet — the starters ship with the app.')
    download(`bldesk-templates-${new Date().toISOString().slice(0, 10)}.yaml`, bundleToYaml(mine))
  }

  const importText = async (text: string, fallbackName: string) => {
    const initialBlockReason = collectionMutationBlockReasonRef.current()
    if (initialBlockReason) throw new Error(`Blocked locally: ${initialBlockReason}`)
    const parsed = templatesFromImport(text, fallbackName)
    let saved = 0
    for (const t of parsed) {
      try {
        const currentBlockReason = collectionMutationBlockReasonRef.current()
        if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
        await saveServerTemplate(t)
        saved++
      } catch (err: any) {
        if (/already exists/.test(err?.message || '')) {
          const currentBlockReason = collectionMutationBlockReasonRef.current()
          if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
          await saveServerTemplate({ ...t, name: `${t.name} (imported)` })
          saved++
        } else throw err
      }
    }
    setNotice(`Imported ${saved} template${saved === 1 ? '' : 's'}.`)
  }

  const handleFile = async (file: File) => {
    try {
      await importText(await file.text(), file.name.replace(/\.(ya?ml|json|txt)$/i, ''))
    } catch (err: any) {
      setError(err?.message || 'Import failed.')
    }
  }

  const beginNewTemplate = (): void => {
    const blockReason = collectionMutationBlockReasonRef.current()
    if (blockReason) {
      setError(`Blocked locally: ${blockReason}`)
      return
    }
    setEditing({ template: emptyTemplate() })
  }

  const beginEditTemplate = (item: ListedServerTemplate): void => {
    if (item.builtin) return
    const blockReason = resourceActionBlockReasonRef.current('template', item.slug, 'maintenance')
    if (blockReason) {
      setError(`Blocked locally: ${blockReason}`)
      return
    }
    setEditing({ template: JSON.parse(JSON.stringify(item.template)), oldSlug: item.slug })
  }

  const startApply = (t: ServerTemplate) => {
    if (deploymentBlockReason) {
      setError(deploymentBlockReason)
      return
    }
    setApplying({ template: t, hostname: '' })
  }

  const handleApplySubmit = (hostname: string, values: Record<string, string>) => {
    if (!applying) return
    if (deploymentBlockReason) {
      setApplying(null)
      setError(deploymentBlockReason)
      return
    }
    const t = applying.template
    try {
      const all = withBuiltins(t, hostname, values)
      const prefill = prefillFromTemplate(t, hostname, values)
      const rules = renderRules(t.spec.firewallRules, all)
      setApplying(null)
      setCreate({ prefill, template: t, rules })
    } catch (err: any) {
      setError(err?.message || 'Could not apply the template.')
    }
  }

  // Desktop only: show the YAML on disk. Starters are not files, so reveal the selected own template or the first one.
  const revealSlug = selected && !selected.builtin ? selected.slug : stored[0]?.slug
  const canReveal = !!window.bldeskApi?.templatesReveal && !!revealSlug
  const reveal = () => revealSlug && void window.bldeskApi.templatesReveal(revealSlug)

  // --- render

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-[#212529] dark:text-white flex items-center gap-2"><LayoutTemplate className="w-5 h-5 text-[#017cb6]" />Templates</h2>
          <p className="text-xs text-[#6c757d] dark:text-slate-400">A template is a whole server: plan, image, network, firewall rules, tags and cloud-init with variables. Build one, fill in the blanks, get the same box every time.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".yaml,.yml,.json,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = '' }} />
          <button
            className={btn}
            onClick={() => fileRef.current?.click()}
            disabled={!!collectionBlockReason}
            title={collectionBlockReason ?? 'Import templates (new templates start Normal)'}
          ><Upload className="w-3.5 h-3.5" />Import file</button>
          <button
            className={btn}
            onClick={() => setImportOpen(true)}
            disabled={!!collectionBlockReason}
            title={collectionBlockReason ?? 'Paste templates (new templates start Normal)'}
          ><ClipboardPaste className="w-3.5 h-3.5" />Paste</button>
          <button className={btn} onClick={handleExportAll}><Download className="w-3.5 h-3.5" />Export all</button>
          {canReveal && <button className={btn} onClick={reveal} title="Show the template files on disk"><FolderOpen className="w-3.5 h-3.5" /></button>}
          <button
            className={btnPrimary}
            onClick={beginNewTemplate}
            disabled={!!collectionBlockReason}
            title={collectionBlockReason ?? 'Create template (starts Normal)'}
          ><Plus className="w-3.5 h-3.5" />New template</button>
        </div>
      </div>

      {(error || notice) && (
        <div className={`mb-3 flex items-start justify-between gap-3 px-3 py-2 rounded border text-xs ${error ? 'border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800' : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800'}`}>
          <span className="whitespace-pre-wrap">{error || notice}</span>
          <button onClick={() => { setError(null); setNotice(null) }}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {deploymentBlockReason && (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{deploymentBlockReason} Existing templates remain readable and exportable; local edits follow each template’s saved tier.</span>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {jobs.map((j) => (
            <div key={j.id} className={`flex items-start gap-2 px-3 py-2 rounded border text-xs ${j.status === 'failed' ? 'border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800' : j.status === 'done' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800' : 'border-[#017cb6]/40 bg-[#017cb6]/5'}`}>
              {j.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : j.status === 'failed' ? <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" /> : <Loader2 className="w-4 h-4 animate-spin text-[#017cb6] shrink-0" />}
              <div className="flex-1 min-w-0 text-[#212529] dark:text-white">
                <span className="font-semibold">{j.serverName}</span>{j.serverId ? <span className="font-mono text-[#6c757d]"> #{j.serverId}</span> : null} from “{j.templateName}” — {j.detail}
              </div>
              {(j.status === 'done' || j.status === 'failed') && <button onClick={() => dismissTemplateJob(j.id)}><X className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Library */}
        <div className={`${card} flex flex-col min-h-0`}>
          <div className="p-2 border-b border-[#ced4da] dark:border-[#373b3e]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#6c757d]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" className={`${input} pl-8`} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 && <p className="p-4 text-xs text-[#6c757d]">No templates match.</p>}
            {[false, true].map((builtin) => {
              const group = visible.filter((i) => !!i.builtin === builtin)
              if (!group.length) return null
              return (
                <div key={String(builtin)}>
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6c757d] dark:text-slate-500 flex items-center gap-1.5">
                    {builtin ? <><Sparkles className="w-3 h-3" />Starters</> : <><FileCode2 className="w-3 h-3" />Mine</>}
                  </div>
                  {group.map((i) => (
                    <button
                      key={i.slug}
                      onClick={() => setSelectedSlug(i.slug)}
                      className={`w-full text-left px-3 py-2 border-l-2 ${selectedSlug === i.slug ? 'border-[#017cb6] bg-[#017cb6]/5' : 'border-transparent hover:bg-[#f8f9fa] dark:hover:bg-[#373b3e]'}`}
                    >
                      <div className="text-xs font-semibold text-[#212529] dark:text-white truncate flex items-center gap-1.5">
                        {i.error && <AlertTriangle className="w-3 h-3 text-rose-500" />}
                        {i.template.name || i.slug}
                      </div>
                      <div className="text-[11px] text-[#6c757d] dark:text-slate-400 truncate">{i.error ? i.error : describeTemplate(i.template)}</div>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
          {!stored.length && (
            <div className="p-3 border-t border-[#ced4da] dark:border-[#373b3e] text-[11px] text-[#6c757d] dark:text-slate-400">
              Nothing of your own yet. Duplicate a starter, or open a server and choose <span className="font-semibold">Save server as template</span>.
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="min-h-0 overflow-y-auto">
          {selected ? (
            <TemplateDetail
              item={selected}
              servers={servers}
              onApply={() => startApply(selected.template)}
              applyBlockReason={deploymentBlockReason}
              editBlockReason={selected.builtin ? null : resourceActionBlockReason('template', selected.slug, 'maintenance')}
              duplicateBlockReason={collectionBlockReason}
              deleteBlockReason={selected.builtin ? null : resourceActionBlockReason('template', selected.slug, 'destructive')}
              onEdit={() => beginEditTemplate(selected)}
              onDuplicate={() => handleDuplicate(selected)}
              onExport={() => handleExport(selected)}
              onDelete={() => void handleDelete(selected)}
            />
          ) : (
            <div className={`${card} p-8 text-center text-xs text-[#6c757d]`}>Pick a template.</div>
          )}
        </div>
      </div>

      {editing && (
        <TemplateEditor
          client={client}
          initial={editing.template}
          isNew={!editing.oldSlug}
          nameChangeBlockReason={editing.oldSlug
            ? resourceActionBlockReason('template', editing.oldSlug, 'destructive')
            : null}
          onCancel={() => setEditing(null)}
          onSave={(t) => handleSave(t, editing.oldSlug)}
        />
      )}

      {importOpen && (
        <PasteImportModal
          onClose={() => setImportOpen(false)}
          onImport={async (text) => {
            await importText(text, 'Pasted template')
            setImportOpen(false)
          }}
        />
      )}

      {applying && (
        <ApplyTemplateModal
          template={applying.template}
          initialHostname={applying.hostname}
          onClose={() => setApplying(null)}
          onSubmit={handleApplySubmit}
        />
      )}

      <CreateServerModal
        isOpen={!!create && !deploymentBlockReason}
        client={client}
        initial={create?.prefill ?? null}
        onClose={() => setCreate(null)}
        onSaveAsTemplate={(t) => { setCreate(null); setEditing({ template: t }) }}
        onCreated={(created) => {
          if (!create || !client) return
          startTemplateJob(client, { templateName: create.template.name, created, profileId, firewallRules: create.rules, tags: create.template.spec.tags })
          setNotice(`Create requested for ${created.name}.${create.rules.length ? ' Firewall rules follow once the build finishes.' : ''}`)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const Stat: React.FC<{ label: string; value?: React.ReactNode; muted?: boolean }> = ({ label, value, muted }) => (
  <div className="px-3 py-2 rounded border border-[#e9ecef] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529]">
    <div className="text-[10px] uppercase tracking-wide text-[#6c757d] dark:text-slate-500">{label}</div>
    <div className={`text-xs font-mono truncate ${muted || value === undefined ? 'text-[#adb5bd]' : 'text-[#212529] dark:text-white'}`}>{value ?? 'form default'}</div>
  </div>
)

const TemplateDetail: React.FC<{
  item: ListedServerTemplate
  servers: Server[]
  onApply: () => void
  applyBlockReason: string | null
  editBlockReason: string | null
  duplicateBlockReason: string | null
  deleteBlockReason: string | null
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
}> = ({
  item,
  servers,
  onApply,
  applyBlockReason,
  editBlockReason,
  duplicateBlockReason,
  deleteBlockReason,
  onEdit,
  onDuplicate,
  onExport,
  onDelete
}) => {
  const t = item.template
  const s = t.spec
  const vars = templateVariables(t)
  const backups = s.options ? [s.options.daily_backups ? `${s.options.daily_backups} daily` : '', s.options.weekly_backups ? `${s.options.weekly_backups} weekly` : '', s.options.monthly_backups ? `${s.options.monthly_backups} monthly` : ''].filter(Boolean) : []
  const source = t.source?.server_id ? servers.find((x) => x.id === t.source!.server_id) : undefined

  return (
    <div className="space-y-4">
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-[#212529] dark:text-white">{t.name}</h3>
              {item.builtin && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#f1ca00]/20 text-[#7a6500] dark:text-[#f1ca00]">STARTER</span>}
              {!item.builtin && (
                <SafetyPolicyBadge
                  scope="resource"
                  resourceKind="template"
                  resourceId={item.slug}
                  resourceLabel={t.name || item.slug}
                />
              )}
              {(t.labels ?? []).filter((l) => l !== 'starter').map((l) => <span key={l} className="px-1.5 py-0.5 rounded text-[10px] bg-[#e9ecef] dark:bg-[#373b3e] text-[#495057] dark:text-slate-300">{l}</span>)}
            </div>
            {t.description && <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-1 max-w-2xl">{t.description}</p>}
            {t.source?.server_name && (
              <p className="text-[11px] text-[#6c757d] dark:text-slate-500 mt-1">
                Captured from <span className="font-mono">{t.source.server_name}</span>{t.source.server_id ? ` #${t.source.server_id}` : ''}{t.source.captured_at ? ` on ${new Date(t.source.captured_at).toLocaleDateString()}` : ''}{source ? '' : t.source.server_id ? ' (no longer on this account)' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className={btnPrimary}
              onClick={onApply}
              disabled={!!item.error || !!applyBlockReason}
              title={applyBlockReason ?? 'Create a new server from this template'}
            >
              <Rocket className="w-3.5 h-3.5" />New server from this
            </button>
            {!item.builtin && (
              <button
                className={btn}
                onClick={onEdit}
                disabled={!!item.error || !!editBlockReason}
                title={editBlockReason ?? 'Edit template'}
              ><Pencil className="w-3.5 h-3.5" />Edit</button>
            )}
            <button
              className={btn}
              onClick={onDuplicate}
              disabled={!!item.error || !!duplicateBlockReason}
              title={duplicateBlockReason ?? (item.builtin ? 'Make a local copy' : 'Duplicate template')}
            ><Copy className="w-3.5 h-3.5" />{item.builtin ? 'Make mine' : 'Duplicate'}</button>
            <button className={btn} onClick={onExport} disabled={!!item.error}><Download className="w-3.5 h-3.5" />Export</button>
            {!item.builtin && (
              <button
                className={`${btn} border-rose-300 text-rose-600 hover:border-rose-500`}
                onClick={onDelete}
                disabled={!!deleteBlockReason}
                title={deleteBlockReason ?? 'Delete template'}
              ><Trash2 className="w-3.5 h-3.5" />Delete</button>
            )}
          </div>
        </div>
        {item.error && <p className="mt-3 text-xs text-rose-600">This file could not be read: {item.error}</p>}
      </div>

      <div className={`${card} p-5`}>
        <h4 className="text-xs font-bold text-[#212529] dark:text-white mb-3 flex items-center gap-1.5"><ServerIcon className="w-3.5 h-3.5 text-[#017cb6]" />Server</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Region" value={s.region} />
          <Stat label="Plan" value={s.size} />
          <Stat label="Image" value={s.image} />
          <Stat label="Memory / disk" value={s.options?.memory || s.options?.disk ? `${s.options?.memory ? `${s.options.memory} MB` : 'plan'} / ${s.options?.disk ? `${s.options.disk} GB` : 'plan'}` : undefined} />
          <Stat label="IPv4 addresses" value={s.options?.ipv4_addresses} />
          <Stat label="Backups" value={backups.length ? `${backups.join(', ')}${s.options?.offsite_backups ? ' + offsite' : ''}` : s.options ? 'none' : undefined} />
          <Stat label="VPC" value={s.vpc} />
          <Stat label="SSH keys" value={s.sshKeys?.length ? s.sshKeys.join(', ') : undefined} />
        </div>
        {s.tags?.length ? <p className="mt-3 text-xs text-[#6c757d] dark:text-slate-400">Tags applied locally: {s.tags.map((x) => <span key={x} className="font-mono text-[#212529] dark:text-white">@{x} </span>)}</p> : null}
      </div>

      <div className={`${card} p-5`}>
        <h4 className="text-xs font-bold text-[#212529] dark:text-white mb-3 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-[#017cb6]" />Firewall rules {s.firewallRules?.length ? <span className="text-[#6c757d] font-normal">({s.firewallRules.length}, applied top to bottom, first match wins)</span> : null}</h4>
        {s.firewallRules?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[#6c757d]"><th className="py-1 pr-3">Action</th><th className="py-1 pr-3">Proto</th><th className="py-1 pr-3">Ports</th><th className="py-1 pr-3">From</th><th className="py-1">Description</th></tr></thead>
              <tbody>
                {s.firewallRules.map((r, i) => (
                  <tr key={i} className="border-t border-[#e9ecef] dark:border-[#373b3e]">
                    <td className={`py-1.5 pr-3 font-semibold ${r.action === 'drop' ? 'text-rose-600' : 'text-emerald-600'}`}>{r.action}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.protocol}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.destination_ports?.join(', ') || 'any'}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.source_addresses.join(', ')}</td>
                    <td className="py-1.5 text-[#6c757d] dark:text-slate-400">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-[#6c757d]">None — the server keeps whatever BinaryLane's default is (everything open).</p>}
      </div>

      <div className={`${card} p-5`}>
        <h4 className="text-xs font-bold text-[#212529] dark:text-white mb-3 flex items-center gap-1.5"><Braces className="w-3.5 h-3.5 text-[#017cb6]" />Variables {vars.length ? <span className="text-[#6c757d] font-normal">({vars.length}, asked for when you apply)</span> : null}</h4>
        {vars.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {vars.map((v) => (
              <div key={v.name} className="px-3 py-2 rounded border border-[#e9ecef] dark:border-[#373b3e]">
                <div className="flex items-center gap-2"><span className="font-mono text-xs text-[#212529] dark:text-white">{'{{'}{v.name}{'}}'}</span>{v.secret && <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">secret</span>}{v.required === false && <span className="text-[10px] text-[#6c757d]">optional</span>}</div>
                <div className="text-[11px] text-[#6c757d] dark:text-slate-400">{v.label && v.label !== v.name ? `${v.label}. ` : ''}{v.description ?? ''}{v.default !== undefined && !v.secret ? <span className="font-mono"> default {v.default}</span> : null}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-[#6c757d]">None. <span className="font-mono">{'{{hostname}}'}</span> is always available.</p>}
      </div>

      <div className={`${card} p-5`}>
        <h4 className="text-xs font-bold text-[#212529] dark:text-white mb-3 flex items-center gap-1.5"><FileCode2 className="w-3.5 h-3.5 text-[#017cb6]" />Cloud-init</h4>
        {s.cloudInit ? (
          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre overflow-x-auto p-3 rounded bg-[#f8f9fa] dark:bg-[#212529] border border-[#e9ecef] dark:border-[#373b3e] text-[#212529] dark:text-slate-200 max-h-[32rem] overflow-y-auto">{s.cloudInit}</pre>
        ) : <p className="text-xs text-[#6c757d]">No user data. The server boots the stock image.</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const TemplateEditor: React.FC<{
  client: BinaryLaneClient | null
  initial: ServerTemplate
  isNew: boolean
  nameChangeBlockReason: string | null
  onCancel: () => void
  onSave: (t: ServerTemplate) => void | Promise<void>
}> = ({ client, initial, isNew, nameChangeBlockReason, onCancel, onSave }) => {
  const [t, setT] = useState<ServerTemplate>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const regions = (useRegions(client).data ?? []) as any[]
  const sizes = (useSizes(client).data ?? []) as any[]
  const images = (useDistributionImages(client).data ?? []) as any[]
  const vpcs = (useVpcs(client).data ?? []) as any[]
  const keys = (useSshKeys(client).data ?? []) as any[]

  const spec = (patch: Partial<ServerTemplate['spec']>) => setT((x) => ({ ...x, spec: { ...x.spec, ...patch } }))
  const opt = (patch: Partial<NonNullable<ServerTemplate['spec']['options']>>) => setT((x) => ({ ...x, spec: { ...x.spec, options: { ...(x.spec.options ?? {}), ...patch } } }))
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))

  const undeclared = extractVariables(t.spec.cloudInit).filter((n) => !(t.variables ?? []).some((v) => v.name === n))
  const rules = t.spec.firewallRules ?? []
  const setRule = (i: number, patch: Partial<FwRule>) => spec({ firewallRules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const vars = t.variables ?? []
  const setVar = (i: number, patch: Partial<TemplateVariable>) => setT((x) => ({ ...x, variables: vars.map((v, j) => (j === i ? { ...v, ...patch } : v)) }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!t.name.trim()) return setErr('Give the template a name.')
    if (t.spec.cloudInit && !/^#cloud-config|^#!|^#include|^Content-Type: multipart/i.test(t.spec.cloudInit.trimStart())) {
      return setErr('Cloud-init user data should start with "#cloud-config" (or a shebang for a plain script).')
    }
    setBusy(true)
    setErr(null)
    Promise.resolve(onSave({ ...t, name: t.name.trim(), variables: vars.length ? vars : undefined, spec: { ...t.spec, firewallRules: rules.length ? rules : undefined, tags: t.spec.tags?.length ? t.spec.tags : undefined, sshKeys: t.spec.sshKeys?.length ? t.spec.sshKeys : undefined, vpc: t.spec.vpc || undefined, cloudInit: t.spec.cloudInit?.trim() ? t.spec.cloudInit : undefined } }))
      // The store can reject a save (invalid document, name clash, unwritable directory);
      // show that here, in the dialog the user is looking at, not behind it.
      .catch((x: any) => setErr(x?.message || 'Could not save the template.'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      title={isNew ? 'New template' : `Edit “${initial.name}”`}
      icon={LayoutTemplate}
      onClose={onCancel}
      size="xl"
      as="form"
      onSubmit={submit}
      busy={busy}
      footer={
        <div className="flex items-center justify-between gap-3 p-4">
          <span className="text-xs text-rose-600">{err}</span>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={onCancel}>Cancel</button>
            <button type="submit" className={btnPrimary} disabled={busy}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}Save template</button>
          </div>
        </div>
      }
    >
      <div className="p-4 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3">
          <div>
            <label className={label}>Name</label>
            <input
              className={input}
              value={t.name}
              onChange={(e) => setT({ ...t, name: e.target.value })}
              placeholder="Web server"
              autoFocus
              disabled={!!nameChangeBlockReason}
              data-safety-template-rename={nameChangeBlockReason ? 'blocked' : 'allowed'}
              title={nameChangeBlockReason
                ? `${nameChangeBlockReason} Template renaming is available only at the Normal tier.`
                : 'Template name'}
            />
            {nameChangeBlockReason && (
              <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                This tier keeps the template name fixed so its saved protection cannot be bypassed by renaming it.
              </p>
            )}
          </div>
          <div>
            <label className={label}>Description</label>
            <input className={input} value={t.description ?? ''} onChange={(e) => setT({ ...t, description: e.target.value })} placeholder="What this builds and when to use it" />
          </div>
          <div>
            <label className={label}>Labels</label>
            <input className={input} value={(t.labels ?? []).join(', ')} onChange={(e) => setT({ ...t, labels: csv(e.target.value) })} placeholder="web, hardened" />
          </div>
          <div>
            <label className={label}>Tags to apply (local, @name in the palette)</label>
            <input className={input} value={(t.spec.tags ?? []).join(', ')} onChange={(e) => spec({ tags: csv(e.target.value) })} placeholder="web, prod" />
          </div>
        </div>

        <section>
          <h4 className="text-xs font-bold text-[#212529] dark:text-white mb-2 flex items-center gap-1.5"><ServerIcon className="w-3.5 h-3.5 text-[#017cb6]" />Server</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={label}>Region</label>
              <select className={input} value={t.spec.region ?? ''} onChange={(e) => spec({ region: e.target.value || undefined })}>
                <option value="">form default</option>
                {regions.map((r) => <option key={r.slug} value={r.slug}>{r.name ?? r.slug}</option>)}
                {t.spec.region && !regions.some((r) => r.slug === t.spec.region) && <option value={t.spec.region}>{t.spec.region}</option>}
              </select>
            </div>
            <div>
              <label className={label}>Plan</label>
              <select className={input} value={t.spec.size ?? ''} onChange={(e) => spec({ size: e.target.value || undefined })}>
                <option value="">form default</option>
                {sizes.map((s) => <option key={s.slug} value={s.slug}>{s.slug}</option>)}
                {t.spec.size && !sizes.some((s) => s.slug === t.spec.size) && <option value={t.spec.size}>{t.spec.size}</option>}
              </select>
            </div>
            <div>
              <label className={label}>Image</label>
              <select className={input} value={t.spec.image ?? ''} onChange={(e) => spec({ image: e.target.value || undefined })}>
                <option value="">form default</option>
                {images.map((i) => <option key={i.slug} value={i.slug}>{i.slug}</option>)}
                {t.spec.image && !images.some((i) => i.slug === t.spec.image) && <option value={t.spec.image}>{t.spec.image}</option>}
              </select>
            </div>
            <div>
              <label className={label}>VPC (by name)</label>
              <select className={input} value={t.spec.vpc ?? ''} onChange={(e) => spec({ vpc: e.target.value || undefined })}>
                <option value="">none</option>
                {vpcs.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                {t.spec.vpc && !vpcs.some((v) => v.name === t.spec.vpc) && <option value={t.spec.vpc}>{t.spec.vpc} (not on this account)</option>}
              </select>
            </div>
            <div>
              <label className={label}>Memory MB</label>
              <input className={input} inputMode="numeric" value={t.spec.options?.memory ?? ''} onChange={(e) => opt({ memory: num(e.target.value) })} placeholder="plan" />
            </div>
            <div>
              <label className={label}>Disk GB</label>
              <input className={input} inputMode="numeric" value={t.spec.options?.disk ?? ''} onChange={(e) => opt({ disk: num(e.target.value) })} placeholder="plan" />
            </div>
            <div>
              <label className={label}>IPv4 addresses</label>
              <input className={input} inputMode="numeric" value={t.spec.options?.ipv4_addresses ?? ''} onChange={(e) => opt({ ipv4_addresses: num(e.target.value) })} placeholder="1" />
            </div>
            <div>
              <label className={label}>Backups daily / weekly / monthly</label>
              <div className="flex gap-1">
                <input className={input} inputMode="numeric" value={t.spec.options?.daily_backups ?? ''} onChange={(e) => opt({ daily_backups: num(e.target.value) })} placeholder="0" />
                <input className={input} inputMode="numeric" value={t.spec.options?.weekly_backups ?? ''} onChange={(e) => opt({ weekly_backups: num(e.target.value) })} placeholder="0" />
                <input className={input} inputMode="numeric" value={t.spec.options?.monthly_backups ?? ''} onChange={(e) => opt({ monthly_backups: num(e.target.value) })} placeholder="0" />
              </div>
            </div>
            <label className="col-span-2 md:col-span-4 flex items-center gap-2 text-xs text-[#212529] dark:text-white">
              <input type="checkbox" checked={!!t.spec.options?.offsite_backups} onChange={(e) => opt({ offsite_backups: e.target.checked })} />Offsite backups
              <span className="text-[#6c757d] dark:text-slate-400">(needs at least one daily, weekly or monthly slot)</span>
            </label>
            <div className="col-span-2 md:col-span-4">
              <label className={label}>SSH keys (by name)</label>
              <div className="flex flex-wrap gap-2">
                {keys.map((k) => (
                  <label key={k.id} className="flex items-center gap-1.5 text-xs text-[#212529] dark:text-white">
                    <input type="checkbox" checked={(t.spec.sshKeys ?? []).includes(k.name)} onChange={(e) => spec({ sshKeys: e.target.checked ? [...(t.spec.sshKeys ?? []), k.name] : (t.spec.sshKeys ?? []).filter((n) => n !== k.name) })} />{k.name}
                  </label>
                ))}
                {(t.spec.sshKeys ?? []).filter((n) => !keys.some((k) => k.name === n)).map((n) => <span key={n} className="text-xs text-amber-600">{n} (not on this account)</span>)}
                {!keys.length && <span className="text-xs text-[#6c757d]">None on the account; the form picks the default key.</span>}
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-[#212529] dark:text-white flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-[#017cb6]" />Firewall rules <span className="font-normal text-[#6c757d]">— first match wins; end with a drop or everything else is allowed</span></h4>
            <button type="button" className={btn} onClick={() => spec({ firewallRules: [...rules, { action: 'accept', protocol: 'tcp', destination_ports: ['22'], source_addresses: ['0.0.0.0/0', '::/0'], destination_addresses: ['0.0.0.0/0', '::/0'], description: '' }] })}><Plus className="w-3 h-3" />Rule</button>
          </div>
          {rules.length ? (
            <div className="space-y-1.5">
              {rules.map((r, i) => (
                <div key={i} className="grid grid-cols-[80px_80px_1fr_1.4fr_1.4fr_28px] gap-1.5 items-center">
                  <select className={input} value={r.action} onChange={(e) => setRule(i, { action: e.target.value })}><option value="accept">accept</option><option value="drop">drop</option></select>
                  <select className={input} value={r.protocol} onChange={(e) => setRule(i, { protocol: e.target.value, destination_ports: e.target.value === 'icmp' || e.target.value === 'all' ? null : r.destination_ports })}><option value="tcp">tcp</option><option value="udp">udp</option><option value="icmp">icmp</option><option value="all">all</option></select>
                  <input className={input} value={r.destination_ports?.join(', ') ?? ''} disabled={r.protocol === 'icmp' || r.protocol === 'all'} onChange={(e) => setRule(i, { destination_ports: csv(e.target.value) })} placeholder="ports" />
                  <input className={input} value={r.source_addresses.join(', ')} onChange={(e) => setRule(i, { source_addresses: csv(e.target.value) })} placeholder="from: 0.0.0.0/0, {{admin_cidr}}" />
                  <input className={input} value={r.description ?? ''} onChange={(e) => setRule(i, { description: e.target.value })} placeholder="description" />
                  <button type="button" className="text-[#6c757d] hover:text-rose-600" onClick={() => spec({ firewallRules: rules.filter((_, j) => j !== i) })}><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-[#6c757d]">No rules: the server is created with BinaryLane's default (open).</p>}
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-[#212529] dark:text-white flex items-center gap-1.5"><Braces className="w-3.5 h-3.5 text-[#017cb6]" />Variables <span className="font-normal text-[#6c757d]">— write {'{{name}}'} anywhere in the cloud-init or firewall rules; {'{{hostname}}'} is built in</span></h4>
            <div className="flex gap-2">
              {undeclared.length > 0 && <button type="button" className={btn} onClick={() => setT((x) => ({ ...x, variables: [...(x.variables ?? []), ...undeclared.map((name) => ({ name, required: true }))] }))}><Wand2 className="w-3 h-3" />Declare {undeclared.join(', ')}</button>}
              <button type="button" className={btn} onClick={() => setT((x) => ({ ...x, variables: [...(x.variables ?? []), { name: '', required: true }] }))}><Plus className="w-3 h-3" />Variable</button>
            </div>
          </div>
          {vars.length ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[1fr_1fr_1.6fr_1fr_60px_60px_28px] gap-1.5 text-[10px] uppercase tracking-wide text-[#6c757d] px-0.5"><span>name</span><span>label</span><span>description</span><span>default</span><span>secret</span><span>required</span><span /></div>
              {vars.map((v, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1.6fr_1fr_60px_60px_28px] gap-1.5 items-center">
                  <input className={`${input} font-mono`} value={v.name} onChange={(e) => setVar(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })} placeholder="db_password" />
                  <input className={input} value={v.label ?? ''} onChange={(e) => setVar(i, { label: e.target.value })} placeholder="Database password" />
                  <input className={input} value={v.description ?? ''} onChange={(e) => setVar(i, { description: e.target.value })} placeholder="Shown under the field" />
                  <input className={input} value={v.secret ? '' : (v.default ?? '')} disabled={!!v.secret} onChange={(e) => setVar(i, { default: e.target.value })} placeholder={v.secret ? 'never stored' : 'optional'} />
                  <input type="checkbox" className="justify-self-center" checked={!!v.secret} onChange={(e) => setVar(i, { secret: e.target.checked, default: e.target.checked ? undefined : v.default })} />
                  <input type="checkbox" className="justify-self-center" checked={v.required !== false} onChange={(e) => setVar(i, { required: e.target.checked })} />
                  <button type="button" className="text-[#6c757d] hover:text-rose-600" onClick={() => setT((x) => ({ ...x, variables: vars.filter((_, j) => j !== i) }))}><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-[#6c757d]">None declared{undeclared.length ? `; the cloud-init uses ${undeclared.map((u) => `{{${u}}}`).join(', ')}, which will be asked for anyway` : ''}.</p>}
        </section>

        <section>
          <h4 className="text-xs font-bold text-[#212529] dark:text-white mb-2 flex items-center gap-1.5"><FileCode2 className="w-3.5 h-3.5 text-[#017cb6]" />Cloud-init user data</h4>
          <textarea
            value={t.spec.cloudInit ?? ''}
            onChange={(e) => spec({ cloudInit: e.target.value })}
            rows={12}
            spellCheck={false}
            placeholder={'#cloud-config\npackages:\n  - nginx\nruncmd:\n  - echo "{{hostname}} ready"'}
            className="w-full px-3 py-2 text-[11px] font-mono leading-relaxed bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
          />
          <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-1">Anything Ansible would do on a fresh box can be done here at first boot: packages, files, users, services, scripts. Runs once, as root, on images that support user data.</p>
        </section>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Apply: variables prompt
// ---------------------------------------------------------------------------

const ApplyTemplateModal: React.FC<{
  template: ServerTemplate
  initialHostname: string
  onClose: () => void
  onSubmit: (hostname: string, values: Record<string, string>) => void
}> = ({ template, initialHostname, onClose, onSubmit }) => {
  const vars = templateVariables(template)
  const [hostname, setHostname] = useState(initialHostname)
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(vars.map((v) => [v.name, v.default ?? ''])))
  const [err, setErr] = useState<string | null>(null)
  const missing = vars.filter((v) => v.required !== false && !values[v.name]?.trim())

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!hostname.trim()) return setErr('The new server needs a hostname.')
    if (missing.length) return setErr(`Fill in ${missing.map((m) => m.label || m.name).join(', ')}.`)
    onSubmit(hostname.trim(), values)
  }

  return (
    <Modal
      title={`New server from “${template.name}”`}
      icon={Rocket}
      onClose={onClose}
      size="md"
      as="form"
      onSubmit={submit}
      footer={
        <div className="flex items-center justify-between gap-3 p-4">
          <span className="text-xs text-rose-600">{err}</span>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={onClose}>Cancel</button>
            <button type="submit" className={btnPrimary}>Continue to create</button>
          </div>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <p className="text-xs text-[#6c757d] dark:text-slate-400">{describeTemplate(template)}. The create form opens next with everything filled in, so you can still change your mind before anything is built.</p>
        <div>
          <label className={label}>Hostname</label>
          <input className={input} value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="web-01" autoFocus />
        </div>
        {vars.map((v) => (
          <div key={v.name}>
            <label className={label}>{v.label || v.name}{v.required === false ? <span className="normal-case font-normal"> (optional)</span> : null}</label>
            <div className="flex gap-1.5">
              <input
                className={`${input} ${v.secret ? '' : 'font-mono'}`}
                type={v.secret ? 'password' : 'text'}
                value={values[v.name] ?? ''}
                onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
                autoComplete="off"
              />
              {v.secret && <button type="button" className={btn} onClick={() => setValues({ ...values, [v.name]: randomSecret() })} title="Generate a random value"><Wand2 className="w-3.5 h-3.5" /></button>}
            </div>
            {v.description && <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">{v.description}</p>}
            {v.secret && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">Goes into the server's user data only. Copy it somewhere safe now; BLDesk does not keep it.</p>}
          </div>
        ))}
        {template.spec.firewallRules?.length ? (
          <p className="text-[11px] text-[#6c757d] dark:text-slate-400">After BinaryLane accepts the create, BLDesk waits for the build and applies the {template.spec.firewallRules.length} firewall rule{template.spec.firewallRules.length === 1 ? '' : 's'}{template.spec.tags?.length ? ` and tags it ${template.spec.tags.map((x) => `@${x}`).join(' ')}` : ''}. That lands in History.</p>
        ) : null}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Paste import
// ---------------------------------------------------------------------------

const PasteImportModal: React.FC<{ onClose: () => void; onImport: (text: string) => Promise<void> }> = ({ onClose, onImport }) => {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    onImport(text).catch((x) => setErr(x?.message || 'Import failed.')).finally(() => setBusy(false))
  }
  return (
    <Modal title="Paste a template" icon={ClipboardPaste} onClose={onClose} size="lg" as="form" onSubmit={submit} busy={busy}
      footer={<div className="flex items-center justify-between gap-3 p-4"><span className="text-xs text-rose-600">{err}</span><div className="flex gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="submit" className={btnPrimary} disabled={busy || !text.trim()}>Import</button></div></div>}>
      <div className="p-4">
      <p className="text-xs text-[#6c757d] dark:text-slate-400 mb-2">A template or bundle exported from BLDesk, or plain cloud-init starting with <span className="font-mono">#cloud-config</span> (it becomes a cloud-init-only template you can flesh out).</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} spellCheck={false} className="w-full px-3 py-2 text-[11px] font-mono bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white" autoFocus />
      </div>
    </Modal>
  )
}
