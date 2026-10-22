import type { BinaryLaneClient } from '../api/client'
import { describeApiError } from '../api/errors'
import { recordChange, updateChange } from './changelog'
import { loadTags, saveTags, withTag } from './serverGroups'
import type { FwRule } from './firewallMatrix'
import { ruleSignature } from './firewallMatrix'
import { toRuleRequest } from './firewallRules'

/**
 * The part of "new server from template" that happens after BinaryLane accepts
 * the create: firewall rules and local tags. Rules can only be set once the
 * server exists, so the job waits for the build to finish. It lives outside
 * React so leaving the Templates tab does not abandon it; the tab subscribes
 * to show progress.
 */

export interface TemplateJob {
  id: string
  templateName: string
  serverId?: number
  serverName: string
  startedAt: string
  status: 'waiting' | 'applying' | 'done' | 'failed'
  detail: string
}

export const TEMPLATE_JOBS_EVENT = 'bldesk:template-jobs'

const jobs: TemplateJob[] = []

export function listTemplateJobs(): TemplateJob[] {
  return [...jobs]
}

export function dismissTemplateJob(id: string): void {
  const i = jobs.findIndex((j) => j.id === id)
  if (i >= 0) jobs.splice(i, 1)
  emit()
}

function emit(): void {
  try {
    window.dispatchEvent(new CustomEvent(TEMPLATE_JOBS_EVENT))
  } catch {
    // no window
  }
}

function set(job: TemplateJob, patch: Partial<TemplateJob>): void {
  Object.assign(job, patch)
  emit()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll until the server leaves `new`, or give up after `timeoutMs`. */
async function waitForBuild(client: BinaryLaneClient, serverId: number, timeoutMs: number, onTick: (status: string) => void): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let status = 'new'
  while (Date.now() < deadline) {
    const { data, error } = await client.GET('/v2/servers/{server_id}', { params: { path: { server_id: serverId } } })
    if (!error && data?.server?.status) {
      status = data.server.status
      if (status !== 'new') return status
    }
    onTick(status)
    await sleep(10000)
  }
  return status
}

export function startTemplateJob(
  client: BinaryLaneClient,
  input: {
    templateName: string
    created: { id?: number; name: string }
    profileId?: string
    firewallRules?: FwRule[]
    tags?: string[]
  }
): TemplateJob {
  const job: TemplateJob = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateName: input.templateName,
    serverId: input.created.id,
    serverName: input.created.name,
    startedAt: new Date().toISOString(),
    status: 'waiting',
    detail: 'Waiting for BinaryLane to accept the create.'
  }
  jobs.unshift(job)
  emit()
  void run(client, job, input)
  return job
}

async function run(
  client: BinaryLaneClient,
  job: TemplateJob,
  input: { templateName: string; created: { id?: number; name: string }; profileId?: string; firewallRules?: FwRule[]; tags?: string[] }
): Promise<void> {
  // The reference requires a destination on every rule; a template rule that names none is written as "any".
  const rules = (input.firewallRules ?? []).map(toRuleRequest)
  const tags = input.tags ?? []
  if (!rules.length && !tags.length) {
    set(job, { status: 'done', detail: 'Server requested. The template had no firewall rules or tags to apply.' })
    return
  }
  if (!input.created.id) {
    set(job, { status: 'failed', detail: 'BinaryLane did not return the new server’s id, so the firewall rules and tags were not applied. Set them from the server’s Firewall tab.' })
    return
  }
  const id = input.created.id

  if (tags.length && input.profileId) {
    let map = loadTags(input.profileId)
    for (const tag of tags) map = withTag(map, [id], tag, true)
    saveTags(input.profileId, map)
  }
  if (!rules.length) {
    set(job, { status: 'done', detail: `Tagged ${tags.join(', ')}.` })
    return
  }

  set(job, { status: 'waiting', detail: `Waiting for ${job.serverName} (#${id}) to finish building before applying ${rules.length} firewall rule${rules.length === 1 ? '' : 's'}…` })
  const status = await waitForBuild(client, id, 15 * 60 * 1000, (s) => set(job, { detail: `Server is “${s}”. Waiting to apply ${rules.length} firewall rule${rules.length === 1 ? '' : 's'}…` }))
  if (status === 'new') {
    set(job, { status: 'failed', detail: 'The server was still building after 15 minutes. Apply the rules from its Firewall tab.' })
    return
  }

  set(job, { status: 'applying', detail: `Applying ${rules.length} firewall rule${rules.length === 1 ? '' : 's'}…` })
  const changeId = await recordChange({
    label: 'Apply template firewall rules',
    target: { kind: 'server', id, name: job.serverName },
    severity: 'destructive',
    summary: `From template “${input.templateName}”${tags.length ? `; tagged ${tags.join(', ')}` : ''}`,
    diff: rules.map((r) => ({ kind: 'add' as const, text: ruleSignature(r) })),
    source: 'ui'
    // Entered against the account the server was built in: this runs for minutes, and the active account may change meanwhile.
  }, input.profileId)
  try {
    const { data, error, response } = await client.POST('/v2/servers/{server_id}/actions', {
      params: { path: { server_id: id } },
      body: { type: 'change_advanced_firewall_rules', firewall_rules: rules }
    })
    if (error || !response.ok) throw new Error(error ? describeApiError(error) : `BinaryLane answered HTTP ${response.status} with no reason.`)
    void updateChange(changeId, { outcome: 'completed', actionId: data?.action?.id, detail: `${rules.length} rule${rules.length === 1 ? '' : 's'} applied.` }, input.profileId)
    set(job, { status: 'done', detail: `${rules.length} firewall rule${rules.length === 1 ? '' : 's'} applied${tags.length ? ` and tagged ${tags.join(', ')}` : ''}.` })
  } catch (err: any) {
    void updateChange(changeId, { outcome: 'failed', detail: err?.message || String(err) }, input.profileId)
    set(job, { status: 'failed', detail: `Firewall rules were not applied: ${err?.message || err}. Set them from the server’s Firewall tab.` })
  }
}
