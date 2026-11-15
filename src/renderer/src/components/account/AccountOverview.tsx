import { HelpLink } from '../ui/HelpLink'
import React from 'react'
import {
  UserCircle,
  Mail,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Lock,
  Smartphone,
  Newspaper,
  CreditCard,
  ExternalLink,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useAccount, useBalance } from '../../api/queries'
import { MPANEL_URL } from '../ui/LinkOut'

/**
 * Account details.
 *
 * The BinaryLane API exposes account data as read-only: `GET /v2/account` returns
 * the email, verification state, account status, tax code, the *types* of payment
 * method configured, and whether app-based 2FA is on. There is no endpoint for
 * managing API tokens, changing the password, configuring 2FA, editing contact
 * details or setting newsletter preferences — those are mPanel-only.
 *
 * Rather than render controls that cannot work, anything the API can't do links
 * out to the web panel. Nothing here pretends to be actionable when it isn't.
 */

const MPANEL = MPANEL_URL

interface AccountOverviewProps {
  client: BinaryLaneClient | null
}

const openMpanel = (path: string) => window.bldeskApi?.openExternal?.(`${MPANEL}${path}`)

export const AccountOverview: React.FC<AccountOverviewProps> = ({ client }) => {
  const accountQuery = useAccount(client)
  const balanceQuery = useBalance(client)

  const account = accountQuery.data as any
  const balance = balanceQuery.data as any

  const paymentMethods: string[] = account?.configured_payment_methods || []
  const twoFactor = account?.two_factor_authentication_enabled === true
  const emailVerified = account?.email_verified === true

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto select-text bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
          <UserCircle className="w-5 h-5 text-fg-link" />
          <span className="flex-1">Account Details</span>
          <HelpLink slug="account" />
        </h1>
        <p className="text-xs text-fg-muted dark:text-[#adb5bd] mt-1">
          Account status and security, as reported by the BinaryLane API.
        </p>
      </div>

      {accountQuery.isError && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Couldn't load account details. Check the API token for this profile.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* --- Account --- */}
        <Card title="Account" icon={Mail}>
          <Row label="Email">
            <span className="font-medium break-all">{account?.email ?? <Muted>—</Muted>}</span>
          </Row>
          <Row label="Email verified">
            {emailVerified ? (
              <Pill tone="good" icon={CheckCircle2}>
                Verified
              </Pill>
            ) : (
              <Pill tone="warn" icon={AlertTriangle}>
                Unverified
              </Pill>
            )}
          </Row>
          <Row label="Status">
            <AccountStatusPill status={account?.status} />
          </Row>
          <Row label="Tax code">
            <span>
              {account?.tax_code?.name ?? <Muted>—</Muted>}
              {account?.tax_code?.fixed_percent != null && (
                <span className="text-fg-muted dark:text-[#adb5bd]"> ({account.tax_code.fixed_percent}%)</span>
              )}
            </span>
          </Row>
          <Row label="Additional IPv4 limit">
            <span className="font-mono">
              {account?.additional_ipv4_limit != null ? account.additional_ipv4_limit : <Muted>—</Muted>}
            </span>
          </Row>

          <MpanelNote>
            Name, organisation, phone and address are managed on the web.
            <MpanelLink onClick={() => openMpanel('/account')}>Update contact information</MpanelLink>
          </MpanelNote>
        </Card>

        {/* --- Security --- */}
        <Card title="Security" icon={ShieldCheck}>
          <Row label="Two-factor auth">
            {twoFactor ? (
              <Pill tone="good" icon={ShieldCheck}>
                Enabled
              </Pill>
            ) : (
              <Pill tone="warn" icon={ShieldAlert}>
                Not enabled
              </Pill>
            )}
          </Row>

          <div className="pt-1 space-y-1.5">
            <ActionLink icon={Smartphone} onClick={() => openMpanel('/account')}>
              Configure authenticator app
            </ActionLink>
            <ActionLink icon={Lock} onClick={() => openMpanel('/account')}>
              Change password
            </ActionLink>
            <ActionLink icon={KeyRound} onClick={() => openMpanel('/api-info')}>
              Manage API access tokens
            </ActionLink>
            <ActionLink icon={Newspaper} onClick={() => openMpanel('/account')}>
              Newsletter options
            </ActionLink>
          </div>

          <MpanelNote>
            Authenticator, password, API tokens and newsletter settings are managed on the web.
            <MpanelLink onClick={() => openMpanel('/account')}>Update account settings</MpanelLink>
          </MpanelNote>
        </Card>

        {/* --- Payment --- */}
        <Card title="Payment" icon={CreditCard}>
          <Row label="Configured methods">
            {paymentMethods.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {paymentMethods.map((m) => (
                  <span
                    key={m}
                    className="px-2 py-0.5 rounded bg-[#017cb6]/10 text-fg-link dark:text-[#4db2e0] text-[0.6875rem] font-semibold"
                  >
                    {m === 'paypal' ? 'PayPal' : m === 'credit-card' ? 'Credit card' : m}
                  </span>
                ))}
              </span>
            ) : (
              <Muted>None configured</Muted>
            )}
          </Row>
          <Row label="Available credit">
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {balance ? `$${(balance.available_credit ?? 0).toFixed(2)}` : <Muted>—</Muted>}
            </span>
          </Row>
          <Row label="Unbilled charges">
            <span className="font-mono font-semibold">
              {balance ? `$${(balance.unbilled_total ?? 0).toFixed(2)}` : <Muted>—</Muted>}
            </span>
          </Row>

          <MpanelNote>
            Payment methods are managed on the web.
            <MpanelLink onClick={() => openMpanel('/billing/payment-details')}>Change billing details</MpanelLink>
          </MpanelNote>
        </Card>

      </div>
    </div>
  )
}

// --- presentational helpers ---

const Card: React.FC<{ title: string; icon: React.FC<{ className?: string }>; children: React.ReactNode }> = ({
  title,
  icon: Icon,
  children
}) => (
  <div className="bg-white dark:bg-[#2b3035] border border-[#dee2e6] dark:border-[#373b3e] rounded-lg shadow-sm">
    <div className="px-4 py-2.5 border-b border-[#dee2e6] dark:border-[#373b3e] flex items-center gap-2">
      <Icon className="w-4 h-4 text-fg-link" />
      <h3 className="font-semibold text-xs text-[#495057] dark:text-[#ced4da]">{title}</h3>
    </div>
    <div className="p-4 space-y-2.5 text-xs">{children}</div>
  </div>
)

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-fg-muted dark:text-[#adb5bd] flex-shrink-0">{label}</span>
    <span className="text-right">{children}</span>
  </div>
)

const Muted: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[#adb5bd]">{children}</span>
)

const Pill: React.FC<{ tone: 'good' | 'warn' | 'bad'; icon: React.FC<{ className?: string }>; children: React.ReactNode }> = ({
  tone,
  icon: Icon,
  children
}) => {
  const tones = {
    good: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    warn: 'bg-[#f1ca00]/25 text-amber-700 dark:text-[#f1ca00]',
    bad: 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
  }
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.625rem] font-semibold ${tones[tone]}`}>
      <Icon className="w-3 h-3" />
      {children}
    </span>
  )
}

const AccountStatusPill: React.FC<{ status?: string }> = ({ status }) => {
  if (!status) return <Muted>—</Muted>
  const map: Record<string, { tone: 'good' | 'warn' | 'bad'; icon: React.FC<{ className?: string }> }> = {
    active: { tone: 'good', icon: CheckCircle2 },
    incomplete: { tone: 'warn', icon: AlertTriangle },
    warning: { tone: 'warn', icon: AlertTriangle },
    locked: { tone: 'bad', icon: ShieldAlert }
  }
  const cfg = map[status] || { tone: 'warn' as const, icon: AlertTriangle }
  return (
    <Pill tone={cfg.tone} icon={cfg.icon}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Pill>
  )
}

const ActionLink: React.FC<{ icon: React.FC<{ className?: string }>; onClick: () => void; children: React.ReactNode }> = ({
  icon: Icon,
  onClick,
  children
}) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-2 px-2 py-1.5 -mx-2 rounded text-left text-xs text-fg-link dark:text-[#4db2e0] hover:bg-[#017cb6]/10 transition"
  >
    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
    <span className="flex-1">{children}</span>
    <ExternalLink className="w-3 h-3 opacity-60 flex-shrink-0" />
  </button>
)

const MpanelNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pt-2.5 mt-1 border-t border-[#dee2e6] dark:border-[#373b3e] text-[0.6875rem] text-fg-muted dark:text-[#adb5bd] leading-relaxed">
    {children}
  </div>
)

const MpanelLink: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-1 ml-1 text-fg-link dark:text-[#4db2e0] hover:underline font-medium"
  >
    {children}
    <ExternalLink className="w-3 h-3" />
  </button>
)
