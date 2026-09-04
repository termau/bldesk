import React, { useEffect, useRef, useState } from 'react'
import { Globe, Plus, Trash2, Search, RefreshCw, Loader2, X, ChevronLeft, ChevronRight, ExternalLink, AlertCircle } from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useDomains, useDomainRecords, useLocalNameservers } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { describeApiError } from '../../api/queries'
import { recordChange, updateChange } from '../../lib/changelog'
import { describeDnsRecord } from '../../lib/diff'
import { SafetyPolicyBadge } from '../ui/SafetyPolicyBadge'

interface DnsManagerProps {
  client: BinaryLaneClient | null
}

/**
 * Whether a zone's authority actually points at BinaryLane.
 *
 * The API has no "registered here" flag — there are no registrar endpoints at
 * all — so the only distinction available is whether `current_nameservers`
 * resolve to BinaryLane's own. A zone can exist here with authority still
 * delegated elsewhere, in which case edits have no effect on live resolution,
 * which is worth showing.
 */
function delegationState(
  domain: { current_nameservers?: string[] | null },
  localNameservers: string[]
): 'delegated' | 'external' | 'unknown' {
  const current = (domain.current_nameservers || []).map((n) => n.toLowerCase().replace(/\.$/, ''))
  if (current.length === 0) return 'unknown'
  if (localNameservers.length === 0) return 'unknown'
  const local = localNameservers.map((n) => n.toLowerCase().replace(/\.$/, ''))
  return current.some((n) => local.includes(n)) ? 'delegated' : 'external'
}

const DelegationBadge: React.FC<{
  domain: { current_nameservers?: string[] | null }
  localNameservers: string[]
}> = ({ domain, localNameservers }) => {
  const state = delegationState(domain, localNameservers)
  if (state === 'unknown') return null
  const isLocal = state === 'delegated'
  return (
    <span
      title={
        isLocal
          ? 'Authority is delegated to BinaryLane, so the records in this zone are the ones resolving.'
          : `Authority is elsewhere (${(domain.current_nameservers || []).join(', ')}). The records here exist but nothing is using them.`
      }
      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${
        isLocal
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
      }`}
    >
      {isLocal ? 'Live' : 'Not in use'}
    </span>
  )
}

/**
 * The domain's page in the web panel.
 *
 * Note the singular `/domain/`. No section suffix: the page opens on DNS records
 * by default and works whether the domain is registered with BinaryLane or only
 * hosted here for DNS — which matters because the API cannot tell those apart.
 *
 * mPanel is a SPA and answers 200 for any path under this prefix, so a wrong URL
 * opens the wrong page rather than failing visibly. Hence one helper.
 */
const domainWebUrl = (domain: string) => `https://home.binarylane.com.au/domain/${encodeURIComponent(domain)}`

const WEB_ONLY_FEATURES = [
  'Registrant details',
  'Domain lock',
  'Renew domain',
  'Cancel registration',
  'Domain password (AuthCode)'
]

const WebOnlyRegistration: React.FC<{ domain: string }> = ({ domain }) => (
  <div className="px-4 py-2.5 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-[11px] text-[#6c757d] dark:text-[#adb5bd]">
    <span>Managed on the web: </span>
    {WEB_ONLY_FEATURES.map((label, i) => (
      <React.Fragment key={label}>
        {i > 0 && <span className="opacity-50"> · </span>}
        <button
          onClick={() => window.bldeskApi?.openExternal?.(domainWebUrl(domain))}
          className="text-[#017cb6] dark:text-[#4db2e0] hover:underline"
        >
          {label}
        </button>
      </React.Fragment>
    ))}
    <ExternalLink className="w-3 h-3 inline-block ml-1 -mt-0.5 opacity-60" />
  </div>
)

const DOMAINS_PER_PAGE = 25

const MenuItem: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({
  onClick,
  disabled,
  children
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="w-full text-left px-3 py-1.5 hover:bg-[#017cb6]/10 text-[#212529] dark:text-slate-200 transition disabled:opacity-40 disabled:hover:bg-transparent"
  >
    {children}
  </button>
)

export const DnsManager: React.FC<DnsManagerProps> = ({ client }) => {
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [domainPage, setDomainPage] = useState(1)
  const [removeBusy, setRemoveBusy] = useState(false)

  useEffect(() => {
    setDomainPage(1)
  }, [searchTerm])
  const [isAddingRecord, setIsAddingRecord] = useState(false)
  const [recordType, setRecordType] = useState('A')
  const [recordName, setRecordName] = useState('@')
  const [recordData, setRecordData] = useState('')
  const [recordTtl] = useState(300)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const { resourceActionBlockReason, openSafetySettings } = useProfileSafety()
  const resourceActionBlockReasonRef = useRef(resourceActionBlockReason)
  resourceActionBlockReasonRef.current = resourceActionBlockReason
  const selectedDomainBlockReason = selectedDomain
    ? resourceActionBlockReason('domain', selectedDomain, 'maintenance')
    : null

  const ensureDomainActionAllowed = (
    domainName: string,
    operation: 'maintenance' | 'destructive',
    changeId?: string
  ): boolean => {
    const reason = resourceActionBlockReasonRef.current('domain', domainName, operation)
    if (!reason) {
      setActionError(null)
      return true
    }
    setActionError(reason)
    if (changeId) {
      void updateChange(changeId, {
        outcome: 'failed',
        detail: `Blocked locally before the request was sent: ${reason}`
      })
    }
    return false
  }

  const domainsQuery = useDomains(client)
  const nameserversQuery = useLocalNameservers(client)
  const [menu, setMenu] = useState<{ x: number; y: number; domain: any } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const localNameservers = nameserversQuery.data || []

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setMenu(null)
    setTimeout(() => setCopied(null), 1600)
  }
  const recordsQuery = useDomainRecords(client, selectedDomain)

  const domains = domainsQuery.data || []
  const records = recordsQuery.data || []

  const confirmAction = useConfirm()
  const handleSelectDomain = (domainName: string) => {
    setSelectedDomain(domainName)
  }

  const handleFlushCache = async () => {
    if (!client) return
    try {
      // history: n/a — asks BinaryLane's nameservers to reload; no record changes
      const { error } = await client.POST('/v2/domains/refresh_nameserver_cache')
      if (error) throw new Error(describeApiError(error))
      setActionError(null)
      window.bldeskApi?.sendNotification?.({
        title: 'DNS Cache Flushed',
        body: 'BinaryLane authoritative nameserver cache refreshed successfully.'
      })
    } catch (err: any) {
      setActionError(`DNS cache refresh failed: ${err.message || 'Unknown error'}`)
    }
  }

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client || !selectedDomain || !ensureDomainActionAllowed(selectedDomain, 'maintenance')) return

    setIsSubmitting(true)
    // The form is the review: a record add is small and shown in full, so it
    // is recorded rather than confirmed.
    const changeId = await recordChange({
      label: 'Add DNS record',
      target: { kind: 'domain', name: selectedDomain },
      severity: 'normal',
      changes: [{ label: `${recordType} ${recordName.trim()}`, to: recordData.trim() }],
      source: 'ui'
    })
    if (!ensureDomainActionAllowed(selectedDomain, 'maintenance', changeId)) {
      setIsSubmitting(false)
      return
    }
    try {
      const { error } = await client.POST('/v2/domains/{domain_name}/records', {
        params: { path: { domain_name: selectedDomain } },
        body: {
          type: recordType as any,
          name: recordName.trim(),
          data: recordData.trim(),
          ttl: Number(recordTtl)
        }
      })
      if (error) throw new Error(describeApiError(error))
      void updateChange(changeId, { outcome: 'completed' })
      setIsAddingRecord(false)
      setRecordName('@')
      setRecordData('')
      recordsQuery.refetch()
      window.bldeskApi?.sendNotification?.({
        title: 'DNS Record Added',
        body: `${recordType} record for ${recordName}.${selectedDomain} created.`
      })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to add DNS record: ${err.message || 'Unknown error'}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteRecord = async (recordId: number, name: string, type: string) => {
    if (!client || !selectedDomain || !ensureDomainActionAllowed(selectedDomain, 'maintenance')) return
    const rec = records.find((r: any) => r.id === recordId)
    const c = await confirmAction({
      title: 'Delete DNS record',
      target: { kind: 'domain', name: selectedDomain },
      summary: `Removes the ${type} record for "${name}". Resolvers keep the old answer until its TTL expires.`,
      severity: 'destructive',
      changes: [{ label: `${type} ${name}`, from: rec ? describeDnsRecord(rec) : `${name} ${type}`, to: undefined }],
      confirmLabel: 'Delete record'
    })
    if (!c.ok) return
    if (!ensureDomainActionAllowed(selectedDomain, 'maintenance', c.changeId)) return

    try {
      const { error } = await client.DELETE('/v2/domains/{domain_name}/records/{record_id}', {
        params: {
          path: {
            domain_name: selectedDomain,
            record_id: recordId
          }
        }
      })
      if (error) throw new Error(describeApiError(error))
      void updateChange(c.changeId, { outcome: 'completed' })
      recordsQuery.refetch()
      window.bldeskApi?.sendNotification?.({
        title: 'DNS Record Deleted',
        body: `Deleted ${type} record #${recordId}.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to delete DNS record: ${err.message || 'Unknown error'}`)
    }
  }

  /**
   * `DELETE /v2/domains/{domain_name}` drops the zone and every record in it,
   * with no undo and no export beyond what the operator has already copied —
   * so this is `irreversible` (type the domain) with "copy the zone file first"
   * offered inside the dialog.
   */
  const handleRemoveDnsHosting = async (domain: any) => {
    if (!client || !domain || !ensureDomainActionAllowed(domain.name, 'destructive')) return
    const recordCount = selectedDomain === domain.name ? records.length : undefined
    const c = await confirmAction({
      title: 'Remove DNS hosting',
      target: { kind: 'domain', name: domain.name },
      summary: `Deletes the DNS zone for ${domain.name}${typeof recordCount === 'number' ? ` and all ${recordCount} record${recordCount === 1 ? '' : 's'} in it` : ' and every record in it'}.`,
      severity: 'irreversible',
      notes: ['There is no undo. BinaryLane keeps no copy of a deleted zone, so the records cannot be recovered afterwards — they would have to be recreated by hand.'],
      extraAction: domain.zone_file ? { label: 'Copy the zone file first', onClick: () => copy('zone', domain.zone_file) } : undefined,
      confirmLabel: 'Remove DNS hosting'
    })
    if (!c.ok) return
    if (!ensureDomainActionAllowed(domain.name, 'destructive', c.changeId)) return
    setRemoveBusy(true)
    try {
      const { error } = await client.DELETE('/v2/domains/{domain_name}', {
        params: { path: { domain_name: domain.name } }
      })
      if (error) throw new Error(describeApiError(error))
      void updateChange(c.changeId, { outcome: 'completed' })

      // Clear anything pointing at the zone that no longer exists, then wait for
      // the refetch before closing: the dialog stays up until the list has
      // actually reloaded, so the row visibly disappears rather than the user
      // being left wondering whether it worked.
      if (selectedDomain === domain.name) setSelectedDomain(null)
      const { data: refreshed } = await domainsQuery.refetch()

      // Deleting the last entry on the final page would otherwise strand the
      // pager past the end, showing an empty list.
      const remaining = (refreshed || []).filter((d: any) =>
        d.name.toLowerCase().includes(searchTerm.toLowerCase())
      ).length
      const lastPage = Math.max(1, Math.ceil(remaining / DOMAINS_PER_PAGE))
      setDomainPage((p) => Math.min(p, lastPage))
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to remove DNS hosting: ${err.message || 'Unknown error'}`)
    } finally {
      setRemoveBusy(false)
    }
  }

  const filteredDomains = domains.filter((d) =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // All domains are fetched, then paged here rather than server-side, so the
  // filter above searches the whole account instead of just the visible page.
  const pageCount = Math.max(1, Math.ceil(filteredDomains.length / DOMAINS_PER_PAGE))
  const currentPage = Math.min(domainPage, pageCount)
  const visibleDomains = filteredDomains.slice(
    (currentPage - 1) * DOMAINS_PER_PAGE,
    currentPage * DOMAINS_PER_PAGE
  )
  const menuRemoveBlockReason = menu
    ? resourceActionBlockReason('domain', menu.domain.name, 'destructive')
    : null

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-[#017cb6]" />
            <span>DNS Zones & Domains</span>
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Manage authoritative DNS records across anycast nameservers with instant propagation.
          </p>
        </div>

        <button
          onClick={handleFlushCache}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
          title="Force nameserver cache flush (does not change DNS records)"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Flush DNS Cache</span>
        </button>
      </div>

      {actionError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          {selectedDomainBlockReason && selectedDomain && (
            <button
              type="button"
              onClick={() => openSafetySettings({ kind: 'domain', id: selectedDomain, label: selectedDomain })}
              className="shrink-0 font-semibold underline underline-offset-2"
            >
              Review safety
            </button>
          )}
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss message" className="shrink-0 opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1">
        {/* Domain List Sidebar */}
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f1f1f1] dark:bg-[#262a2e]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6c757d]" />
              <input
                type="text"
                placeholder="Filter domains..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white pl-8 pr-3 py-1.5 rounded focus:outline-none focus:border-[#017cb6]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
            {domainsQuery.isLoading && (
              <div className="p-4 text-center text-xs text-[#6c757d]">Loading domains...</div>
            )}

            {!domainsQuery.isLoading && filteredDomains.length === 0 && (
              <div className="p-6 text-center text-xs text-[#6c757d]">No DNS zones found</div>
            )}

            {visibleDomains.map((domain) => {
              const isSelected = selectedDomain === domain.name
              return (
                <div
                  key={domain.name}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, domain })
                  }}
                  className={`w-full text-left p-3 text-xs transition flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-[#017cb6]/10 text-[#017cb6] font-semibold border-l-4 border-[#017cb6]'
                      : 'hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] text-[#212529] dark:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectDomain(domain.name)}
                    className="min-w-0 flex-1 truncate text-left font-mono focus:outline-none focus:underline"
                  >
                    {domain.name}
                  </button>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <SafetyPolicyBadge
                      scope="resource"
                      resourceKind="domain"
                      resourceId={domain.name}
                      resourceLabel={domain.name}
                    />
                    <DelegationBadge domain={domain} localNameservers={localNameservers} />
                    <span className="text-[10px] text-[#6c757d]">TTL {domain.ttl}s</span>
                  </span>
                </div>
              )
            })}

            {filteredDomains.length > DOMAINS_PER_PAGE && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-[10px] text-[#6c757d] dark:text-[#adb5bd]">
                <span>
                  {(currentPage - 1) * DOMAINS_PER_PAGE + 1}&ndash;
                  {Math.min(currentPage * DOMAINS_PER_PAGE, filteredDomains.length)} of {filteredDomains.length}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => setDomainPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                    className="p-1 rounded border border-[#ced4da] dark:border-[#373b3e] hover:border-[#017cb6] transition disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="font-mono px-1">
                    {currentPage} / {pageCount}
                  </span>
                  <button
                    onClick={() => setDomainPage((p) => Math.min(pageCount, p + 1))}
                    disabled={currentPage >= pageCount}
                    aria-label="Next page"
                    className="p-1 rounded border border-[#ced4da] dark:border-[#373b3e] hover:border-[#017cb6] transition disabled:opacity-40"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* DNS Records Panel */}
        <div className="md:col-span-2 bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm flex flex-col overflow-hidden">
          {selectedDomain ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f1f1f1] dark:bg-[#262a2e] flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-[#212529] dark:text-white font-mono">
                    {selectedDomain}
                  </h3>
                  <span className="text-[11px] text-[#6c757d] dark:text-slate-400">
                    {records.length} {records.length === 1 ? 'record' : 'records'} configured
                  </span>
                </div>

                <button
                  onClick={() => setIsAddingRecord(true)}
                  disabled={!!selectedDomainBlockReason}
                  title={selectedDomainBlockReason ?? 'Add DNS record'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Record</span>
                </button>
              </div>

              {/* What lives on the web only.
                  The API has no registrar surface at all — no registrant, lock,
                  renewal, transfer or AuthCode endpoints exist — so these can't be
                  built here. Naming them is still worth it: otherwise the absence
                  reads as a missing feature and people go looking. Rendered as
                  links, deliberately not tabs, so nothing looks interactive. */}
              <WebOnlyRegistration domain={selectedDomain} />

              {/* Records Table */}
              <div className="flex-1 overflow-y-auto">
                {recordsQuery.isLoading && (
                  <div className="p-8 text-center text-xs text-[#6c757d]">Loading records...</div>
                )}

                {!recordsQuery.isLoading && records.length === 0 && (
                  <div className="p-8 text-center text-xs text-[#6c757d]">
                    No custom DNS records in this zone yet.
                  </div>
                )}

                {!recordsQuery.isLoading && records.length > 0 && (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-[#6c757d] font-medium">
                        <th className="py-2 px-4 w-20">Type</th>
                        <th className="py-2 px-4">Name</th>
                        <th className="py-2 px-4">Target / Data</th>
                        <th className="py-2 px-4 w-16 text-center">TTL</th>
                        <th className="py-2 px-4 w-12 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
                      {records.map((r) => (
                        <tr key={r.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                          <td className="py-2 px-4">
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#017cb6]/10 text-[#017cb6]">
                              {r.type}
                            </span>
                          </td>
                          <td className="py-2 px-4 font-mono font-medium">{r.name}</td>
                          <td className="py-2 px-4 font-mono text-[#6c757d] dark:text-slate-300 break-all">
                            {r.data}
                          </td>
                          <td className="py-2 px-4 text-center font-mono text-[#6c757d]">{r.ttl}</td>
                          <td className="py-2 px-4 text-right">
                            <button
                              onClick={() => handleDeleteRecord(r.id, r.name, r.type)}
                              disabled={!!selectedDomainBlockReason}
                              className="text-[#6c757d] hover:text-rose-500 p-1 rounded transition disabled:cursor-not-allowed disabled:opacity-40"
                              title={selectedDomainBlockReason ?? 'Delete Record'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-[#6c757d]">
              <Globe className="w-8 h-8 text-[#6c757d]/50 mb-2" />
              <span>Select a domain zone on the left to manage records</span>
            </div>
          )}
        </div>
      </div>

      {/* Add Record Modal */}
      {isAddingRecord && selectedDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
              <h2 className="text-base font-bold text-[#212529] dark:text-white">
                Add DNS Record to {selectedDomain}
              </h2>
              <button onClick={() => setIsAddingRecord(false)} className="text-[#6c757d] hover:text-[#212529] dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRecord} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                    Record Type
                  </label>
                  <select
                    value={recordType}
                    onChange={(e) => setRecordType(e.target.value)}
                    className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                  >
                    <option value="A">A (IPv4)</option>
                    <option value="AAAA">AAAA (IPv6)</option>
                    <option value="CNAME">CNAME</option>
                    <option value="MX">MX</option>
                    <option value="TXT">TXT</option>
                    <option value="NS">NS</option>
                    <option value="SRV">SRV</option>
                    <option value="CAA">CAA</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                    Host / Subdomain
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="@ or www"
                    value={recordName}
                    onChange={(e) => setRecordName(e.target.value)}
                    className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded font-mono focus:outline-none focus:border-[#017cb6]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Target / Value
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 103.x.x.x or hostname.com"
                  value={recordData}
                  onChange={(e) => setRecordData(e.target.value)}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded font-mono focus:outline-none focus:border-[#017cb6]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingRecord(false)}
                  className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !!selectedDomainBlockReason}
                  title={selectedDomainBlockReason ?? 'Save DNS record'}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Record</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Right-click menu: the list is the only place a full domain name is on
          screen, and it is the thing most often needed elsewhere. */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div
            className="fixed z-50 min-w-[190px] bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-xl py-1 text-xs"
            style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 150) }}
          >
            <div className="px-3 py-1.5 font-mono text-[10px] text-[#6c757d] border-b border-[#ced4da] dark:border-[#373b3e] truncate">
              {menu.domain.name}
            </div>
            <MenuItem onClick={() => copy('name', menu.domain.name)}>Copy domain name</MenuItem>
            <MenuItem
              onClick={() => {
                // Registration (registrant details, domain lock, renewal, AuthCode)
                // has no API surface at all — the domains endpoints only cover DNS
                // zones and records — so these can only be managed on the web.
                window.bldeskApi?.openExternal?.(domainWebUrl(menu.domain.name))
                setMenu(null)
              }}
            >
              Manage registration on the web
            </MenuItem>
            <MenuItem
              onClick={() => copy('nameservers', (menu.domain.current_nameservers || []).join('\n'))}
              disabled={!(menu.domain.current_nameservers || []).length}
            >
              Copy nameservers
            </MenuItem>
            <MenuItem onClick={() => copy('zone', menu.domain.zone_file || '')} disabled={!menu.domain.zone_file}>
              Copy zone file
            </MenuItem>
            <div className="my-1 border-t border-[#ced4da] dark:border-[#373b3e]" />
            <button
              disabled={removeBusy || !!menuRemoveBlockReason}
              title={menuRemoveBlockReason ?? 'Remove DNS hosting'}
              onClick={() => {
                const d = menu.domain
                setMenu(null)
                void handleRemoveDnsHosting(d)
              }}
              className="w-full text-left px-3 py-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove DNS hosting...
            </button>
          </div>
        </>
      )}


      {copied && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-md bg-[#212529] text-white text-xs shadow-lg">
          Copied {copied === 'name' ? 'domain name' : copied === 'nameservers' ? 'nameservers' : 'zone file'}
        </div>
      )}
    </div>
  )
}
