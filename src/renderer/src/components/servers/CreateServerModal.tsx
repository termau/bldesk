import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { LinkOut, TOS_URL, REFUND_URL } from '../ui/LinkOut'
import { recordChange, updateChange } from '../../lib/changelog'
import { X, Loader2, AlertTriangle, Check, ChevronDown, Plus } from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { components } from '@shared/api/schema'
import {
  useSizes,
  useRegions,
  useDistributionImages,
  useSshKeys,
  useVpcs,
  useCreateServerMutation,
  useAddSshKeyMutation
} from '../../api/queries'
import { logoForDistribution } from '../../lib/distroHelper'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { listServerTemplates, imageSupportsUserData, TEMPLATES_EVENT, TEMPLATE_KIND, type ServerTemplate, type CreateServerPrefill } from '../../lib/serverTemplates'
import {
  planMonthlyPrice,
  configuredCost,
  retentionOptionLabel,
  planUnavailableReason,
  isCapacityBlock,
  memoryChoices,
  diskChoices,
  billingTotal,
  compareVersionNames,
  type SizeLike
} from '../../lib/serverPricing'

/**
 * Create a server, laid out the way the web panel does it: pick a location and
 * operating system, then a plan, then settings.
 *
 * Two things this has to get right that a plain form does not:
 *
 * - **Availability.** A plan can be offered but out of stock in the chosen
 *   region, and an image's memory/storage minimums exclude plans outright. Both
 *   are shown rather than allowed to fail at submit.
 * - **Price.** `price_monthly` is the base; licensed images add a surcharge. See
 *   lib/serverPricing.ts — omitting it understates Windows by about half.
 */


/** Web-panel ordering, so the tiles don't reshuffle as the API's order changes. */
const DISTRO_ORDER = ['Ubuntu', 'Debian', 'cPanel+WHM', 'Windows', 'BYO', 'AlmaLinux', 'KDE', 'Rocky']

const PLAN_TYPE_ORDER = ['vps', 'hdd', 'cpu', 'ded']

interface CreateServerModalProps {
  isOpen: boolean
  onClose: () => void
  client: BinaryLaneClient | null
  /** Called once BinaryLane accepts the request; `id` is the new server when the API returned it. */
  onCreated?: (created: { id?: number; name: string }) => void
  /** Prefill from a server template (Templates tab). Names are resolved on this account once the lists load. */
  initial?: CreateServerPrefill | null
  /** Turn the form as it stands into a template draft in the Templates tab. */
  onSaveAsTemplate?: (draft: ServerTemplate) => void
}

export const CreateServerModal: React.FC<CreateServerModalProps> = ({ isOpen, onClose, client, onCreated, initial, onSaveAsTemplate }) => {
  const sizesQuery = useSizes(client)
  const regionsQuery = useRegions(client)
  const imagesQuery = useDistributionImages(client)
  const sshKeysQuery = useSshKeys(client)
  const vpcsQuery = useVpcs(client)
  const createServer = useCreateServerMutation(client)
  const addSshKey = useAddSshKeyMutation(client)
  const { resourceActionBlockReason } = useProfileSafety()
  const resourceActionBlockReasonRef = useRef(resourceActionBlockReason)
  resourceActionBlockReasonRef.current = resourceActionBlockReason

  const sizes = (sizesQuery.data || []) as SizeLike[]
  const regions = (regionsQuery.data || []) as any[]
  const images = (imagesQuery.data || []) as components['schemas']['Image'][]
  const sshKeys = (sshKeysQuery.data || []) as any[]
  const vpcs = (vpcsQuery.data || []) as any[]

  // --- selection ---
  const [region, setRegion] = useState('syd')
  const [distro, setDistro] = useState('Ubuntu')
  const [imageSlug, setImageSlug] = useState<string | null>(null)
  const [planType, setPlanType] = useState('vps')
  const [sizeSlug, setSizeSlug] = useState<string | null>(null)
  const [memoryMb, setMemoryMb] = useState<number | null>(null)
  const [diskGb, setDiskGb] = useState<number | null>(null)

  // --- settings ---
  const [showAll, setShowAll] = useState(false)
  const [hostname, setHostname] = useState('')
  const [vpcId, setVpcId] = useState<number | undefined>(undefined)
  const [selectedKeys, setSelectedKeys] = useState<number[]>([])
  const [ipCount, setIpCount] = useState(1)
  const [dailyBackups, setDailyBackups] = useState(0)
  const [weeklyBackups, setWeeklyBackups] = useState(0)
  const [monthlyBackups, setMonthlyBackups] = useState(0)
  const [offsiteBackups, setOffsiteBackups] = useState(false)
  const [simpleBackups, setSimpleBackups] = useState<'onsite' | 'both' | 'none'>('none')
  const [cloudInitOn, setCloudInitOn] = useState(false)
  const [cloudInit, setCloudInit] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [addKeyOpen, setAddKeyOpen] = useState(false)
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof listServerTemplates>>>([])

  // --- template prefill ---
  // Scalars land when the form opens; image, plan, VPC and keys are stored by
  // name in a template and resolve as each list arrives (they are cached, so
  // usually immediately). Memory/disk are consumed by the plan-reset effect
  // below so the plan's defaults do not overwrite the template's choice.
  const prefillRef = useRef<CreateServerPrefill | null>(null)
  useEffect(() => {
    if (!isOpen) {
      prefillRef.current = null
      return
    }
    if (!initial) return
    prefillRef.current = { ...initial }
    if (initial.hostname !== undefined) setHostname(initial.hostname)
    if (initial.region) setRegion(initial.region)
    if (initial.ipCount !== undefined) setIpCount(initial.ipCount)
    const hasBackupChoice = initial.dailyBackups !== undefined || initial.weeklyBackups !== undefined || initial.monthlyBackups !== undefined
    if (initial.dailyBackups !== undefined) setDailyBackups(initial.dailyBackups)
    if (initial.weeklyBackups !== undefined) setWeeklyBackups(initial.weeklyBackups)
    if (initial.monthlyBackups !== undefined) setMonthlyBackups(initial.monthlyBackups)
    if (initial.offsiteBackups !== undefined) setOffsiteBackups(initial.offsiteBackups)
    if (hasBackupChoice || initial.memory !== undefined || initial.disk !== undefined) setShowAll(true)
    if (initial.cloudInit !== undefined) {
      setCloudInit(initial.cloudInit)
      setCloudInitOn(!!initial.cloudInit.trim())
    }
    if (initial.sshKeyNames && initial.sshKeyNames.length === 0) setSelectedKeys([])
  }, [isOpen, initial])

  // Distributions present, in web-panel order, with anything unexpected appended
  // rather than dropped.
  const distros = useMemo(() => {
    const present = [...new Set(images.map((i) => i.distribution).filter(Boolean))] as string[]
    const ordered = DISTRO_ORDER.filter((d) => present.includes(d))
    return [...ordered, ...present.filter((d) => !DISTRO_ORDER.includes(d)).sort()]
  }, [images])

  const versions = useMemo(
    () =>
      images
        .filter((i) => i.distribution === distro && (!i.regions || i.regions.includes(region)))
        .sort((a, b) => compareVersionNames((a as any).name || a.slug || '', (b as any).name || b.slug || '')),
    [images, distro, region]
  )

  const image = useMemo(
    () => versions.find((v) => v.slug === imageSlug) || versions[0],
    [versions, imageSlug]
  )
  const acceptsUserData = imageSupportsUserData(image)

  useEffect(() => {
    if (!isOpen) return
    const refresh = () => {
      void listServerTemplates()
        .then((items) => setTemplates(items.filter((i) => !i.error && i.template.spec.cloudInit)))
        .catch((err) => setErrorMsg(err.message || 'Could not load templates.'))
    }
    refresh()
    window.addEventListener(TEMPLATES_EVENT, refresh)
    return () => window.removeEventListener(TEMPLATES_EVENT, refresh)
  }, [isOpen])

  // Resolve the template's names against this account's lists.
  useEffect(() => {
    const p = prefillRef.current
    if (!p || !isOpen) return
    if (p.imageSlug && images.length) {
      const img = images.find((i) => i.slug === p.imageSlug)
      if (img?.distribution) {
        setDistro(img.distribution)
        setImageSlug(img.slug ?? null)
      }
      p.imageSlug = undefined
    }
    if (p.sizeSlug && sizes.length) {
      const sz = sizes.find((x) => x.slug === p.sizeSlug)
      if (sz) {
        setPlanType(sz.size_type?.slug || 'vps')
        setSizeSlug(sz.slug)
      }
      p.sizeSlug = undefined
    }
    if (p.vpcName && vpcs.length) {
      const v = vpcs.find((x: any) => x.name === p.vpcName)
      if (v) setVpcId(v.id)
      p.vpcName = undefined
    }
    if (p.sshKeyNames?.length && sshKeys.length) {
      const ids = sshKeys.filter((k: any) => p.sshKeyNames!.includes(k.name)).map((k: any) => k.id)
      if (ids.length) setSelectedKeys(ids)
      p.sshKeyNames = undefined
    }
  }, [isOpen, images, sizes, vpcs, sshKeys])

  useEffect(() => {
    if (!acceptsUserData) setCloudInitOn(false)
  }, [acceptsUserData])

  const planTypes = useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of sizes) {
      const slug = s.size_type?.slug
      if (slug && !seen.has(slug)) seen.set(slug, s.size_type?.name || slug)
    }
    return [...PLAN_TYPE_ORDER.filter((t) => seen.has(t)), ...[...seen.keys()].filter((t) => !PLAN_TYPE_ORDER.includes(t))].map(
      (slug) => ({ slug, name: seen.get(slug) || slug })
    )
  }, [sizes])

  const plans = useMemo(
    () => sizes.filter((s) => (s.size_type?.slug || 'vps') === planType),
    [sizes, planType]
  )

  const selectedSize = useMemo(() => plans.find((p) => p.slug === sizeSlug), [plans, sizeSlug])

  /*
   * Distinct reasons why plans in this tab are unusable.
   *
   * The web panel shows this whenever ANY row is greyed out, not only when every
   * row is - and the per-row reason used to live in a `title` tooltip, which does
   * not exist on touch, so on Android a greyed row had no explanation at all.
   */
  const planBlocks = useMemo(() => {
    const seen = new Map<string, { kind: string; message: string }>()
    for (const p of plans) {
      const b = planUnavailableReason(p, region, image)
      if (b) seen.set(b.message, b)
    }
    return [...seen.values()]
  }, [plans, region, image?.slug])

  // Capacity gets the web panel's wording; an image minimum has to say so itself.
  const capacityOnly = planBlocks.length > 0 && planBlocks.every((b) => isCapacityBlock(b as any))

  // Keep the version choice valid when the distribution or region changes.
  useEffect(() => {
    if (!versions.length) return
    if (!versions.some((v) => v.slug === imageSlug)) setImageSlug(versions[0].slug || null)
  }, [versions, imageSlug])

  // Land on a plan that can actually be provisioned, rather than an empty table
  // or a pre-selected row the region has no stock for.
  useEffect(() => {
    if (!plans.length) return
    const current = plans.find((p) => p.slug === sizeSlug)
    if (current && !planUnavailableReason(current, region, image)) return
    const firstUsable = plans.find((p) => !planUnavailableReason(p, region, image))
    setSizeSlug(firstUsable?.slug ?? null)
  }, [plans, region, image?.slug, sizeSlug])

  // Reset plan-derived state whenever the plan changes.
  useEffect(() => {
    if (!selectedSize) return
    const p = prefillRef.current
    setMemoryMb(p?.memory ?? selectedSize.memory)
    setDiskGb(p?.disk ?? selectedSize.disk)
    if (p) {
      p.memory = undefined
      p.disk = undefined
    }
  }, [selectedSize?.slug])

  // Pre-select the account's default SSH key, as the web panel does.
  useEffect(() => {
    if (!sshKeys.length || selectedKeys.length) return
    const def = sshKeys.find((k: any) => k.default)
    if (def) setSelectedKeys([def.id])
  }, [sshKeys])

  const memory = memoryMb ?? selectedSize?.memory ?? 0
  const disk = diskGb ?? selectedSize?.disk ?? 0

  const monthly = useMemo(() => {
    if (!selectedSize) return 0
    return configuredCost({
      size: selectedSize,
      image,
      memoryMb: memory,
      diskGb: disk,
      ipCount,
      dailyBackups,
      weeklyBackups,
      monthlyBackups,
      offsiteBackups
    }).total
  }, [selectedSize, image, memory, disk, ipCount, dailyBackups, weeklyBackups, monthlyBackups, offsiteBackups])

  const { total: monthlyIncGst, gst } = billingTotal(monthly)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!hostname.trim()) return setErrorMsg('Enter a hostname for the server.')
    if (!image?.slug) return setErrorMsg('Choose an operating system.')
    if (!selectedSize) return setErrorMsg('Choose a plan.')
    const blocked = planUnavailableReason(selectedSize, region, image)
    if (blocked) return setErrorMsg(blocked.message)
    if (!agreed) return setErrorMsg('You need to accept the Terms of Service and refund policy.')
    const initialVpcBlockReason = vpcId === undefined
      ? null
      : resourceActionBlockReasonRef.current('vpc', vpcId, 'maintenance')
    if (initialVpcBlockReason) return setErrorMsg(`Blocked locally: ${initialVpcBlockReason}`)

    // The simple view collapses the three retention dropdowns into one choice.
    const daily = showAll ? dailyBackups : simpleBackups === 'none' ? 0 : 2
    const offsite = showAll ? offsiteBackups : simpleBackups === 'both'

    // The form is the review, so this records rather than confirms — and the
    // id must be resolved either side of the request or History says
    // "Submitted" forever (#23).
    const changeId = await recordChange({
      label: 'Create server',
      target: { kind: 'server', name: hostname.trim() },
      severity: 'normal',
      changes: [
        { label: 'Region', to: region },
        { label: 'Size', to: selectedSize.slug },
        { label: 'Image', to: image.slug }
      ],
      source: 'ui'
    })
    try {
      const currentVpcBlockReason = vpcId === undefined
        ? null
        : resourceActionBlockReasonRef.current('vpc', vpcId, 'maintenance')
      if (currentVpcBlockReason) {
        void updateChange(changeId, {
          outcome: 'failed',
          detail: `Blocked locally before the request was sent: ${currentVpcBlockReason}`
        })
        return setErrorMsg(`Blocked locally: ${currentVpcBlockReason}`)
      }
      const created = await createServer.mutateAsync({
        name: hostname.trim(),
        region,
        size: selectedSize.slug,
        image: image.slug,
        ssh_keys: selectedKeys.length ? selectedKeys : undefined,
        vpc_id: vpcId,
        options: {
          memory,
          disk,
          ipv4_addresses: ipCount,
          daily_backups: daily,
          weekly_backups: showAll ? weeklyBackups : 0,
          monthly_backups: showAll ? monthlyBackups : 0,
          offsite_backups: offsite
        },
        user_data: acceptsUserData && cloudInitOn && cloudInit.trim() ? cloudInit : undefined
      } as any)
      void updateChange(changeId, {
        outcome: 'completed',
        detail: created?.id ? `BinaryLane accepted the request; server #${created.id} is being built.` : 'BinaryLane accepted the request.'
      })
      onCreated?.({ id: created?.id, name: hostname.trim() })
      onClose()
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err?.message })
      setErrorMsg(err.message || 'Failed to create the server.')
    }
  }

  const loading = sizesQuery.isLoading || imagesQuery.isLoading || regionsQuery.isLoading

  /*
   * Rendered into document.body rather than in place.
   *
   * Mounted inside the server list, `fixed inset-0` did not resolve to the
   * viewport: the backdrop measured [0, 16, 1264, 785] against a viewport of
   * 1264x801, leaving the title bar undimmed. Computed top/right/bottom/left
   * were all 0px and no ancestor carried transform, filter, backdrop-filter,
   * will-change, contain, container-type or zoom, so the offset was never
   * identified. A portal removes the question: the backdrop becomes a child of
   * body with nothing above it to interfere. It is also the right place for a
   * modal regardless of this bug — AuthModal works precisely because it is
   * mounted at App level.
   *
   * The dialog owns a fixed frame and only its body scrolls; a sticky header
   * inside a scrolling wrapper leaves a strip above itself for content to pass
   * through.
   */
  return (
    <>
    <Modal title="Add a Cloud Server" onClose={onClose} size="xl" align="top" as="form" onSubmit={handleSubmit} busy={createServer.isPending} labelledBy="create-server-title">
        {loading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-xs text-[#6c757d]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading plans and images...
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-5">
            {/* ---------- 1. location and operating system ---------- */}
            <Section step={1} title="Select your location and operating system">
              <TileRow>
                {regions.map((r: any) => (
                  <Tile key={r.slug} selected={region === r.slug} onClick={() => setRegion(r.slug)} disabled={!r.available}>
                    {r.name}
                  </Tile>
                ))}
              </TileRow>

              <TileRow className="mt-3.5">
                {distros.map((d) => (
                  <Tile key={d} selected={distro === d} onClick={() => setDistro(d)} className="flex-col gap-2 py-3 px-5 min-w-[104px]">
                    <img
                      src={logoForDistribution(d)}
                      alt=""
                      className={`w-8 h-8 sm:w-11 sm:h-11 object-contain transition ${distro === d ? '' : 'grayscale opacity-60'}`}
                    />
                    <span>{d}</span>
                  </Tile>
                ))}
              </TileRow>

              {versions.length > 0 && (
                <>
                  <div className="text-sm font-semibold text-[#212529] dark:text-white mt-4 mb-2">Select Version</div>
                  <TileRow>
                    {versions.map((v) => (
                      <Tile key={v.slug} selected={image?.slug === v.slug} onClick={() => setImageSlug(v.slug || null)}>
                        {(v as any).name?.trim() || v.slug}
                      </Tile>
                    ))}
                  </TileRow>
                </>
              )}
            </Section>

            {/* ---------- 2. plan ---------- */}
            <Section step={2} title="Choose your Cloud Server resources">
              <TileRow>
                {planTypes.map((t) => (
                  <Tile key={t.slug} selected={planType === t.slug} onClick={() => setPlanType(t.slug)}>
                    {t.name}
                  </Tile>
                ))}
              </TileRow>

              {/*
                 * The plan table is wider than a phone. It scrolls inside its own
                 * box: with `overflow-hidden` the Transfer and Price columns were
                 * simply clipped and unreachable, and the row width still dragged
                 * the whole form sideways, which clipped the left edge of every
                 * label and dropdown below it.
                 */}
              <div className="mt-3 border border-[#ced4da] dark:border-[#373b3e] rounded overflow-x-auto">
                <table className="w-full text-[10px] sm:text-xs whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#f8f9fa] dark:bg-[#212529] text-[#6c757d] text-left">
                      <th className="py-1.5 px-1 sm:py-2 sm:px-3 font-semibold text-center">Processor</th>
                      <th className="py-1.5 px-1 sm:py-2 sm:px-3 font-semibold text-center">Memory</th>
                      <th className="py-1.5 px-1 sm:py-2 sm:px-3 font-semibold text-center">Storage</th>
                      <th className="py-1.5 px-1 sm:py-2 sm:px-3 font-semibold text-center">Transfer</th>
                      <th className="py-1.5 px-1 sm:py-2 sm:px-3 font-semibold text-center">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
                    {plans.map((p) => {
                      const blocked = planUnavailableReason(p, region, image)
                      const isSel = sizeSlug === p.slug
                      return (
                        <tr
                          key={p.slug}
                          onClick={() => !blocked && setSizeSlug(p.slug)}
                          title={blocked?.message || undefined}
                          className={`${
                            blocked
                              ? 'opacity-45 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]'
                          } ${isSel ? 'bg-[#017cb6]/10' : ''}`}
                        >
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-center">
                            <span className="flex items-center gap-1 sm:gap-2">
                              <Radio selected={isSel} blocked={!!blocked} />
                              <span className="text-[#212529] dark:text-white">
                                {p.vcpus} {p.vcpu_units || 'VCPU'}
                                {p.vcpus === 1 ? '' : 's'}
                              </span>
                            </span>
                          </td>
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-center">
                            {isSel && memoryChoices(p).length > 1 ? (
                              <Select value={memory} onChange={(v) => setMemoryMb(v)} options={memoryChoices(p).map((m) => ({ value: m, label: `${m / 1024} GB` }))} />
                            ) : (
                              <span className="text-[#212529] dark:text-white">{p.memory / 1024} GB</span>
                            )}
                          </td>
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-center">
                            {isSel && diskChoices(p).length > 1 ? (
                              <Select value={disk} onChange={(v) => setDiskGb(v)} options={diskChoices(p).map((d) => ({ value: d, label: `${d} GB` }))} />
                            ) : (
                              <span className="text-[#212529] dark:text-white">
                                {p.disk} GB{p.storage_description ? ` ${p.storage_description.trim()}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[#212529] dark:text-white">{p.transfer * 1000} GB</td>
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-right font-medium text-[#212529] dark:text-white">
                            ${planMonthlyPrice(p, image, isSel ? memory : p.memory, isSel ? disk : p.disk).toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {planBlocks.length > 0 && (
                  <div className="px-3 py-2 border-t border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-[11px] text-[#6c757d] dark:text-[#adb5bd] space-y-1">
                    {capacityOnly ? (
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500 mt-px" />
                        <span>We currently do not have resources available to provision a server on these plans.</span>
                      </div>
                    ) : (
                      planBlocks.map((b) => (
                        <div key={b.message} className="flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500 mt-px" />
                          <span>{b.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </Section>

            {/* ---------- 3. settings ---------- */}
            <Section
              step={3}
              title="Configure your server's settings"
              action={
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-[#6c757d] hover:bg-[#5c636a] text-white transition"
                >
                  {showAll ? 'Show Less' : 'View All'}
                </button>
              }
            >
              <Field label="Hostname" hint="Such as vps01.yourcompany.com. It does not matter if you do not yet own this domain name.">
                <input
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="server.example.com"
                  className="w-full max-w-sm px-2.5 py-1.5 text-xs bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
                />
              </Field>

              {!showAll ? (
                <Field label="Backups">
                  {(
                    [
                      ['onsite', `Onsite daily backups, stored for 2 days (+$${(2 * disk * (selectedSize?.options?.backups_cost_per_backup_per_gigabyte || 0)).toFixed(2)})`],
                      ['both', `Onsite and offsite daily backups, stored for 2 days (+$${(2 * disk * ((selectedSize?.options?.backups_cost_per_backup_per_gigabyte || 0) + (selectedSize?.options?.offsite_backups_cost_per_gigabyte || 0))).toFixed(2)})`],
                      ['none', 'Backups are not required']
                    ] as const
                  ).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" checked={simpleBackups === val} onChange={() => setSimpleBackups(val)} />
                      <span className="text-[#212529] dark:text-white">{label}</span>
                    </label>
                  ))}
                </Field>
              ) : (
                <>
                  <Field label="Network">
                    <TileRow>
                      <Tile selected={vpcId === undefined} onClick={() => setVpcId(undefined)}>
                        Public
                      </Tile>
                      {vpcs.map((v: any) => {
                        const vpcBlockReason = resourceActionBlockReason('vpc', v.id, 'maintenance')
                        return (
                          <Tile
                            key={v.id}
                            selected={vpcId === v.id}
                            disabled={!!vpcBlockReason}
                            title={vpcBlockReason ?? `Create in ${v.name}`}
                            onClick={() => setVpcId(v.id)}
                          >
                            {v.name}
                          </Tile>
                        )
                      })}
                    </TileRow>
                  </Field>

                  <Field label="SSH Keys" hint="Select your SSH key/s to deploy during installation, or add a new keypair.">
                    <TileRow>
                      {sshKeys.map((k: any) => {
                        const on = selectedKeys.includes(k.id)
                        return (
                          <Tile
                            key={k.id}
                            selected={on}
                            onClick={() =>
                              setSelectedKeys((prev) => (on ? prev.filter((x) => x !== k.id) : [...prev, k.id]))
                            }
                          >
                            {on && <Check className="w-3 h-3" />}
                            {k.name}
                          </Tile>
                        )
                      })}
                      <Tile selected={false} onClick={() => setAddKeyOpen(true)}>
                        <Plus className="w-3 h-3" /> Add SSH Key
                      </Tile>
                    </TileRow>
                  </Field>

                  <Field label="IP Addresses" hint="Additional IP addresses may be purchased for approved uses including multiple SSL certificates.">
                    <Select
                      value={ipCount}
                      onChange={setIpCount}
                      options={Array.from({ length: selectedSize?.options?.ipv4_addresses_max || 1 }, (_, i) => ({
                        value: i + 1,
                        label: i === 0 ? '1 IP address (included)' : `${i + 1} IP addresses (+$${(i * (selectedSize?.options?.ipv4_addresses_cost_per_address || 0)).toFixed(2)})`
                      }))}
                    />
                  </Field>

                  <Field label="Backups" hint="Automatic on-site backups are available daily, weekly, monthly, or any combination thereof.">
                    <div className="space-y-2">
                      {(
                        [
                          ['Daily backups', dailyBackups, setDailyBackups, 'daily'],
                          ['Weekly backups', weeklyBackups, setWeeklyBackups, 'weekly'],
                          ['Monthly backups', monthlyBackups, setMonthlyBackups, 'monthly']
                        ] as const
                      ).map(([label, value, setter, word]) => (
                        <div key={word}>
                          <div className="text-[11px] text-[#6c757d] dark:text-[#adb5bd] mb-1">{label}</div>
                          <Select
                            value={value}
                            onChange={setter as (v: number) => void}
                            options={Array.from({ length: 11 }, (_, n) => ({
                              value: n,
                              // Shared with Change Plan so the two cannot drift
                              // from the web panel's wording independently -
                              // this said "periods" for weekly and monthly.
                              label: retentionOptionLabel(word, n, disk, selectedSize)
                            }))}
                          />
                        </div>
                      ))}
                      <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={offsiteBackups}
                          disabled={dailyBackups + weeklyBackups + monthlyBackups === 0}
                          onChange={(e) => setOffsiteBackups(e.target.checked)}
                        />
                        <span className="text-[#212529] dark:text-white disabled:opacity-50">
                          Offsite Backups (requires on-site backups)
                        </span>
                      </label>
                    </div>
                  </Field>

                  <Field label="Cloud-init User Data" hint="Cloud-init user data can work with cloud-init on the operating system to provide automated setup of new software, configuration of preferred defaults, and general customization of the Cloud Server after install.">
                    {image && !acceptsUserData && <p className="text-xs text-amber-600 dark:text-amber-400">This image does not accept cloud-init user data.</p>}
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={cloudInitOn} disabled={!image || !acceptsUserData} onChange={(e) => setCloudInitOn(e.target.checked)} />
                      <span className="text-[#212529] dark:text-white">Enable Cloud-init User Data</span>
                    </label>
                    {cloudInitOn && (
                      <>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <select defaultValue="" onChange={(e) => { const item = templates.find((t) => t.slug === e.target.value); if (item?.template.spec.cloudInit) setCloudInit(item.template.spec.cloudInit); e.currentTarget.value = '' }} className="px-2.5 py-1.5 text-xs rounded border bg-white dark:bg-[#212529] border-[#ced4da] dark:border-[#373b3e]">
                            <option value="">Load cloud-init from template…</option>
                            {templates.map((item) => <option key={item.slug} value={item.slug}>{item.template.name}</option>)}
                          </select>
                          <span className="text-[11px] text-[#6c757d] dark:text-slate-400 self-center">Templates with variables are applied from the Templates tab, which fills them in.</span>
                        </div>
                        <textarea
                          value={cloudInit}
                          onChange={(e) => setCloudInit(e.target.value)}
                          rows={8}
                          spellCheck={false}
                          placeholder={'#cloud-config\npackages:\n  - nginx'}
                          className="mt-2 w-full px-2.5 py-2 text-[11px] font-mono bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
                        />
                      </>
                    )}
                  </Field>
                </>
              )}

              {/* billing */}
              <div className="mt-4 p-3 rounded border border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] text-xs space-y-2">
                <div className="font-bold text-sm text-[#212529] dark:text-white">Billing</div>
                <div className="flex gap-8">
                  <span className="text-[#6c757d] dark:text-[#adb5bd]">Monthly Total</span>
                  <span className="text-[#212529] dark:text-white">
                    ${monthlyIncGst.toFixed(2)} (incl. ${gst.toFixed(2)} GST)
                  </span>
                </div>
                <p className="text-[#6c757d] dark:text-[#adb5bd] leading-relaxed">
                  BinaryLane has no minimum contract length and you may cancel your Server any time.
                </p>
              </div>

              {onSaveAsTemplate && (
                <button
                  type="button"
                  onClick={() => onSaveAsTemplate({
                    kind: TEMPLATE_KIND,
                    name: hostname.trim() ? `${hostname.trim()} template` : 'New template',
                    created_at: new Date().toISOString(),
                    spec: {
                      region,
                      size: selectedSize?.slug,
                      image: image?.slug ?? undefined,
                      options: { memory, disk, ipv4_addresses: ipCount, daily_backups: showAll ? dailyBackups : simpleBackups === 'none' ? 0 : 2, weekly_backups: showAll ? weeklyBackups : 0, monthly_backups: showAll ? monthlyBackups : 0, offsite_backups: showAll ? offsiteBackups : simpleBackups === 'both' },
                      vpc: vpcId ? (vpcs.find((v: any) => v.id === vpcId)?.name as string | undefined) : undefined,
                      sshKeys: selectedKeys.length ? sshKeys.filter((k: any) => selectedKeys.includes(k.id)).map((k: any) => k.name as string) : undefined,
                      cloudInit: cloudInitOn && cloudInit.trim() ? cloudInit : undefined
                    }
                  })}
                  className="mt-3 text-xs text-[#017cb6] hover:underline"
                >
                  Save this form as a template instead
                </button>
              )}

              <label className="flex items-center gap-2 text-xs mt-3 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span className="text-[#212529] dark:text-white">
                  I agree to the{' '}
                  <LinkOut href={TOS_URL}>Terms of Service</LinkOut> and <LinkOut href={REFUND_URL}>refund policy</LinkOut>.
                </span>
              </label>

              {errorMsg && (
                <div className="mt-3 flex items-start gap-2 p-2.5 rounded border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span className="break-words">{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={createServer.isPending}
                className="mt-3 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded bg-[#017cb6] hover:bg-[#016594] text-white transition disabled:opacity-50"
              >
                {createServer.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {createServer.isPending ? 'Creating...' : 'Add Server'}
              </button>
            </Section>
          </div>
        )}
    </Modal>

      {addKeyOpen && (
        <AddSshKeyDialog
          onCancel={() => setAddKeyOpen(false)}
          onCreate={async (name, publicKey, makeDefault) => {
            await addSshKey.mutateAsync({ name, public_key: publicKey, default: makeDefault } as any)
            await sshKeysQuery.refetch()
            setAddKeyOpen(false)
          }}
        />
      )}
    </>
  )
}

// ---------- presentational helpers ----------

const Section: React.FC<{ step: number; title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  step,
  title,
  action,
  children
}) => (
  <section>
    <div className="flex items-center justify-between gap-3 mb-2">
      <h4 className="flex items-center gap-2 text-sm font-bold text-[#017cb6]">
        <span className="w-5 h-5 shrink-0 rounded-full bg-[#f1ca00] text-[#212529] text-[11px] font-bold flex items-center justify-center">
          {step}
        </span>
        {title}
      </h4>
      {action}
    </div>
    <div className="p-3 rounded border border-[#ced4da] dark:border-[#373b3e]">{children}</div>
  </section>
)

/*
 * Tiles wrap as an even grid on a phone and only fall back to free-flowing wrap
 * once there is room. `flex flex-wrap` alone left ragged, left-bunched rows on a
 * narrow screen because the items keep their intrinsic width.
 */
const TileRow: React.FC<{ children: React.ReactNode; className?: string; cols?: string }> = ({
  children,
  className = '',
  cols = 'grid-cols-3'
}) => <div className={`grid ${cols} gap-2 sm:flex sm:flex-wrap ${className}`}>{children}</div>

const Tile: React.FC<{
  selected: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}> = ({ selected, disabled, title, onClick, className = '', children }) => (
  <button
    type="button"
    disabled={disabled}
    title={title}
    onClick={onClick}
    className={`flex items-center justify-center gap-2 px-2.5 py-2 text-xs sm:px-4 sm:py-2.5 sm:text-sm font-medium rounded border transition ${
      selected
        ? 'bg-[#6c757d] text-white border-[#6c757d]'
        : 'bg-[#f8f9fa] dark:bg-[#212529] text-[#495057] dark:text-[#adb5bd] border-[#ced4da] dark:border-[#373b3e] hover:border-[#017cb6]'
    } disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
  >
    {children}
  </button>
)

const Radio: React.FC<{ selected: boolean; blocked: boolean }> = ({ selected, blocked }) => (
  <span
    className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${
      blocked ? 'border-[#adb5bd]' : selected ? 'border-[#017cb6]' : 'border-[#ced4da] dark:border-[#6c757d]'
    }`}
  >
    {selected && <span className="w-2 h-2 rounded-full bg-[#017cb6]" />}
    {blocked && <X className="w-2.5 h-2.5 text-[#adb5bd]" />}
  </span>
)

const Select: React.FC<{
  value: number
  onChange: (v: number) => void
  options: { value: number; label: string }[]
}> = ({ value, onChange, options }) => (
  <span className="relative inline-flex items-center">
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(Number(e.target.value))}
      className="appearance-none pl-1.5 pr-5 py-0.5 text-[11px] sm:pl-2 sm:pr-6 sm:py-1 sm:text-xs bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown className="w-2.5 h-2.5 sm:w-3 sm:h-3 absolute right-1 sm:right-1.5 pointer-events-none opacity-60" />
  </span>
)

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="py-2.5 border-b border-[#ced4da]/60 dark:border-[#373b3e] last:border-0 space-y-1.5">
    {hint && <p className="text-[11px] text-[#6c757d] dark:text-[#adb5bd] leading-relaxed">{hint}</p>}
    <div className="text-[11px] text-[#6c757d] dark:text-[#adb5bd]">{label}</div>
    {children}
  </div>
)

const AddSshKeyDialog: React.FC<{
  onCancel: () => void
  onCreate: (name: string, publicKey: string, makeDefault: boolean) => Promise<void>
}> = ({ onCancel, onCreate }) => {
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || !publicKey.trim()) return setErr('Both a name and a public key are required.')
    setBusy(true)
    setErr(null)
    try {
      await onCreate(name.trim(), publicKey.trim(), makeDefault)
    } catch (e: any) {
      setErr(e.message || 'Failed to add the key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add SSH Key" onClose={onCancel} size="sm" z={80} busy={busy} labelledBy="add-key-title"
      footer={
        <div className="flex items-center justify-end gap-2 p-4">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#6c757d] hover:bg-[#5c636a] text-white transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#017cb6] hover:bg-[#016594] text-white transition disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-3 text-xs">
          <label className="block space-y-1">
            <span className="text-[#6c757d] dark:text-[#adb5bd]">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[#6c757d] dark:text-[#adb5bd]">Public Key</span>
            <textarea
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full px-2.5 py-1.5 font-mono text-[11px] bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
            />
            <span className="block text-[10px] text-[#6c757d]">
              Paste your public key in OpenSSH "authorized_keys" format.
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            <span className="text-[#212529] dark:text-white">Select this SSH Key for all new Cloud Server Installations</span>
          </label>
          {err && <div className="text-rose-600 dark:text-rose-400 break-words">{err}</div>}
        </div>
    </Modal>
  )
}
