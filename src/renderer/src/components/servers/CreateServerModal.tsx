import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Modal } from '../ui/Modal'
import { LinkOut, TOS_URL, REFUND_URL } from '../ui/LinkOut'
import { recordChange, updateChange } from '../../lib/changelog'
import { Loader2, AlertTriangle, Check, ChevronDown, Plus, KeyRound } from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { components } from '@shared/api/schema'
import {
  useSizes,
  useRegions,
  useDistributionImages,
  useSshKeys,
  useVpcs,
  useAccount,
  useCreateServerMutation,
  useAddSshKeyMutation
} from '../../api/queries'
import { logoForDistribution } from '../../lib/distroHelper'
import { setKeyAssociation } from '../../lib/sshKeyAssociations'
import { cloudInitToSend, createdDetail, createdName, createdTarget, hostnameFields } from '../../lib/createServerHostname'
import { GenerateKeyPairDialog, canGenerateKeyPair } from '../keys/GenerateKeyPairDialog'
import { BlockedMark, PlanBlockNotes } from './PlanBlocks'
import { listServerTemplates, imageSupportsUserData, TEMPLATES_EVENT, TEMPLATE_KIND, type ServerTemplate, type CreateServerPrefill } from '../../lib/serverTemplates'
import {
  planMonthlyPrice,
  configuredCost,
  retentionOptionLabel,
  retentionWording,
  planUnavailableReason,
  belowImageMinimum,
  type PlanBlock,
  memoryChoices,
  diskChoices,
  diskFloor,
  defaultDisk,
  billingTotal,
  taxBasis,
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
  /** Active profile, so a key pair generated here can be set as the new server's SSH key. */
  profileId?: string
}

export const CreateServerModal: React.FC<CreateServerModalProps> = ({ isOpen, onClose, client, onCreated, initial, onSaveAsTemplate, profileId }) => {
  const regionsQuery = useRegions(client)
  const imagesQuery = useDistributionImages(client)
  const sshKeysQuery = useSshKeys(client)
  const vpcsQuery = useVpcs(client)
  const accountQuery = useAccount(client)
  const createServer = useCreateServerMutation(client)
  const addSshKey = useAddSshKeyMutation(client)

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
  /** Whether the storage size was picked (by the person, or by a template) rather than worked out from the plan and image. */
  const diskChosenRef = useRef(false)

  // --- settings ---
  const [showAll, setShowAll] = useState(false)
  const [hostname, setHostname] = useState('')
  const [vpcId, setVpcId] = useState<number | undefined>(undefined)
  const [selectedKeys, setSelectedKeys] = useState<number[]>([])
  /** The key names the template asked for. Those this account does not have are listed against the keys as they are now, so the note follows the list. */
  const [templateKeyNames, setTemplateKeyNames] = useState<string[]>([])
  const missingKeyNames = sshKeysQuery.data ? templateKeyNames.filter((n) => !sshKeys.some((k: any) => k.name === n)) : []
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
  /** What a failed submit is about, so its message shows beside that part of the form and focus goes there. */
  const [errorField, setErrorField] = useState<'os' | 'plan' | 'agree' | null>(null)
  const osRef = useRef<HTMLDivElement>(null)
  const planRef = useRef<HTMLDivElement>(null)
  const agreeRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const [addKeyOpen, setAddKeyOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  /** Key id -> private key path, for pairs generated in this form. */
  const [generatedKeys, setGeneratedKeys] = useState<Record<number, string>>({})
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof listServerTemplates>>>([])

  // The form stays mounted with the server list, so its lists were only as fresh
  // as the last visit to Servers: a key deleted in the web panel was still
  // offered. Reload everything the form picks from each time it opens.
  //
  // The key selection is the account's default keys until someone decides otherwise: a fresh open, or a template that says
  // nothing about keys, ticks the defaults as a newly loaded web panel page does, and follows the list when it reloads.
  // Unticking a key, adding one, or a template that names keys (even none at all) is a decision, and a reload of the
  // list never overrides it.
  const keysTouchedRef = useRef(false)
  // Back to a blank form for what was typed or paid for: the form stays mounted with the server list, so the last
  // server's hostname, extra addresses, paid backups and agreement to the terms would otherwise be what the next one
  // starts with, and one more press of Add Server would build it again. Region, image and plan are left as they are.
  const resetForm = () => {
    setHostname('')
    setVpcId(undefined)
    setIpCount(1)
    setDailyBackups(0)
    setWeeklyBackups(0)
    setMonthlyBackups(0)
    setOffsiteBackups(false)
    setSimpleBackups('none')
    setCloudInitOn(false)
    setCloudInit('')
    setAgreed(false)
    setErrorMsg(null)
    diskChosenRef.current = false
    setMemoryMb(null)
    setDiskGb(null)
  }
  useEffect(() => {
    if (!isOpen) return
    // The terms are agreed to for each server, not once for the session.
    setAgreed(false)
    setErrorMsg(null)
    // A template starts from a blank form too, so nothing of the last server's choices rides along with it. Region, image
    // and plan are what the form starts with, so a template that does not name them gets those, not the last server's.
    // (After a create they stay: the next server is often the same kind.)
    if (initial) {
      resetForm()
      setRegion('syd')
      setDistro('Ubuntu')
      setImageSlug(null)
      setPlanType('vps')
      setSizeSlug(null)
    }
    keysTouchedRef.current = initial?.sshKeyNames !== undefined
    setTemplateKeyNames([])
    if (initial?.sshKeyNames !== undefined) setSelectedKeys([])
    else if (sshKeysQuery.data) setSelectedKeys((sshKeysQuery.data as any[]).filter((k: any) => k.default).map((k: any) => k.id as number))
    void sshKeysQuery.refetch()
    void vpcsQuery.refetch()
    void sizesQuery.refetch()
    void regionsQuery.refetch()
    void imagesQuery.refetch()
  }, [isOpen])

  // A ticked key that has since been deleted must not be sent with the create.
  useEffect(() => {
    if (!sshKeysQuery.isSuccess) return
    const live = new Set(sshKeys.map((k: any) => k.id))
    setSelectedKeys((prev) => (prev.every((id) => live.has(id)) ? prev : prev.filter((id) => live.has(id))))
  }, [sshKeys])

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
    // The keys are only shown in View All, so a template that decides them opens there: what is shown is what is deployed.
    if (hasBackupChoice || initial.memory !== undefined || initial.disk !== undefined || initial.sshKeyNames !== undefined) setShowAll(true)
    if (initial.cloudInit !== undefined) {
      setCloudInit(initial.cloudInit)
      setCloudInitOn(!!initial.cloudInit.trim())
    }
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

  // Stock is per operating system, so plans are fetched for the chosen image.
  const sizesQuery = useSizes(client, { image: image?.slug ?? image?.id })
  const sizes = (sizesQuery.data || []) as SizeLike[]

  useEffect(() => {
    if (!isOpen) return
    const refresh = () => {
      void listServerTemplates()
        .then((items) => setTemplates(items.filter((i) => !i.error && i.template.spec.cloudInit)))
        .catch((err) => {
          setErrorField(null)
          setErrorMsg(err.message || 'Could not load templates.')
        })
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
        // The plan-reset effect only runs when the plan changes, so for the plan that is already selected the
        // template's memory and storage are applied here, rather than waiting for the next plan that is picked.
        if (sz.slug === sizeSlug) {
          if (p.memory !== undefined) setMemoryMb(p.memory)
          if (p.disk !== undefined) {
            setDiskGb(p.disk)
            diskChosenRef.current = true
          }
          p.memory = undefined
          p.disk = undefined
        }
      }
      p.sizeSlug = undefined
    }
    if (p.vpcName && vpcs.length) {
      const v = vpcs.find((x: any) => x.name === p.vpcName)
      if (v) setVpcId(v.id)
      p.vpcName = undefined
    }
    if (p.sshKeyNames && sshKeysQuery.data) {
      const names = p.sshKeyNames
      setSelectedKeys(sshKeys.filter((k: any) => names.includes(k.name)).map((k: any) => k.id))
      setTemplateKeyNames(names)
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

  // Plans too small for the chosen image are not listed, as in the web panel.
  const plans = useMemo(
    () => sizes.filter((s) => (s.size_type?.slug || 'vps') === planType && !belowImageMinimum(s, image)),
    [sizes, planType, image?.slug]
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
    setDiskGb(p?.disk ?? defaultDisk(selectedSize))
    diskChosenRef.current = p?.disk !== undefined
    if (p) {
      p.memory = undefined
      p.disk = undefined
    }
  }, [selectedSize?.slug])

  // Tick every default SSH key, as the web panel does, while nobody has decided otherwise. A background reload of the
  // list that returns a changed list used to tick the defaults again after an untick, and send them.
  useEffect(() => {
    if (keysTouchedRef.current || !sshKeysQuery.isSuccess) return
    setSelectedKeys(sshKeys.filter((k: any) => k.default).map((k: any) => k.id))
  }, [sshKeys])

  const memory = memoryMb ?? selectedSize?.memory ?? 0
  const disk = diskGb ?? (selectedSize ? defaultDisk(selectedSize) : 0)

  // An image with a larger minimum (Windows Server with SQL needs 30 GB) raises
  // the storage floor; a value below it would be rejected at create. While the storage
  // is the plan's own (nobody chose a size, and a template did not set one), it also follows
  // the floor back down when the image changes back, rather than staying at 30 GB and billing it.
  useEffect(() => {
    if (!selectedSize) return
    const floor = diskFloor(selectedSize, image)
    const wanted = Math.max(defaultDisk(selectedSize), floor)
    if (disk < floor) {
      setDiskGb(floor)
      diskChosenRef.current = false // the image decided it now, so it follows the image back down
    } else if (!diskChosenRef.current && disk !== wanted) setDiskGb(wanted)
  }, [selectedSize?.slug, image?.slug, disk])

  useEffect(() => {
    if (offsiteBackups && dailyBackups + weeklyBackups + monthlyBackups === 0) setOffsiteBackups(false)
  }, [dailyBackups, weeklyBackups, monthlyBackups, offsiteBackups])

  // The backups the request sends, and the total prices. The simple view
  // collapses the three retention dropdowns into one choice.
  // Offsite backups copy on-site ones, so with none of those there are no offsite backups either, whatever the box says.
  const backups = showAll
    ? { daily: dailyBackups, weekly: weeklyBackups, monthly: monthlyBackups, offsite: offsiteBackups && dailyBackups + weeklyBackups + monthlyBackups > 0 }
    : { daily: simpleBackups === 'none' ? 0 : 2, weekly: 0, monthly: 0, offsite: simpleBackups === 'both' }
  type Backups = typeof backups

  // The total and each simple-view backup option are priced by the same two steps,
  // the cost and then the account's tax treatment, so an option shows exactly what
  // choosing it adds to the total (with tax when the total has it, before tax when not).
  const priceWith = (b: typeof backups) => {
    if (!selectedSize) return 0
    return configuredCost({
      size: selectedSize,
      image,
      memoryMb: memory,
      diskGb: disk,
      ipCount,
      dailyBackups: b.daily,
      weeklyBackups: b.weekly,
      monthlyBackups: b.monthly,
      offsiteBackups: b.offsite
    }).total
  }
  const taxCode = accountQuery.data?.tax_code
  const monthly = priceWith(backups)
  const withTax = (b: typeof backups) => billingTotal(priceWith(b), taxCode).total
  const optionCost = (daily: number, offsite: boolean) =>
    withTax({ daily, weekly: 0, monthly: 0, offsite }) - withTax({ daily: 0, weekly: 0, monthly: 0, offsite: false })
  // Every "+$" on this form is what choosing the option adds to the Monthly Total, so it is on the total's basis and says
  // so: with the account's tax added ("incl. GST"), or "before tax" while the tax cannot be worked out.
  const basis = taxBasis(taxCode)
  const basisText = basis ? ` ${basis}` : ''
  // What a View All retention choice adds to the Monthly Total, with the other retentions and the offsite choice as they are:
  // the same calculation as the total, so it includes offsite copies of what it adds.
  const retentionCost = (word: 'daily' | 'weekly' | 'monthly', n: number) => {
    const at = (count: number): Backups => {
      const c = { daily: dailyBackups, weekly: weeklyBackups, monthly: monthlyBackups, [word]: count }
      return { ...c, offsite: offsiteBackups && c.daily + c.weekly + c.monthly > 0 }
    }
    return withTax(at(n)) - withTax(at(0))
  }
  // With no plan chosen there is nothing to price, so no price is shown rather than $0.00.
  const optionPrice = (daily: number, offsite: boolean) => (selectedSize ? ` (+$${optionCost(daily, offsite).toFixed(2)}${basisText})` : '')

  const { total: monthlyTotal, note: taxNote } = billingTotal(monthly, taxCode)

  if (!isOpen) return null

  // BinaryLane names a server created without a hostname, so a blank one is sent as no `name` at all.
  const host = hostnameFields(hostname)
  const userData = cloudInitToSend(acceptsUserData, cloudInitOn, cloudInit)

  // The keys the request names: the ticked ones, even none, once the form has the account's keys to show (a reload that
  // failed after they loaded still leaves them on screen) or a decision has been made. Before that the field is left
  // out and BinaryLane deploys the account's defaults.
  const sshKeysSent = sshKeysQuery.data !== undefined || keysTouchedRef.current ? selectedKeys : undefined

  // Shows the message, then moves focus to what it is about (or to the message itself) so it is read out and in view.
  const fail = (message: string, field: 'os' | 'plan' | 'agree' | null = null) => {
    flushSync(() => {
      setErrorMsg(message)
      setErrorField(field)
    })
    const radio = (sel: string) => planRef.current?.querySelector<HTMLInputElement>(sel)
    const target =
      (field === 'os' ? osRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        : field === 'plan' ? radio('input[type=radio]:checked:not(:disabled)') ?? radio('input[type=radio]:not(:disabled)')
        : field === 'agree' ? agreeRef.current
        : null) ??
      // With nothing there that can take focus, the message itself does.
      errorRef.current
    target?.focus()
  }
  const clearError = (field: 'os' | 'plan' | 'agree') => {
    if (errorField !== field) return
    setErrorMsg(null)
    setErrorField(null)
  }
  const errorId = `${uid}-error`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setErrorField(null)
    if (!image?.slug) return fail('Choose an operating system.', 'os')
    if (!selectedSize) return fail('Choose a plan.', 'plan')
    const blocked = planUnavailableReason(selectedSize, region, image)
    if (blocked) return fail(blocked.message, 'plan')
    if (!agreed) return fail('You need to accept the Terms of Service and refund policy.', 'agree')
    // A template that names keys cannot be honoured without the account's key list: sending none would contradict it.
    if (prefillRef.current?.sshKeyNames?.length && sshKeysQuery.data === undefined) return fail("Your SSH keys could not be loaded, so the template's keys cannot be selected. Try again in a moment.")

    // The form is the review, so this records rather than confirms — and the
    // id must be resolved either side of the request or History says
    // "Submitted" forever (#23).
    const changeId = await recordChange({
      label: 'Create server',
      target: { kind: 'server', name: host.historyTarget },
      severity: 'normal',
      changes: [
        ...host.changes,
        { label: 'Region', to: region },
        { label: 'Size', to: selectedSize.slug },
        { label: 'Image', to: image.slug },
        {
          label: 'SSH keys',
          to: sshKeysSent === undefined ? "the account's default keys (the list had not loaded)" : sshKeysSent.length ? sshKeysSent.map((id) => sshKeys.find((k: any) => k.id === id)?.name ?? `#${id}`).join(', ') : 'none'
        }
      ],
      source: 'ui'
    })
    try {
      const created = await createServer.mutateAsync({
        ...host.request,
        region,
        size: selectedSize.slug,
        image: image.slug,
        // What the form shows is what is deployed. An empty list means deploy none, and leaving the field
        // out deploys the account's default keys, so the list is always sent once the account's keys have
        // loaded and the form has been able to show them.
        ssh_keys: sshKeysSent,
        vpc_id: vpcId,
        options: {
          // Sent only when changed: left null, the plan's default applies, which
          // for std-8vcpu is the included 340 GB rather than a paid 400.
          ...(memory !== selectedSize.memory ? { memory } : {}),
          ...(disk !== defaultDisk(selectedSize) ? { disk } : {}),
          ipv4_addresses: ipCount,
          daily_backups: backups.daily,
          weekly_backups: backups.weekly,
          monthly_backups: backups.monthly,
          offsite_backups: backups.offsite
        },
        user_data: userData
      } as any)
      // With no hostname typed, the entry becomes the server BinaryLane named, so the entries do not all read "New server".
      const target = createdTarget(host, created)
      void updateChange(changeId, {
        outcome: 'completed',
        detail: createdDetail(host, created),
        ...(target ? { target } : {})
      })
      // A pair generated here becomes the new server's SSH key, so it connects first time.
      const generatedPath = selectedKeys.map((id) => generatedKeys[id]).find(Boolean)
      if (created?.id && generatedPath) setKeyAssociation(profileId, created.id, generatedPath, 'manual')
      onCreated?.({ id: created?.id, name: createdName(host, created) })
      resetForm()
      onClose()
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err?.message })
      fail(err.message || 'Failed to create the server.')
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
          <div className="p-12 flex items-center justify-center gap-2 text-xs text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading plans and images...
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-5">
            {/* ---------- 1. location and operating system ---------- */}
            <Section step={1} title="Select your location and operating system">
              {/* A failed read is not "no locations": say so, with a way to ask again. */}
              {regionsQuery.isError && !regionsQuery.data && (
                <div role="alert" className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
                  <span>Couldn't load the locations.</span>
                  <button type="button" onClick={() => void regionsQuery.refetch()} disabled={regionsQuery.isFetching} className="underline disabled:opacity-60">
                    Retry
                  </button>
                </div>
              )}
              <TileRow label="Location">
                {regions.map((r: any) => (
                  <Tile key={r.slug} selected={region === r.slug} onClick={() => setRegion(r.slug)} disabled={!r.available}>
                    {r.name}
                  </Tile>
                ))}
              </TileRow>

              <div ref={osRef}>
                <TileRow className="mt-3.5" label="Operating system" describedBy={errorField === 'os' ? errorId : undefined}>
                  {distros.map((d) => (
                    <Tile key={d} selected={distro === d} onClick={() => { setDistro(d); clearError('os') }} className="flex-col gap-2 py-3 sm:min-w-[104px]">
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
                    <div id={`${uid}-version`} className="text-sm font-semibold text-[#212529] dark:text-white mt-4 mb-2">Select Version</div>
                    <TileRow labelledBy={`${uid}-version`}>
                      {versions.map((v) => (
                        <Tile key={v.slug} selected={image?.slug === v.slug} onClick={() => { setImageSlug(v.slug || null); clearError('os') }}>
                          {(v as any).name?.trim() || v.slug}
                        </Tile>
                      ))}
                    </TileRow>
                  </>
                )}
              </div>
              <FormError ref={errorRef} id={errorId} message={errorField === 'os' ? errorMsg : null} />
            </Section>

            {/* ---------- 2. plan ---------- */}
            <Section step={2} title="Choose your Cloud Server resources">
              <TileRow label="Plan type">
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
              <div ref={planRef} className="mt-3 border border-[#ced4da] dark:border-[#373b3e] rounded overflow-x-auto">
                <table className="w-full text-[0.625rem] sm:text-xs whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#f8f9fa] dark:bg-[#212529] text-fg-muted text-left">
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
                      const choose = () => {
                        if (blocked) return
                        setSizeSlug(p.slug)
                        clearError('plan')
                      }
                      return (
                        <tr
                          key={p.slug}
                          id={`${uid}-plan-${p.slug}`}
                          onClick={choose}
                          title={blocked?.message || undefined}
                          className={`${
                            blocked
                              ? 'opacity-45 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]'
                          } ${isSel ? 'bg-[#017cb6]/10' : ''}`}
                        >
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-center">
                            <span className="flex items-center gap-1 sm:gap-2">
                              {blocked && <BlockedMark />}
                              {/* A real radio, so the plans are a group the keyboard moves through; it is named by its row. */}
                              <input
                                type="radio"
                                name={`${uid}-plan`}
                                checked={isSel}
                                disabled={!!blocked}
                                onChange={choose}
                                onClick={(e) => e.stopPropagation()}
                                aria-labelledby={`${uid}-plan-${p.slug}`}
                                title={blocked?.message || undefined}
                                aria-invalid={errorField === 'plan'}
                                aria-describedby={errorField === 'plan' ? errorId : undefined}
                                className={blocked ? 'sr-only' : 'w-3 h-3 sm:w-3.5 sm:h-3.5 m-0 shrink-0 cursor-pointer'}
                              />
                              <span className="text-[#212529] dark:text-white">
                                {p.vcpus} {p.vcpu_units || 'VCPU'}
                                {p.vcpus === 1 ? '' : 's'}
                              </span>
                            </span>
                          </td>
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-center">
                            {isSel && memoryChoices(p).length > 1 ? (
                              <Select label="Memory" value={memory} onChange={(v) => setMemoryMb(v)} options={memoryChoices(p).map((m) => ({ value: m, label: `${m / 1024} GB` }))} />
                            ) : (
                              <span className="text-[#212529] dark:text-white">{p.memory / 1024} GB</span>
                            )}
                          </td>
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-center">
                            {isSel && diskChoices(p, image).length > 1 ? (
                              <Select label="Storage" value={disk} onChange={(v) => { diskChosenRef.current = true; setDiskGb(v) }} options={diskChoices(p, image).map((d) => ({ value: d, label: `${d} GB` }))} />
                            ) : (
                              <span className="text-[#212529] dark:text-white">
                                {defaultDisk(p)} GB{p.storage_description ? ` ${p.storage_description.trim()}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[#212529] dark:text-white">{p.transfer * 1000} GB</td>
                          <td className="py-1.5 px-1 sm:py-2 sm:px-3 text-right font-medium text-[#212529] dark:text-white">
                            ${planMonthlyPrice(p, image, isSel ? memory : p.memory, isSel ? disk : defaultDisk(p)).toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <PlanBlockNotes blocks={planBlocks as PlanBlock[]} />
              </div>
              <FormError ref={errorRef} id={errorId} message={errorField === 'plan' ? errorMsg : null} />
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
              <Field label="Hostname" htmlFor={`${uid}-hostname`} hint="Optional. Such as vps01.yourcompany.com. It does not matter if you do not yet own this domain name. If you leave it blank, BinaryLane names the server.">
                <input
                  id={`${uid}-hostname`}
                  aria-describedby={`${uid}-hostname-hint`}
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="server.example.com"
                  className="w-full max-w-sm px-2.5 py-1.5 text-xs bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
                />
                {/* Under the hostname, so it shows in both layouts, and only when cloud-init is going to be sent with no hostname. */}
                {host.blank && userData && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No hostname is set, so BinaryLane gives the server a name of its own. BLDesk does not update a hostname already written into the cloud-init, including one a template filled in for {'{{hostname}}'}.
                  </p>
                )}
              </Field>

              {!showAll ? (
                <Field label="Backups">
                  {(
                    [
                      ['onsite', `Onsite daily backups, stored for 2 days${optionPrice(2, false)}`],
                      ['both', `Onsite and offsite daily backups, stored for 2 days${optionPrice(2, true)}`],
                      ['none', 'Backups are not required']
                    ] as const
                  ).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" name={`${uid}-backups`} checked={simpleBackups === val} onChange={() => setSimpleBackups(val)} />
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
                      {vpcs.map((v: any) => (
                        <Tile key={v.id} selected={vpcId === v.id} onClick={() => setVpcId(v.id)}>
                          {v.name}
                        </Tile>
                      ))}
                    </TileRow>
                  </Field>

                  <Field label="SSH Keys" hint="Select your SSH key/s to deploy during installation, or add a new keypair. With none selected, no SSH key is deployed.">
                    {missingKeyNames.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">The template names keys this account does not have: {missingKeyNames.join(', ')}.</p>
                    )}
                    <TileRow>
                      {sshKeys.map((k: any) => {
                        const on = selectedKeys.includes(k.id)
                        return (
                          <Tile
                            key={k.id}
                            selected={on}
                            onClick={() => {
                              keysTouchedRef.current = true
                              setSelectedKeys((prev) => (on ? prev.filter((x) => x !== k.id) : [...prev, k.id]))
                            }}
                          >
                            {on && <Check className="w-3 h-3" />}
                            {k.name}
                          </Tile>
                        )
                      })}
                      <Tile onClick={() => setAddKeyOpen(true)}>
                        <Plus className="w-3 h-3" /> Add SSH Key
                      </Tile>
                      {canGenerateKeyPair() && (
                        <Tile onClick={() => setGenerateOpen(true)}>
                          <KeyRound className="w-3 h-3" /> Generate Key Pair
                        </Tile>
                      )}
                    </TileRow>
                  </Field>

                  <Field label="IP Addresses" htmlFor={`${uid}-ips`} hint="Additional IP addresses may be purchased for approved uses including multiple SSL certificates.">
                    <Select
                      id={`${uid}-ips`}
                      value={ipCount}
                      onChange={setIpCount}
                      options={Array.from({ length: selectedSize?.options?.ipv4_addresses_max || 1 }, (_, i) => ({
                        value: i + 1,
                        label: i === 0 ? '1 IP address (included)' : `${i + 1} IP addresses (+$${billingTotal(i * (selectedSize?.options?.ipv4_addresses_cost_per_address || 0), taxCode).total.toFixed(2)}${basisText})`
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
                          <label htmlFor={`${uid}-${word}`} className="block text-[0.6875rem] text-fg-muted dark:text-[#adb5bd] mb-1">{label}</label>
                          <Select
                            id={`${uid}-${word}`}
                            value={value}
                            onChange={setter as (v: number) => void}
                            options={Array.from({ length: 11 }, (_, n) => ({
                              value: n,
                              // Shared with Change Plan so the two cannot drift
                              // from the web panel's wording independently -
                              // this said "periods" for weekly and monthly.
                              label: !selectedSize || n === 0 ? retentionOptionLabel(word, n, disk, selectedSize) : `${retentionWording(word, n)} (+$${retentionCost(word, n).toFixed(2)} per month${basisText})`
                            }))}
                          />
                        </div>
                      ))}
                      <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={backups.offsite}
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
                          <select aria-label="Load cloud-init from template" defaultValue="" onChange={(e) => { const item = templates.find((t) => t.slug === e.target.value); if (item?.template.spec.cloudInit) setCloudInit(item.template.spec.cloudInit); e.currentTarget.value = '' }} className="px-2.5 py-1.5 text-xs rounded border bg-white dark:bg-[#212529] border-[#ced4da] dark:border-[#373b3e]">
                            <option value="">Load cloud-init from template…</option>
                            {templates.map((item) => <option key={item.slug} value={item.slug}>{item.template.name}</option>)}
                          </select>
                          <span className="text-[0.6875rem] text-fg-muted dark:text-slate-400 self-center">Templates with variables are applied from the Templates tab, which fills them in.</span>
                        </div>
                        <textarea
                          aria-label="Cloud-init user data"
                          value={cloudInit}
                          onChange={(e) => setCloudInit(e.target.value)}
                          rows={8}
                          spellCheck={false}
                          placeholder={'#cloud-config\npackages:\n  - nginx'}
                          className="mt-2 w-full px-2.5 py-2 text-[0.6875rem] font-mono bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
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
                  <span className="text-fg-muted dark:text-[#adb5bd]">Monthly Total</span>
                  <span className="text-[#212529] dark:text-white">
                    {selectedSize ? `$${monthlyTotal.toFixed(2)}${taxNote ? ` ${taxNote}` : ''}` : '—'}
                  </span>
                </div>
                <p className="text-fg-muted dark:text-[#adb5bd] leading-relaxed">
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
                      options: { memory, disk, ipv4_addresses: ipCount, daily_backups: backups.daily, weekly_backups: backups.weekly, monthly_backups: backups.monthly, offsite_backups: backups.offsite },
                      vpc: vpcId ? (vpcs.find((v: any) => v.id === vpcId)?.name as string | undefined) : undefined,
                      // None ticked is recorded as none ([]), which is not the same as saying nothing: a template that says
                      // nothing deploys the account's default keys when it is used.
                      sshKeys: sshKeysSent ? sshKeys.filter((k: any) => sshKeysSent.includes(k.id)).map((k: any) => k.name as string) : undefined,
                      cloudInit: cloudInitOn && cloudInit.trim() ? cloudInit : undefined
                    }
                  })}
                  className="mt-3 text-xs text-fg-link hover:underline"
                >
                  Save this form as a template instead
                </button>
              )}

              <label className="flex items-center gap-2 text-xs mt-3 cursor-pointer">
                <input
                  ref={agreeRef}
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => {
                    setAgreed(e.target.checked)
                    clearError('agree')
                  }}
                  aria-invalid={errorField === 'agree'}
                  aria-describedby={errorField === 'agree' ? errorId : undefined}
                />
                <span className="text-[#212529] dark:text-white">
                  I agree to the{' '}
                  <LinkOut href={TOS_URL}>Terms of Service</LinkOut> and <LinkOut href={REFUND_URL}>refund policy</LinkOut>.
                </span>
              </label>

              <FormError ref={errorRef} id={errorId} message={errorField === 'os' || errorField === 'plan' ? null : errorMsg} />

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
            const changeId = await recordChange({
              label: 'Add SSH key',
              target: { kind: 'sshkey', name },
              severity: 'normal',
              changes: [
                { label: 'Public key', to: publicKey.slice(0, 40) + '…' },
                ...(makeDefault ? [{ label: 'Default for new installations', to: 'Yes' }] : [])
              ],
              source: 'ui'
            })
            try {
              const created = await addSshKey.mutateAsync({ name, publicKey, makeDefault })
              void updateChange(changeId, { outcome: 'completed' })
              // Tick the new key for this server, as the web panel does.
              keysTouchedRef.current = true
              if (created?.id) setSelectedKeys((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]))
            } catch (err: any) {
              void updateChange(changeId, { outcome: 'failed', detail: err.message })
              throw err
            }
            await sshKeysQuery.refetch()
            setAddKeyOpen(false)
          }}
        />
      )}

      {generateOpen && (
        <GenerateKeyPairDialog
          client={client}
          initialName={hostname.trim()}
          z={80}
          onClose={() => setGenerateOpen(false)}
          onAdded={(keyId, privateKeyPath) => {
            keysTouchedRef.current = true
            setGeneratedKeys((prev) => ({ ...prev, [keyId]: privateKeyPath }))
            setSelectedKeys((prev) => (prev.includes(keyId) ? prev : [...prev, keyId]))
            void sshKeysQuery.refetch()
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
      <h4 className="flex items-center gap-2 text-sm font-bold text-fg-link">
        <span className="w-5 h-5 shrink-0 rounded-full bg-[#f1ca00] text-[#212529] text-[0.6875rem] font-bold flex items-center justify-center">
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
 * On a phone, tiles sit three to a line, each a third of it, and only fall back to
 * free-flowing wrap once there is room. `flex flex-wrap` alone left ragged,
 * left-bunched rows on a narrow screen because the items keep their intrinsic width.
 * A third is where a tile starts, not a cap: a fixed three-column grid pushed
 * "Melbourne" and "AlmaLinux" out of their tiles at Android's largest text sizes,
 * where a WebView before 146 enlarges the text but not the boxes, so no length unit
 * follows it. A word wider than a third widens its tile instead, and the line wraps.
 */
const TileRow: React.FC<{ children: React.ReactNode; className?: string; label?: string; labelledBy?: string; describedBy?: string }> = ({
  children,
  className = '',
  label,
  labelledBy,
  describedBy
}) => (
  <div
    role={label || labelledBy ? 'group' : undefined}
    aria-label={label}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    className={`flex flex-wrap gap-2 max-sm:[&>*]:basis-[calc((100%-1rem)/3)] [&>*]:max-w-full ${className}`}
  >
    {children}
  </div>
)

/** A choice tile, or (without `selected`) a plain action button in the same style. */
const Tile: React.FC<{
  selected?: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}> = ({ selected, disabled, onClick, className = '', children }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-pressed={selected}
    className={`flex items-center justify-center gap-2 px-2.5 py-2 text-xs sm:px-4 sm:py-2.5 sm:text-sm font-medium rounded border transition ${
      selected
        ? 'bg-[#6c757d] text-white border-[#6c757d]'
        : 'bg-[#f8f9fa] dark:bg-[#212529] text-[#495057] dark:text-[#adb5bd] border-[#ced4da] dark:border-[#373b3e] hover:border-[#017cb6]'
    } disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
  >
    {children}
  </button>
)

/*
 * A submit error, shown beside the part of the form it is about. The container is always in the page so a message
 * put into it is announced; `id` is what the invalid control's aria-describedby names.
 */
const FormError = React.forwardRef<HTMLDivElement, { id: string; message: string | null }>(({ id, message }, ref) => (
  <div aria-live="polite">
    {message && (
      <div ref={ref} id={id} tabIndex={-1} className="mt-3 flex items-start gap-2 p-2.5 rounded border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs outline-none">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span className="break-words">{message}</span>
      </div>
    )}
  </div>
))

const Select: React.FC<{
  value: number
  onChange: (v: number) => void
  options: { value: number; label: string }[]
  id?: string
  label?: string
}> = ({ value, onChange, options, id, label }) => (
  <span className="relative inline-flex items-center">
    <select
      id={id}
      aria-label={label}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(Number(e.target.value))}
      className="appearance-none pl-1.5 pr-5 py-0.5 text-[0.6875rem] sm:pl-2 sm:pr-6 sm:py-1 sm:text-xs bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
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

/*
 * With `htmlFor` the label names that one control (and the hint is `${htmlFor}-hint`, for its aria-describedby);
 * without it the field holds several controls and is a group named by the label.
 */
const Field: React.FC<{ label: string; hint?: string; htmlFor?: string; children: React.ReactNode }> = ({ label, hint, htmlFor, children }) => {
  const labelId = useId()
  return (
    <div
      role={htmlFor ? undefined : 'group'}
      aria-labelledby={htmlFor ? undefined : labelId}
      className="py-2.5 border-b border-[#ced4da]/60 dark:border-[#373b3e] last:border-0 space-y-1.5"
    >
      {hint && <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-[0.6875rem] text-fg-muted dark:text-[#adb5bd] leading-relaxed">{hint}</p>}
      {htmlFor ? (
        <label id={labelId} htmlFor={htmlFor} className="block text-[0.6875rem] text-fg-muted dark:text-[#adb5bd]">{label}</label>
      ) : (
        <div id={labelId} className="text-[0.6875rem] text-fg-muted dark:text-[#adb5bd]">{label}</div>
      )}
      {children}
    </div>
  )
}

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
            <span className="text-fg-muted dark:text-[#adb5bd]">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-fg-muted dark:text-[#adb5bd]">Public Key</span>
            <textarea
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              rows={5}
              spellCheck={false}
              className="w-full px-2.5 py-1.5 font-mono text-[0.6875rem] bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
            />
            <span className="block text-[0.625rem] text-fg-muted">
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
