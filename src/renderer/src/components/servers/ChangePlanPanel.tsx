import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Info } from 'lucide-react'
import { BlockedMark, CurrentMark, PlanBlockNotes } from './PlanBlocks'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import {
  useSizes,
  useDistributionImages,
  useOsSoftware,
  useServerSoftware,
  useServerBackups
} from '../../api/queries'
import { LinkOut, TOS_URL, REFUND_URL } from '../ui/LinkOut'
import {
  freeBackupSlots,
  describeBackup,
  BACKUP_SLOT_LABELS,
  type BackupSlot
} from '../../lib/backupSlots'
import {
  planUnavailableReason,
  belowImageMinimum,
  type PlanBlock,
  type SizeLike,
  planMonthlyPrice,
  configuredCost,
  transferForResize,
  retentionOptionLabel,
  memoryChoices,
  diskChoices,
  diskFloor,
  defaultDisk,
  billingTotal,
  compareVersionNames
} from '../../lib/serverPricing'
import {
  splitSoftware,
  withRequiredDefaults,
  unsatisfiedGroups,
  licenceCost,
  currentSelection,
  currentLicenceCost,
  selectionsEqual,
  toLicencePayload,
  offerableSoftware,
  isRetainedOnly,
  shortName,
  costLabel,
  countChoices,
  type LicenceSelection
} from '../../lib/licences'

type Server = components['schemas']['Server']

/** What happens to an existing backup when the pre-action backup is taken. */
/**
 * What a pre-action backup does with the slots.
 *
 * `oldest`/`newest` are valid API strategies but are not offered: they only
 * matter when no slot is free, and then they silently delete a backup the user
 * never named. The web panel instead offers genuinely free slots, or asks which
 * dated backup to replace - `specified` - which makes the deletion explicit.
 */
type PreBackup = 'off' | 'free' | 'specified'

/** A stable empty list, so "no data yet" does not invalidate every memo each render. */
const EMPTY: any[] = []

/** Shown on the page and in the confirmation whenever storage changes. */
const STORAGE_CHANGE_NOTE =
  "If the disk can't be resized, for example because the data doesn't fit in the new size or the disk has been changed inside the server, the change fails after the server has shut down, and the server restarts with its storage unchanged."

/**
 * Change the server's plan - the `resize` action.
 *
 * Deliberately shares serverPricing with the create form: the licensed-image
 * surcharge, the availability reasons, the storage ladder and now the monthly
 * cost have to agree between the two, or the same plan shows a different price
 * depending on which screen you are looking at.
 *
 * `resize` carries five things, and the panel used to send one of them:
 *
 *   size              the plan slug
 *   options           memory, storage, addresses, backup retention, offsite
 *   change_licenses   cPanel tiers, CloudLinux, KernelCare
 *   change_image      reinstall onto a different OS as part of the move
 *   pre_action_backup take a backup before any of it happens
 */
export const ChangePlanPanel: React.FC<{
  client: BinaryLaneClient | null
  server: Server
  busy?: boolean
  onApply: (
    payload: Record<string, unknown>,
    summary: string,
    changes: Array<{ label: string; from?: string; to?: string }>,
    /** Extra confirm settings for the dangerous shapes of a resize (releasing addresses, reinstalling). */
    confirm?: { severity?: 'normal' | 'destructive' | 'irreversible'; notes?: string[]; typeToConfirm?: string }
  ) => void
}> = ({ client, server, busy, onApply }) => {
  const [keepImage, setKeepImage] = useState(true)
  const [newImageSlug, setNewImageSlug] = useState<string>('')
  /*
   * Plans are fetched for this server (the sizes it can be resized to) and for
   * the image it will run afterwards, because stock is per operating system:
   * without the image, a Windows server in Brisbane was offered 6 and 8 vCPU
   * plans the web panel shows as out of stock there.
   */
  const targetImage = keepImage ? (server.image?.slug ?? server.image?.id ?? null) : newImageSlug || null
  const sizesQuery = useSizes(client, { serverId: server.id, image: targetImage })
  /*
   * The reinstall picker asks the API for distributions rather than filtering
   * `useImages`, because `type` is only ever custom/snapshot/backup - a
   * distribution image leaves it null, so filtering on `type === 'distribution'`
   * matches nothing. The server's *current* image comes off the server itself
   * (see `currentImage` below).
   */
  const distroQuery = useDistributionImages(client)

  const region = server.region?.slug || ''
  /*
   * The current image is read off the server, not looked up in /v2/images - the
   * same reason its size is. A legacy image is not in that list at all: this
   * account has a server on `cpanel-whm-rocky-8`, which /v2/images does not
   * return, so the lookup produced `undefined`, `imageSurcharge` returned 0 and
   * the panel quietly dropped a $24/mo surcharge from both sides of the
   * comparison - understating the monthly total while the delta still looked
   * right. The server's own image object carries the surcharges and the
   * minimums, so it is the better source either way.
   */
  const currentImage = (server.image ?? undefined) as any

  const allSizes = sizesQuery.data ?? EMPTY
  /*
   * The resize list includes the server's own plan even when it is retired
   * (`available: false`). It is listed as the web panel lists it: ticked but
   * greyed while it is still the selection, and crossed out once another plan
   * is picked, because a retired plan cannot be chosen again.
   */
  const isRetiredCurrent = (s: { slug: string; available?: boolean }): boolean =>
    s.slug === server.size_slug && s.available === false
  const typeSlugs = useMemo(
    () => Array.from(new Set(allSizes.map((s) => s.size_type?.slug).filter(Boolean))) as string[],
    [allSizes]
  )
  const [planType, setPlanType] = useState<string>(server.size?.size_type?.slug || 'vps')

  const plans = useMemo(
    () => allSizes.filter((s) => (s.size_type?.slug || 'vps') === planType && !isRetiredCurrent(s)),
    [allSizes, planType]
  )

  const [sizeSlug, setSizeSlug] = useState<string | null>(server.size_slug ?? null)
  const selected = plans.find((p) => p.slug === sizeSlug)

  const [memory, setMemory] = useState<number>(server.memory ?? 0)
  const [disk, setDisk] = useState<number>(server.disk ?? 0)

  /*
   * Prefilled from `selected_size_options`, which is the server's current
   * selection rather than the plan's defaults.
   */
  const current = useMemo(() => (server.selected_size_options ?? {}) as Record<string, any>, [server.selected_size_options])
  const publicIps = useMemo(
    () => (server.networks?.v4 ?? []).filter((n) => n.type === 'public').map((n) => n.ip_address as string),
    [server.networks?.v4]
  )
  const currentIpCount = (current.ipv4_addresses as number) ?? publicIps.length

  const [ipCount, setIpCount] = useState<number>(currentIpCount)
  const [ipsToRemove, setIpsToRemove] = useState<string[]>([])
  const [dailyBackups, setDailyBackups] = useState<number>((current.daily_backups as number) ?? 0)
  const [weeklyBackups, setWeeklyBackups] = useState<number>((current.weekly_backups as number) ?? 0)
  const [monthlyBackups, setMonthlyBackups] = useState<number>((current.monthly_backups as number) ?? 0)
  const [offsiteBackups, setOffsiteBackups] = useState<boolean>(!!current.offsite_backups)
  const [preBackup, setPreBackup] = useState<PreBackup>('off')
  const [replaceBackupId, setReplaceBackupId] = useState<number | null>(null)
  const [preBackupSlot, setPreBackupSlot] = useState<BackupSlot>('temporary')
  const [agreed, setAgreed] = useState(false)

  /*
   * The image drives the licence list and the surcharge, so both follow the
   * pending choice rather than what the server runs today.
   */
  const pickedImage = useMemo(
    () => (keepImage ? undefined : ((distroQuery.data ?? EMPTY) as any[]).find((i) => i.slug === newImageSlug)),
    [keepImage, newImageSlug, distroQuery.data]
  )
  const effectiveImage = pickedImage ?? currentImage
  /*
   * `cpanel-plus-whm` ships an empty `name`, so the confirm text read
   * "reinstall onto cpanel-plus-whm" while the change table said "cPanel+WHM".
   * One label for both.
   */
  const pickedImageLabel = pickedImage?.full_name || pickedImage?.name || newImageSlug
  const osSlug = (keepImage ? server.image?.slug : newImageSlug) || null

  const softwareQuery = useOsSoftware(client, osSlug)
  const serverSoftwareQuery = useServerSoftware(client, server.id)
  const onOffer = (softwareQuery.data ?? EMPTY) as any[]
  const licensed = (serverSoftwareQuery.data ?? EMPTY) as any[]

  /*
   * Licences can only be reasoned about once both lists have actually arrived.
   * `change_licenses` removes any licence it does not list, so a payload built
   * while either query is still loading - or after one failed - would read as
   * "drop everything". Until then the controls are disabled and no licence
   * change is sent. A catalogue with no OS to ask about (custom image) counts
   * as loaded: there is nothing to fetch.
   */
  const catalogueReady = !osSlug || softwareQuery.status === 'success'
  const heldReady = serverSoftwareQuery.status === 'success'
  const licencesReady = catalogueReady && heldReady
  const licenceError = softwareQuery.error ?? serverSoftwareQuery.error

  /*
   * What the OS sells today plus what the server already holds. The second half
   * is not cosmetic: `change_licenses` removes any licence it does not list, and
   * the catalogue omits disabled products, so building the payload from the
   * catalogue alone would strip a Windows server's Remote Desktop SAL the first
   * time anyone changed its memory. On a reinstall, held licences the *new*
   * image says it cannot carry are excluded, because switching image really
   * does drop them - but one that is silent about its supported images is kept,
   * so the API rejects the request rather than this form quietly dropping it.
   */
  const offered = useMemo(
    () => offerableSoftware(onOffer, licensed, keepImage ? null : newImageSlug),
    [onOffer, licensed, keepImage, newImageSlug]
  )

  const { groups, addons } = useMemo(() => splitSoftware(offered), [offered])
  const licenceBaseline = useMemo(() => currentSelection(licensed), [licensed])
  const [licenceEdit, setLicenceEdit] = useState<LicenceSelection | null>(null)

  /*
   * The panel stays mounted across a resize, and the held licences refetch once
   * it completes. An edit made against the old baseline would otherwise keep
   * reporting a change that has already happened - and resend it with the next
   * unrelated resize. So when what the server holds changes, the edit is
   * discarded and the controls fall back to showing the new baseline.
   */
  const previousBaseline = useRef(licenceBaseline)
  useEffect(() => {
    if (!selectionsEqual(previousBaseline.current, licenceBaseline)) setLicenceEdit(null)
    previousBaseline.current = licenceBaseline
  }, [licenceBaseline])

  /*
   * Untouched, the controls show what the server holds; touched, they show the
   * edit. Pruned to what the chosen OS offers, so switching image cannot leave
   * a `software_id` in the payload that the new OS would reject - and so the
   * price stops counting a licence the new OS will not carry.
   */
  const licences = useMemo(() => {
    const base = licenceEdit ?? licenceBaseline
    const out: LicenceSelection = {}
    for (const [id, count] of Object.entries(base)) {
      if (offered.some((o) => o.id === Number(id))) out[Number(id)] = count
    }
    /*
     * A group with no opt-out member is one the API insists on: it rejects the
     * whole resize with "One item from the software group 'cPanel' must be
     * selected", and moving an unlicensed server onto a cPanel image lands
     * exactly there. So the cheapest option is filled in, as the web panel does
     * - on those images it is $0. Only once the lists are in, or this would
     * "default" against an empty catalogue.
     */
    return licencesReady ? withRequiredDefaults(groups, out) : out
  }, [licenceEdit, licenceBaseline, offered, groups, licencesReady])

  /*
   * Transfer is not editable here, but it has to be *sent*: `resize` resets any
   * resource option the payload omits to the target plan's default.
   *
   * Changing plan hands over the target plan's included transfer, exactly as
   * the web panel does - it clears the previous value on a size change rather
   * than carrying it across. That can be a reduction, so it is surfaced in the
   * change table below rather than applied silently.
   */
  const sizeChanged = !!selected && selected.slug !== server.size_slug
  const transferTb = transferForResize(
    (selected ?? server.size) as any,
    current.transfer as number,
    sizeChanged
  )
  const currentTransferTb = (current.transfer as number) ?? server.size?.transfer ?? 0

  const incompatible = licensed.filter((l) => l.incompatible)
  const licencesMonthly = licenceCost(offered as any, licences)
  const licencesChanged = licencesReady && !selectionsEqual(licences, licenceBaseline)

  /*
   * Which slots a pre-action backup can use: the server's *current* retention,
   * not what this form is about to set, because the backup is taken before the
   * new options apply. See `availableBackupSlots`.
   */
  const backupsQuery = useServerBackups(client, server.id)
  const existingBackups = useMemo(() => (backupsQuery.data ?? []) as any[], [backupsQuery.data])
  /*
   * Retention says how many backups of a type may be kept; a free slot is one
   * of those actually unused. `replacement_strategy: 'none'` needs a free one,
   * so offering a permitted-but-full slot is a predictable 400 - which is why
   * this uses `freeBackupSlots` rather than `availableBackupSlots`.
   */
  const backupSlots = useMemo(() => freeBackupSlots(current, existingBackups), [current, existingBackups])

  const ipOpts = selected?.options ?? server.size?.options
  /*
   * Reducing the address count requires naming which addresses go. Ticking more
   * than are being removed is how a *replacement* is requested: the API
   * re-provisions the extras with new addresses, which is the only way to move
   * off a blocklisted address without rebuilding somewhere else.
   */
  const mustRelease = Math.max(0, publicIps.length - ipCount)
  /*
   * The original address is tied to the server for the life of the lease and
   * BinaryLane will not release it, so it is neither releasable nor
   * replaceable - only the secondaries are either. That also caps how far the
   * count can be reduced, or the panel would demand an impossible release.
   */
  const secondaryIps = publicIps.slice(1)
  const releaseSatisfied = ipsToRemove.length >= mustRelease && mustRelease <= secondaryIps.length
  const replacing = Math.max(0, ipsToRemove.length - mustRelease)

  useEffect(() => {
    setIpsToRemove((prev) => prev.filter((ip) => secondaryIps.includes(ip)))
  }, [publicIps])

  /*
   * A tick made to satisfy a count reduction is about *releasing*. If the count
   * is then put back, leaving the tick would silently turn it into a
   * replacement - the address re-provisioned with a new one - which nobody
   * asked for. So ticks are cleared when a release stops being required. Ticks
   * made while no release was required are deliberate swaps and stay.
   */
  const previousMustRelease = useRef(mustRelease)
  useEffect(() => {
    if (previousMustRelease.current > 0 && mustRelease === 0) setIpsToRemove([])
    previousMustRelease.current = mustRelease
  }, [mustRelease])

  /*
   * Offsite copies need something on-site to copy, so clearing the last
   * retention slot clears offsite with it. Done from the setters rather than an
   * effect on the values: an effect would also fire on mount against what the
   * server already has, and a server holding `offsite_backups: true` with no
   * retention would come up showing an "on -> off" change nobody made.
   */
  const setRetention =
    (setter: (v: number) => void, others: () => number) =>
    (value: number): void => {
      setter(value)
      if (value + others() === 0) setOffsiteBackups(false)
    }

  useEffect(() => {
    if (!backupSlots.includes(preBackupSlot)) setPreBackupSlot('temporary')
  }, [backupSlots, preBackupSlot])

  // A named backup that has since gone (or a list that arrived later) must not
  // stay selected, or the payload would reference an id the API will reject.
  useEffect(() => {
    if (replaceBackupId !== null && !existingBackups.some((b) => b.id === replaceBackupId)) {
      setReplaceBackupId(null)
    }
  }, [existingBackups, replaceBackupId])

  /*
   * What memory and storage start at for a plan: the server's own figures on its
   * current plan, the plan's defaults on any other. The resize sends each only
   * when the customer moves it off this, because the reference says to leave
   * them null to keep the current value on the same plan, or to take the new
   * plan's default on a different one.
   */
  const startingFigures = (p: SizeLike): { memory: number; disk: number } =>
    p.slug === server.size_slug
      ? { memory: server.memory ?? p.memory, disk: server.disk ?? defaultDisk(p) }
      : { memory: p.memory, disk: defaultDisk(p) }

  const pick = (slug: string): void => {
    const p = plans.find((x) => x.slug === slug)
    if (!p) return
    setSizeSlug(slug)
    const start = startingFigures(p)
    setMemory(start.memory)
    setDisk(start.disk)
  }

  const isCurrentPlan = (p: { slug: string }): boolean => p.slug === server.size_slug

  // Reinstalling onto an image with a larger minimum raises the storage floor.
  useEffect(() => {
    if (!selected) return
    const floor = diskFloor(selected, effectiveImage)
    if (disk < floor) setDisk(floor)
  }, [selected?.slug, effectiveImage?.slug, disk])

  // Plans too small for the target image are not listed, as in the web panel.
  // A retired current plan is not in `plans`; the table adds it back as its own
  // row, in price order.
  const shownPlans = useMemo(() => {
    const listed = plans.filter((p) => p.slug === server.size_slug || !belowImageMinimum(p, effectiveImage))
    const retired = allSizes.find((s) => isRetiredCurrent(s) && (s.size_type?.slug || 'vps') === planType)
    if (!retired) return listed
    const at = listed.findIndex((p) => p.price_monthly > retired.price_monthly)
    return at < 0 ? [...listed, retired] : [...listed.slice(0, at), retired, ...listed.slice(at)]
  }, [plans, allSizes, planType, server.size_slug, effectiveImage?.slug])

  const blocks = useMemo(() => {
    const seen = new Map<string, { kind: string; message: string }>()
    for (const p of shownPlans) {
      if (isRetiredCurrent(p)) continue
      const b = planUnavailableReason(p, region, effectiveImage)
      if (b) seen.set(b.message, b)
    }
    return [...seen.values()]
  }, [shownPlans, region, effectiveImage?.slug])

  /** Distribution images, newest first within each OS, for the reinstall picker. */
  const imageChoices = useMemo(() => {
    const distros = new Map<string, any[]>()
    for (const i of (distroQuery.data ?? []) as any[]) {
      if (!i.slug) continue
      distros.set(i.distribution || 'Other', [...(distros.get(i.distribution || 'Other') ?? []), i])
    }
    return [...distros.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([distribution, images]) => ({
        distribution,
        images: [...images].sort((a, b) =>
          compareVersionNames(a.name || a.full_name || a.slug || '', b.name || b.full_name || b.slug || '')
        )
      }))
  }, [distroQuery.data])

  const newCost = selected
    ? configuredCost({
        size: selected,
        image: effectiveImage,
        memoryMb: memory,
        diskGb: disk,
        ipCount,
        dailyBackups,
        weeklyBackups,
        monthlyBackups,
        offsiteBackups,
        transferTb,
        licencesMonthly
      })
    : null
  /*
   * The "from" side is read off the server, not out of the plans list: a retired
   * plan is not in /v2/sizes, and comparing against nothing would report the
   * entire bill as an increase.
   */
  const oldCost = server.size
    ? configuredCost({
        size: server.size as any,
        image: currentImage,
        memoryMb: server.memory ?? 0,
        diskGb: server.disk ?? 0,
        ipCount: currentIpCount || 1,
        dailyBackups: (current.daily_backups as number) ?? 0,
        weeklyBackups: (current.weekly_backups as number) ?? 0,
        monthlyBackups: (current.monthly_backups as number) ?? 0,
        offsiteBackups: !!current.offsite_backups,
        transferTb: currentTransferTb,
        licencesMonthly: currentLicenceCost(licensed as any)
      })
    : null

  /** Name of a licence by id, from either the offered list or what is held. */
  const licenceName = (id: number): string => {
    const o = offered.find((x) => x.id === id)
    if (o) return o.name
    const l = licensed.find((x) => x.software.id === id)
    return l ? l.software.name : `Software #${id}`
  }

  /*
   * One list, used for the summary on the page and for the confirm dialog. Built
   * once so the two cannot disagree - the table you approve is the table you
   * were shown.
   *
   * Computed on every render, not memoised: it reads the server (which refetches
   * every few seconds and changes under the panel once a resize lands), the
   * queries and a dozen pieces of state, and a stale copy is worse than the
   * cost of rebuilding a few rows. A memo here once kept offering a reinstall
   * onto the image the server was already running.
   */
  const changes = ((): Array<{ label: string; from?: string; to?: string }> => {
    if (!selected) return []
    const rows: Array<{ label: string; from?: string; to?: string }> = [
      { label: 'Plan', from: server.size_slug ?? undefined, to: selected.slug },
      { label: 'Memory', from: `${(server.memory ?? 0) / 1024} GB`, to: `${memory / 1024} GB` },
      { label: 'Storage', from: `${server.disk ?? 0} GB`, to: `${disk} GB` },
      { label: 'IP addresses', from: String(currentIpCount), to: String(ipCount) },
      {
        label: 'Data',
        from: `${currentTransferTb * 1000} GB`,
        to: `${transferTb * 1000} GB`
      },
      { label: 'Daily backups', from: String((current.daily_backups as number) ?? 0), to: String(dailyBackups) },
      { label: 'Weekly backups', from: String((current.weekly_backups as number) ?? 0), to: String(weeklyBackups) },
      { label: 'Monthly backups', from: String((current.monthly_backups as number) ?? 0), to: String(monthlyBackups) },
      { label: 'Offsite backups', from: current.offsite_backups ? 'on' : 'off', to: offsiteBackups ? 'on' : 'off' }
    ]

    if (!keepImage && newImageSlug) {
      rows.push({
        label: 'Operating system',
        from: server.image?.full_name || server.image?.name || server.image?.slug || undefined,
        to: pickedImageLabel
      })
    }

    // Grouped licences read as one row per group: the tier moved from A to B.
    for (const g of groups) {
      const was = g.options.find((o) => (licenceBaseline[o.id] ?? 0) > 0)
      const now = g.options.find((o) => (licences[o.id] ?? 0) > 0)
      if (was?.id !== now?.id) {
        rows.push({ label: g.name, from: was ? shortName(was) : 'none', to: now ? shortName(now) : 'none' })
      }
    }
    for (const a of addons) {
      const was = licenceBaseline[a.id] ?? 0
      const now = licences[a.id] ?? 0
      if (was !== now) {
        rows.push({
          label: a.name,
          from: was > 1 ? String(was) : was ? 'on' : 'off',
          to: now > 1 ? String(now) : now ? 'on' : 'off'
        })
      }
    }
    /*
     * A licence held but not offered by the chosen OS is being dropped, and none
     * of the rows above can show it: it is not among any group's options. This
     * is the visible half of switching a cPanel server onto Ubuntu.
     */
    for (const id of Object.keys(licenceBaseline).map(Number)) {
      if (!offered.some((o) => o.id === id) && !licences[id]) {
        rows.push({ label: licenceName(id), from: 'on', to: 'removed' })
      }
    }

    const changed = rows.filter((r) => r.from !== r.to)

    // Swapping a secondary address for a new one is a change in its own right,
    // and the only one the address list can ask for on its own.
    if (ipsToRemove.length) {
      changed.push({
        label: mustRelease ? 'Releasing' : 'Replacing',
        from: ipsToRemove.join(', '),
        to: replacing ? `${replacing} replaced with new` : undefined
      })
    }
    // The pre-action backup and the cost are consequences of the rows above, so
    // they only belong here once something else has changed.
    if (changed.length) {
      if (preBackup === 'free' || (preBackup === 'specified' && replaceBackupId !== null)) {
        changed.push({
          label: 'Backup first',
          to:
            preBackup === 'specified'
              ? `replacing ${describeBackup(existingBackups.find((b) => b.id === replaceBackupId) ?? { id: 0 })}`
              : `${preBackupSlot} slot`
        })
      }
      if (oldCost && newCost) {
        changed.push({
          label: 'Monthly (ex-GST)',
          from: `$${oldCost.total.toFixed(2)}`,
          to: `$${newCost.total.toFixed(2)}`
        })
      }
    }
    return changed
  })()

  // Distributions are only needed once "Continue using <OS>" is unticked, so
  // they load behind the picker rather than holding up the whole panel.
  if (sizesQuery.isLoading) {
    return <p className="text-xs text-[#6c757d] dark:text-slate-400">Loading plans...</p>
  }

  const monthly = newCost?.total ?? 0
  const { total, gst } = billingTotal(monthly)
  const delta = total - billingTotal(oldCost?.total ?? 0).total
  const reinstalling = !keepImage && !!newImageSlug
  /*
   * A storage change can fail after the server has shut down, and on a disk
   * changed inside the server a larger size fails as well as a smaller one.
   * Tested on both: the action errors and the server restarts with its storage
   * and data unchanged. A reinstall rebuilds the disks instead, so it does not apply.
   */
  const storageChanging = !!selected && !reinstalling && disk !== (server.disk ?? 0)
  const imageMissing = !keepImage && !newImageSlug
  const unchanged = changes.length === 0
  /*
   * A required group with nothing selected, or licences that have not arrived,
   * both mean the payload would be wrong rather than merely incomplete - so the
   * submit is held rather than the 400 discovered after the confirmation.
   */
  const missingGroups = licencesReady ? unsatisfiedGroups(groups, licences) : []
  const canApply =
    !!selected &&
    !unchanged &&
    releaseSatisfied &&
    !imageMissing &&
    agreed &&
    licencesReady &&
    !licenceError &&
    missingGroups.length === 0 &&
    // "Replace an existing backup" without saying which one would 400.
    !(preBackup === 'specified' && replaceBackupId === null)

  /*
   * Two shapes of resize are not undoable, so both confirm like a rebuild -
   * type the hostname - rather than with the ordinary "are you sure?".
   *
   * Giving an address back is Adam's case (e503089): it returns to the pool and
   * may be reassigned, and anything pointing at it breaks. Reinstalling is the
   * worse one this change adds, because it destroys the disks outright.
   */
  const confirmExtra =
    reinstalling || ipsToRemove.length
      ? {
          severity: 'irreversible' as const,
          helpSlug: 'server-change-plan#worked-example',
          typeToConfirm: server.name,
          notes: [
            ...(reinstalling
              ? [
                  `Reinstalling onto ${pickedImageLabel} destroys the server's disks and everything on them. Take a backup first if anything on it matters.`
                ]
              : []),
            ...(mustRelease > 0
              ? [
                  `Releasing ${ipsToRemove.join(', ')}. Released addresses go back to the pool and may be assigned to someone else; update DNS and any allow-lists first.`
                ]
              : ipsToRemove.length
                ? [
                    `Replacing ${ipsToRemove.join(', ')} with ${replacing === 1 ? 'a new address' : 'new addresses'}. The old ${replacing === 1 ? 'one goes' : 'ones go'} back to the pool; update DNS and any allow-lists first.`
                  ]
                : []),
            ...(storageChanging ? [STORAGE_CHANGE_NOTE] : [])
          ]
        }
      : storageChanging
        ? { notes: [STORAGE_CHANGE_NOTE] }
        : undefined

  const cellClass = 'py-1.5 px-1 sm:py-2 sm:px-3'
  const selectClass =
    'w-full px-2 py-1.5 text-xs rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#212529] text-[#212529] dark:text-white'
  const labelClass = 'block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1'

  const windowsish = /windows/i.test(effectiveImage?.distribution || server.image?.distribution || '')

  /*
   * Picking a group's opt-out means "no licence from this group", so it clears
   * the group rather than sending that option's id.
   *
   * Verified against the live API: sending `{software_id: 105, count: 1}` for
   * "cPanel: Not required" is accepted and then not persisted - the server comes
   * back with zero licences. Treating it as a licence made the panel report a
   * change that never stuck, and then offer the same change again forever.
   */
  const setGroup = (g: { options: Array<{ id: number }>; optOut: { id: number } | null }, chosen: number | null): void =>
    setLicenceEdit(() => {
      const next: LicenceSelection = { ...licences }
      for (const o of g.options) delete next[o.id]
      if (chosen !== null && chosen !== g.optOut?.id) {
        const o = offered.find((x) => x.id === chosen)
        next[chosen] = o?.minimum_licence_count || 1
      }
      return next
    })

  return (
    <div className="space-y-4">
      {/*
        * "Continue using <OS>" sits at the top, as the web panel has it: the
        * answer changes which plans are eligible, what the image surcharge is
        * and which licences are on offer, so it belongs before the plan table
        * rather than after it.
        */}
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-xs text-[#212529] dark:text-slate-200">
          <input
            type="checkbox"
            checked={keepImage}
            onChange={(e) => {
              setKeepImage(e.target.checked)
              if (e.target.checked) setNewImageSlug('')
            }}
            disabled={busy}
            className="mt-0.5 shrink-0 rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
          />
          <span>Continue using {server.image?.full_name || server.image?.name || 'the current image'}</span>
        </label>

        {!keepImage && (
          <div className="ml-6 space-y-2">
            <div>
              <label className={labelClass}>Install instead</label>
              <select
                value={newImageSlug}
                onChange={(e) => setNewImageSlug(e.target.value)}
                disabled={busy}
                className={selectClass}
              >
                <option value="">Choose an operating system...</option>
                {distroQuery.isLoading && <option value="" disabled>Loading operating systems...</option>}
                {imageChoices.map((d) => (
                  <optgroup key={d.distribution} label={d.distribution}>
                    {d.images.map((i) => (
                      <option key={i.slug} value={i.slug as string}>
                        {/* cpanel-plus-whm ships an empty `name`, which renders
                            as a blank, unpickable-looking row. */}
                        {i.name || i.full_name || i.slug}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex items-start gap-2 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-900 rounded p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Installing a different operating system destroys the server's disks and everything on them. The
                account's default SSH keys are deployed, and a new password for the remote user is emailed to the
                account address. Take a backup below first if you want one.
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {typeSlugs.map((t) => {
          const name = allSizes.find((s) => s.size_type?.slug === t)?.size_type?.name || t
          return (
            <button
              key={t}
              type="button"
              onClick={() => setPlanType(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition ${
                planType === t
                  ? 'bg-[#6c757d] text-white border-[#6c757d]'
                  : 'bg-[#f8f9fa] dark:bg-[#212529] text-[#495057] dark:text-[#adb5bd] border-[#ced4da] dark:border-[#373b3e]'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>

      <div className="border border-[#ced4da] dark:border-[#373b3e] rounded overflow-x-auto">
        <table className="w-full text-[10px] sm:text-xs whitespace-nowrap">
          <thead className="bg-[#f8f9fa] dark:bg-[#212529] text-[#495057] dark:text-[#adb5bd]">
            <tr>
              <th className={`${cellClass} font-semibold text-center`}>Processor</th>
              <th className={`${cellClass} font-semibold text-center`}>Memory</th>
              <th className={`${cellClass} font-semibold text-center`}>Storage</th>
              <th className={`${cellClass} font-semibold text-center`}>Transfer</th>
              <th className={`${cellClass} font-semibold text-center`}>Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
            {shownPlans.map((p) => {
              const retiredCurrent = isRetiredCurrent(p)
              const blocked = retiredCurrent ? null : planUnavailableReason(p, region, effectiveImage)
              const isSel = retiredCurrent ? sizeSlug === server.size_slug : selected?.slug === p.slug
              if (retiredCurrent) {
                // Its own figures, not the plan's defaults: the server may carry more.
                const mem = server.memory ?? p.memory
                const dsk = server.disk ?? p.disk
                const fixed = (value: string) =>
                  isSel ? (
                    <select disabled value={value} className="px-1 py-0.5 text-[10px] sm:text-xs rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035]">
                      <option value={value}>{value}</option>
                    </select>
                  ) : (
                    value
                  )
                return (
                  <tr key={p.slug} className={`opacity-45 cursor-not-allowed ${isSel ? 'bg-[#017cb6]/10' : ''}`}>
                    <td className={cellClass}>
                      <span className="flex items-center gap-1 sm:gap-2">
                        {isSel ? <CurrentMark /> : <BlockedMark />}
                        <span className="text-[#212529] dark:text-white">
                          {p.vcpus} {p.vcpu_units || 'VCPU'}
                          {p.vcpus === 1 ? '' : 's'}
                        </span>
                      </span>
                    </td>
                    <td className={`${cellClass} text-center`}>{fixed(`${mem / 1024} GB`)}</td>
                    <td className={`${cellClass} text-center`}>{fixed(`${dsk} GB`)}</td>
                    <td className={`${cellClass} text-center`}>{p.transfer * 1000} GB</td>
                    <td className={`${cellClass} text-center font-medium`}>
                      ${planMonthlyPrice(p, effectiveImage, mem, dsk).toFixed(2)}
                    </td>
                  </tr>
                )
              }
              return (
                <tr
                  key={p.slug}
                  onClick={() => !blocked && pick(p.slug)}
                  title={blocked?.message || undefined}
                  className={`${blocked ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'} ${
                    isSel ? 'bg-[#017cb6]/10' : ''
                  }`}
                >
                  <td className={cellClass}>
                    <span className="flex items-center gap-1 sm:gap-2">
                      {blocked ? (
                        <BlockedMark />
                      ) : (
                        <span
                          className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                            isSel ? 'border-[#017cb6]' : 'border-[#ced4da] dark:border-[#6c757d]'
                          }`}
                        >
                          {isSel && <span className="w-2 h-2 rounded-full bg-[#017cb6]" />}
                        </span>
                      )}
                      <span className="text-[#212529] dark:text-white">
                        {p.vcpus} {p.vcpu_units || 'VCPU'}
                        {p.vcpus === 1 ? '' : 's'}
                      </span>
                    </span>
                  </td>
                  <td className={`${cellClass} text-center`}>
                    {isSel && memoryChoices(p, isCurrentPlan(p) ? server.memory : undefined).length > 1 ? (
                      <select
                        value={memory}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setMemory(Number(e.target.value))}
                        className="px-1 py-0.5 text-[10px] sm:text-xs rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035]"
                      >
                        {memoryChoices(p, isCurrentPlan(p) ? server.memory : undefined).map((m) => (
                          <option key={m} value={m}>
                            {m / 1024} GB
                          </option>
                        ))}
                      </select>
                    ) : (
                      `${p.memory / 1024} GB`
                    )}
                  </td>
                  <td className={`${cellClass} text-center`}>
                    {isSel && diskChoices(p, effectiveImage, isCurrentPlan(p) ? server.disk : undefined).length > 1 ? (
                      <select
                        value={disk}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDisk(Number(e.target.value))}
                        className="px-1 py-0.5 text-[10px] sm:text-xs rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035]"
                      >
                        {diskChoices(p, effectiveImage, isCurrentPlan(p) ? server.disk : undefined).map((d) => (
                          <option key={d} value={d}>
                            {d} GB
                          </option>
                        ))}
                      </select>
                    ) : (
                      `${defaultDisk(p)} GB`
                    )}
                  </td>
                  <td className={`${cellClass} text-center`}>{p.transfer * 1000} GB</td>
                  <td className={`${cellClass} text-center font-medium`}>
                    ${planMonthlyPrice(p, effectiveImage, p.memory, defaultDisk(p)).toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <PlanBlockNotes blocks={blocks as PlanBlock[]} />
      </div>

      {storageChanging && (
        <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 rounded p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{STORAGE_CHANGE_NOTE}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <label className={labelClass}>IP Addresses</label>
          {/* Capped rather than full-width: the longest option is about 30
              characters ("8 IP addresses (+$14.00)"), so stretching it across
              half the panel just made a short control look oversized. Still
              w-full underneath, so it shrinks with the column on a phone. */}
          <select
            value={ipCount}
            onChange={(e) => setIpCount(Number(e.target.value))}
            disabled={busy}
            className={`${selectClass} max-w-sm`}
          >
            {/* Falls back to the server's own size while no plan is selected:
                reading only from `selected` showed "+$0.00" for an address that
                costs money, which is the wrong way round to be wrong. */}
            {/* A server with no public address today keeps that as a choice,
                or the form would report "0 -> 1" before anything was touched. */}
            {currentIpCount === 0 && <option value={0}>No IP address</option>}
            {Array.from({ length: (ipOpts?.ipv4_addresses_max ?? publicIps.length) || 1 }, (_, i) => {
              const extra = i * (ipOpts?.ipv4_addresses_cost_per_address ?? 0)
              return (
                <option key={i + 1} value={i + 1}>
                  {i === 0 ? '1 IP address (included)' : `${i + 1} IP addresses (+$${extra.toFixed(2)})`}
                </option>
              )
            })}
          </select>

          {publicIps.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400">
                {mustRelease > 0
                  ? `Select at least ${mustRelease} address${mustRelease === 1 ? '' : 'es'} to give up.`
                  : secondaryIps.length > 0
                    ? 'Optional: tick a secondary address to swap it for a new one.'
                    : 'This server has only its original address, which cannot be released or swapped.'}
              </p>
              {/* Shown but not tickable: BinaryLane keeps the original address
                  with the server, so the UI cannot ask for what the platform
                  refuses. (Adam, bd3d246.) */}
              {publicIps[0] && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-[#6c757d] dark:text-slate-500">
                  <input type="checkbox" disabled checked={false} className="shrink-0 rounded border-[#ced4da]" />
                  <span>{publicIps[0]}</span>
                  <span className="font-sans text-[10px]">primary - stays with the server</span>
                </div>
              )}
              {secondaryIps.map((ip) => (
                <label key={ip} className="flex items-center gap-2 text-[11px] font-mono">
                  <input
                    type="checkbox"
                    checked={ipsToRemove.includes(ip)}
                    disabled={busy}
                    onChange={(e) =>
                      setIpsToRemove((prev) => (e.target.checked ? [...prev, ip] : prev.filter((x) => x !== ip)))
                    }
                    className="shrink-0 rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
                  />
                  <span>{ip}</span>
                </label>
              ))}
              {ipsToRemove.length > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {mustRelease > 0 && `${mustRelease} given up permanently and cannot be reclaimed. `}
                  {replacing > 0 &&
                    `${replacing} replaced with ${replacing === 1 ? 'a new address' : 'new addresses'}. Anything pointing at ${replacing === 1 ? 'it' : 'them'} - DNS, firewall rules elsewhere, licences tied to an address - needs updating.`}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300">Backups</label>
          {(
            [
              ['Daily', dailyBackups, setRetention(setDailyBackups, () => weeklyBackups + monthlyBackups)],
              ['Weekly', weeklyBackups, setRetention(setWeeklyBackups, () => dailyBackups + monthlyBackups)],
              ['Monthly', monthlyBackups, setRetention(setMonthlyBackups, () => dailyBackups + weeklyBackups)]
            ] as const
          ).map(([label, value, setter]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="w-14 text-[11px] text-[#6c757d] dark:text-slate-400">{label}</span>
              <select
                value={value}
                onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))}
                disabled={busy}
                /* min-w-0: a flex item will not shrink below its content's
                   intrinsic width without it, and these option labels are long
                   enough to push the select out of the column. */
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#212529]"
              >
                {Array.from({ length: 11 }, (_, n) => (
                  <option key={n} value={n}>
                    {retentionOptionLabel(
                      label.toLowerCase() as 'daily' | 'weekly' | 'monthly',
                      n,
                      disk,
                      selected ?? (server.size as any)
                    )}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={offsiteBackups}
              onChange={(e) => setOffsiteBackups(e.target.checked)}
              disabled={busy || dailyBackups + weeklyBackups + monthlyBackups === 0}
              className="shrink-0 rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
            />
            <span className="text-[#212529] dark:text-slate-200">Offsite backups (requires on-site backups)</span>
          </label>
        </div>
      </div>

      {(offered.length > 0 || windowsish) && (
        <div className="space-y-2 border-t border-[#ced4da] dark:border-[#373b3e] pt-3">
          <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300">
            Licensed software
          </label>

          {!licencesReady && !licenceError && (
            <p className="text-[11px] text-[#6c757d] dark:text-slate-400">Loading licences...</p>
          )}
          {licenceError && (
            <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 rounded p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Could not load the server's licences ({licenceError.message}). They are left exactly as they are by this
                change; reload to edit them.
              </span>
            </div>
          )}

          {groups.map((g) => {
            const chosen = g.options.find((o) => (licences[o.id] ?? 0) > 0)
            /*
             * Nothing licensed shows as the opt-out where the OS has one, so the
             * control reads the way the web panel's does ("cPanel: Not
             * required") instead of as an empty box.
             */
            const shown = chosen ? String(chosen.id) : g.optOut ? String(g.optOut.id) : ''
            return (
              <div key={g.name}>
                <label className={labelClass}>{g.name}</label>
                <select
                  value={shown}
                  onChange={(e) => setGroup(g, e.target.value ? Number(e.target.value) : null)}
                  disabled={busy || !licencesReady}
                  className={selectClass}
                >
                  {/*
                    * An OS with no explicit opt-out needs one of its options, so
                    * this entry reports a state rather than offering a choice -
                    * hence `disabled`.
                    *
                    * BinaryLane ships an explicit "Not required" tier for the OSes
                    * where dropping cPanel is allowed (ubuntu-24.04, alma-9,
                    * alma-10) and none for the cPanel images, whose cheapest tier
                    * is $0 instead. Read as deliberate: the platform offers no way
                    * to run a cPanel image with no cPanel licence, so neither does
                    * this. Relax it to selectable if that reading is wrong.
                    */}
                  {!g.optOut && (
                    <option value="" disabled>
                      Not licensed
                    </option>
                  )}
                  {g.options.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {shortName(o)} - {costLabel(o)}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}

          {addons.map((a) => {
            const counts = countChoices(a)
            const on = (licences[a.id] ?? 0) > 0
            // Held but closed to new orders: keepable, and gone for good if
            // dropped. Remote Desktop SAL is the one this exists for.
            const retained = isRetainedOnly(a.id, onOffer)
            return (
              <div key={a.id} className="space-y-1">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy || !licencesReady}
                    onChange={(e) =>
                      setLicenceEdit(() => {
                        const next = { ...licences }
                        if (e.target.checked) next[a.id] = a.minimum_licence_count || 1
                        else delete next[a.id]
                        return next
                      })
                    }
                    className="mt-0.5 shrink-0 rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
                  />
                  <span className="text-[#212529] dark:text-slate-200">
                    {a.name} <span className="text-[#6c757d] dark:text-slate-400">{costLabel(a)}</span>
                    {a.description && a.description !== a.name && a.description !== '-' && (
                      <span className="block text-[11px] text-[#6c757d] dark:text-slate-400">{a.description}</span>
                    )}
                    {retained && (
                      <span className="block text-[11px] text-[#6c757d] dark:text-slate-400">
                        Closed to new orders. This server can keep it or give it up, but cannot get it back.
                      </span>
                    )}
                  </span>
                </label>
                {retained && !on && (
                  <p className="ml-6 text-[11px] text-amber-700 dark:text-amber-400">
                    Giving up {a.name} is permanent - it cannot be re-added from here.
                  </p>
                )}
                {on && counts.length > 1 && (
                  <select
                    value={licences[a.id] ?? counts[0]}
                    onChange={(e) => setLicenceEdit(() => ({ ...licences, [a.id]: Number(e.target.value) }))}
                    disabled={busy || !licencesReady}
                    className={`ml-6 max-w-[14rem] ${selectClass}`}
                  >
                    {counts.map((n) => (
                      <option key={n} value={n}>
                        {n} licence{n === 1 ? '' : 's'} - {costLabel(a, n)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}

          {/*
            * Windows sells no licences through the API: every `windows-*` slug
            * returns an empty list, because Remote Desktop SAL is
            * `enabled: false` and the catalogue endpoints only return enabled
            * products. A server already holding SAL shows it above and can
            * change the count; one that does not cannot buy it here. Saying so
            * beats an empty space that reads as a missing feature.
            */}
          {windowsish && offered.length === 0 && licencesReady && (
            <div className="flex items-start gap-2 text-[11px] text-[#6c757d] dark:text-[#adb5bd] bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded p-2.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Windows licences cannot be added here: Remote Desktop SAL is closed to new orders, so it is offered
                only to servers already holding one. The web panel builds its list the same way and cannot add one
                either - a server that needs one has to go through BinaryLane support.
              </span>
            </div>
          )}

          {incompatible.length > 0 && (
            <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                {incompatible.map((l) => l.software.name).join(', ')} {incompatible.length === 1 ? 'is' : 'are'}{' '}
                incompatible with this server and will be removed by the next plan change whatever is selected here.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0 border-t border-[#ced4da] dark:border-[#373b3e] pt-3">
        <div>
          <label className={labelClass}>Backup will</label>
          <select
            value={preBackup}
            onChange={(e) => setPreBackup(e.target.value as PreBackup)}
            disabled={busy}
            className={selectClass}
          >
            <option value="off">Not be taken before the change</option>
            <option value="free">Use a free slot</option>
            {existingBackups.length > 0 && <option value="specified">Replace an existing backup</option>}
          </select>
        </div>
        {preBackup === 'specified' && (
          <div>
            <label className={labelClass}>Backup to replace</label>
            <select
              value={replaceBackupId ?? ''}
              onChange={(e) => setReplaceBackupId(e.target.value ? Number(e.target.value) : null)}
              disabled={busy}
              className={selectClass}
            >
              <option value="">Choose a backup...</option>
              {existingBackups.map((b) => (
                <option key={b.id} value={b.id}>
                  {describeBackup(b)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
              The chosen backup is deleted to make room. That cannot be undone.
            </p>
          </div>
        )}
        {preBackup === 'free' && (
          <div>
            <label className={labelClass}>Backup slot</label>
            <select
              value={preBackupSlot}
              onChange={(e) => setPreBackupSlot(e.target.value as typeof preBackupSlot)}
              disabled={busy}
              className={selectClass}
            >
              {backupSlots.map((slot: BackupSlot) => (
                <option key={slot} value={slot}>
                  {BACKUP_SLOT_LABELS[slot]}
                </option>
              ))}
            </select>
            {backupSlots.length === 1 && (
              <p className="mt-1 text-[11px] text-[#6c757d] dark:text-slate-400">
                Only a temporary slot is free. Scheduled slots are either not kept by this server or already full -
                replace a named backup instead.
              </p>
            )}
          </div>
        )}
      </div>

      {selected && !unchanged && (
        <div className="border border-[#ced4da] dark:border-[#373b3e] rounded overflow-hidden">
          <div className="px-3 py-2 bg-[#f8f9fa] dark:bg-[#212529] text-[11px] font-bold uppercase tracking-wider text-[#495057] dark:text-[#adb5bd]">
            Summary of changes
          </div>
          <table className="w-full text-[11px]">
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {changes.map((c) => (
                <tr key={c.label}>
                  <td className="py-1.5 px-3 text-[#6c757d] dark:text-slate-400 align-top w-1/3">{c.label}</td>
                  <td className="py-1.5 px-3 text-[#212529] dark:text-white break-all">
                    {c.from && <span className="text-[#6c757d] dark:text-slate-400 line-through">{c.from}</span>}
                    {c.from && c.to && <span className="text-[#6c757d] dark:text-slate-400"> &rarr; </span>}
                    {c.to && <span className="font-medium">{c.to}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529] space-y-1 text-[11px]">
            <div className="font-bold uppercase tracking-wider text-[#495057] dark:text-[#adb5bd]">Billing</div>
            <div className="flex justify-between gap-6">
              <span className="text-[#6c757d] dark:text-[#adb5bd]">Monthly Change</span>
              <span
                className={
                  delta > 0
                    ? 'text-amber-700 dark:text-amber-400 font-medium'
                    : delta < 0
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-[#212529] dark:text-white'
                }
              >
                {delta < 0 ? '-' : '+'}${Math.abs(delta).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[#6c757d] dark:text-[#adb5bd]">Monthly Total</span>
              <span className="text-[#212529] dark:text-white font-medium">
                ${total.toFixed(2)} (incl. ${gst.toFixed(2)} GST)
              </span>
            </div>
            {licencesMonthly > 0 && (
              <div className="flex justify-between gap-6">
                <span className="text-[#6c757d] dark:text-[#adb5bd]">of which licences</span>
                <span className="text-[#6c757d] dark:text-[#adb5bd]">${licencesMonthly.toFixed(2)} ex-GST</span>
              </div>
            )}
            <p className="text-[#6c757d] dark:text-[#adb5bd] leading-relaxed pt-1">
              All prices are in AUD and exclusive of GST unless stated otherwise. Charges are pro-rated from the time
              the change is applied.
            </p>
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          disabled={busy}
          className="mt-0.5 shrink-0 rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
        />
        <span className="text-[#212529] dark:text-white">
          I agree to the <LinkOut href={TOS_URL}>Terms of Service</LinkOut> and{' '}
          <LinkOut href={REFUND_URL}>refund policy</LinkOut>.
        </span>
      </label>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-[#495057] dark:text-slate-300">
          {selected ? (
            <>
              New monthly total <span className="font-semibold">${total.toFixed(2)}</span>{' '}
              <span className="text-[#6c757d] dark:text-slate-400">(incl. ${gst.toFixed(2)} GST)</span>
            </>
          ) : (
            <span className="text-[#6c757d] dark:text-slate-400">Select a plan to see the new monthly total.</span>
          )}
        </p>
        <button
          type="button"
          disabled={busy || !canApply}
          onClick={() =>
            selected &&
            onApply(
              {
                type: 'resize',
                size: selected.slug,
                options: {
                  // Sent only when changed; see startingFigures.
                  ...(memory !== startingFigures(selected).memory ? { memory } : {}),
                  ...(disk !== startingFigures(selected).disk ? { disk } : {}),
                  ipv4_addresses: ipCount,
                  daily_backups: dailyBackups,
                  weekly_backups: weeklyBackups,
                  monthly_backups: monthlyBackups,
                  offsite_backups: offsiteBackups,
                  transfer: transferTb,
                  // Naming more addresses than are being removed is how the API
                  // is told to re-provision the extras with new ones.
                  ...(ipsToRemove.length ? { ipv4_addresses_to_remove: ipsToRemove } : {})
                },
                // Omitted rather than sent unchanged: any licence *not* included
                // in `change_licenses` is removed, so sending it on every resize
                // is a standing chance to drop one.
                ...(licencesChanged ? { change_licenses: { licenses: toLicencePayload(licences, offered) } } : {}),
                ...(!keepImage && newImageSlug ? { change_image: { image: newImageSlug } } : {}),
                /*
                 * `backup_type` accompanies `specified` too, even though the
                 * schema says it is only needed "if replacement_strategy is
                 * anything other than 'specified'". Omitting it is rejected:
                 *
                 *   pre_action_backup.backup_type: "Backup N is not a  backup."
                 *
                 * - the blank being where the expected type would be. The API
                 * validates that the named backup is of the given type, so the
                 * type is read back off the chosen backup.
                 */
                ...(preBackup === 'free'
                  ? {
                      pre_action_backup: {
                        type: 'take_backup',
                        backup_type: preBackupSlot,
                        replacement_strategy: 'none'
                      }
                    }
                  : preBackup === 'specified' && replaceBackupId !== null
                    ? {
                        pre_action_backup: {
                          type: 'take_backup',
                          backup_type: existingBackups.find((b) => b.id === replaceBackupId)?.backup_info?.type,
                          replacement_strategy: 'specified',
                          backup_id_to_replace: replaceBackupId
                        }
                      }
                    : {})
              },
              reinstalling
                ? `Change plan to ${selected.slug} and reinstall onto ${pickedImageLabel}, erasing the disks`
                : `Change plan to ${selected.slug} (${memory / 1024} GB memory, ${disk} GB storage)`,
              changes,
              confirmExtra
            )
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#017cb6] text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>
            {licenceError
              ? 'Licences failed to load'
              : !licencesReady
                ? 'Loading licences...'
                : missingGroups.length
                  ? `Choose a ${missingGroups[0].name} option`
                  : imageMissing
                    ? 'Choose an operating system'
                    : !releaseSatisfied
                ? `Select ${mustRelease - ipsToRemove.length} more address${mustRelease - ipsToRemove.length === 1 ? '' : 'es'}`
                : unchanged
                  ? 'No change selected'
                  : !agreed
                    ? 'Accept the terms to continue'
                    : 'Change Plan'}
          </span>
        </button>
      </div>
    </div>
  )
}
