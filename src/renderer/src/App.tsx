import React, { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar, ActiveTab, ServerSubTab } from './components/layout/Sidebar'
import { BottomNav } from './components/layout/BottomNav'
import { ServerList } from './components/servers/ServerList'
import { ServerDetails } from './components/servers/ServerDetails'
import { AuthModal } from './components/auth/AuthModal'
import { CommandPalette } from './components/palette/CommandPalette'
import { TerminalView } from './components/terminal/TerminalView'
import { openSsh } from './lib/openSsh'
import { VpcManager } from './components/vpcs/VpcManager'
import { DnsManager } from './components/dns/DnsManager'
import { SshKeysManager } from './components/keys/SshKeysManager'
import { FirewallManager } from './components/firewall/FirewallManager'
import { LoadBalancerManager } from './components/loadbalancers/LoadBalancerManager'
import { BackupManager } from './components/backups/BackupManager'
import { BillingOverview } from './components/billing/BillingOverview'
import { AccountOverview } from './components/account/AccountOverview'
import { ActionInteractionPrompt } from './components/actions/ActionInteractionPrompt'
import { ActionToasts } from './components/actions/ActionToasts'
import { ActionTrackerProvider } from './context/ActionTrackerContext'
import { ConfirmProvider } from './context/ConfirmContext'
import { HistoryView } from './components/history/HistoryView'
import { HelpView } from './components/help/HelpView'
import { HELP_OPEN_EVENT, type HelpLocation } from './lib/helpNavigation'
import { NetworkMap } from './components/map/NetworkMap'
import { TemplatesView } from './components/templates/TemplatesView'
import type { ServerTemplate } from './lib/serverTemplates'
import { FleetHeatmap } from './components/heatmap/FleetHeatmap'
import { setChangeLogProfile } from './lib/changelog'
import { useServers, useBalance, useActionsAwaitingInteraction, useUnpaidInvoices } from './api/queries'
import { useFleetWatch } from './lib/fleetWatch'
import { usePowerState, annotateServers } from './lib/powerState'
import { useTrackedActions } from './context/ActionTrackerContext'
import { createBinaryLaneClient } from './api/client'
import { AccountProfile } from '@shared/ipc-types'
import { ThemeProvider } from './context/ThemeContext'
import { useDeepLinkRouter } from './lib/deeplinks'
import { AlertCircle, KeyRound, X, Server, Loader2 } from 'lucide-react'

// Strict QueryClient settings: Never retry failed mutations (create/update/delete/actions) to prevent spamming!
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 20, // 20s freshness
      refetchOnWindowFocus: false,
      retry: (failureCount, error: any) => {
        // Never retry 401/403 auth errors or 404 missing resource errors
        if (error?.status === 401 || error?.status === 403 || error?.status === 404) return false
        return failureCount < 2
      }
    },
    mutations: {
      retry: 0 // ZERO automatic retries on ANY create/update/delete/action mutation!
    }
  }
})

/**
 * Feeds the tray and raises background notifications. A separate component so
 * it can sit inside ActionTrackerProvider and see in-flight actions.
 */
function FleetWatch({
  servers,
  isFetchedAfterMount,
  client,
  activeProfile
}: {
  servers: any[]
  isFetchedAfterMount: boolean
  client: ReturnType<typeof createBinaryLaneClient> | null
  activeProfile: AccountProfile | null
}) {
  const { tracked } = useTrackedActions()
  const { data: balance } = useBalance(client)
  const { data: awaiting = [] } = useActionsAwaitingInteraction(client, activeProfile?.id)
  const { data: unpaid = [] } = useUnpaidInvoices(client)
  useFleetWatch({
    servers,
    isFetchedAfterMount,
    inProgress: tracked.filter((t) => t.state === 'running').length,
    awaitingAnswerIds: awaiting.map((a) => a.id),
    trackedIds: tracked.map((t) => t.actionId),
    failedInvoices: unpaid.length,
    accountName: activeProfile?.name,
    availableCredit: balance?.available_credit,
    profileId: activeProfile?.id
  })
  return null
}

function MainDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('servers')
  const [helpLocation, setHelpLocation] = useState<HelpLocation>({})
  useEffect(() => {
    const open = (event: Event) => { setHelpLocation({ ...(event as CustomEvent<HelpLocation>).detail }); setActiveTab('help') }
    window.addEventListener(HELP_OPEN_EVENT, open)
    return () => window.removeEventListener(HELP_OPEN_EVENT, open)
  }, [])
  // Templates tab hand-offs: a capture to edit, or a palette "create X from Y".
  const [templateDraft, setTemplateDraft] = useState<ServerTemplate | null>(null)
  const [templateApply, setTemplateApply] = useState<{ template: string; hostname: string } | null>(null)
  const openTemplateDraft = (draft: ServerTemplate) => {
    setTemplateDraft(draft)
    setSelectedServer(null)
    setActiveTab('templates')
  }
  const [selectedServer, setSelectedServer] = useState<any | null>(null)
  const [activeServerSubTab, setActiveServerSubTab] = useState<ServerSubTab>('overview')
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false)
  const [profiles, setProfiles] = useState<Omit<AccountProfile, 'token'>[]>([])
  const [activeProfile, setActiveProfile] = useState<AccountProfile | null>(null)
  const [authErrorBanner, setAuthErrorBanner] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  // Linux draws nothing around a frameless window — no border, no shadow — so
  // the app looked like a flat rectangle. A one-pixel inset border stands in
  // for the window manager's, and drops away when maximised. macOS and Windows
  // draw their own.
  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    void window.bldeskApi?.isMaximized?.().then(setIsMaximized)
    return window.bldeskApi?.onWindowMaximized?.(setIsMaximized)
  }, [])
  const linuxFrame = window.bldeskApi?.platform === 'linux' && !isMaximized

  const refreshProfiles = async () => {
    if (!window.bldeskApi) {
      // If outside Electron (mobile/web), dynamically load and initialize mobile bridge
      try {
        const { initMobileBridge } = await import('./api/mobile-bridge')
        await initMobileBridge()
      } catch (e) {
        console.warn('[App] Mobile bridge init warning:', e)
      }
    }

    if (!window.bldeskApi) {
      setIsInitializing(false)
      return
    }
    try {
      const pList = await window.bldeskApi.getProfiles()
      const active = await window.bldeskApi.getActiveProfile()
      setProfiles(pList)
      setActiveProfile(active)

      if (pList.length === 0) {
        setIsAuthOpen(true)
      }
    } catch (err) {
      console.error('[MainDashboard] Error loading profiles:', err)
    } finally {
      setIsInitializing(false)
    }
  }

  useEffect(() => {
    refreshProfiles()

    // Listen for global auth errors dispatched by API client
    const handleAuthError = () => {
      setAuthErrorBanner('API token authorization failed. Please verify or update your token in settings.')
    }
    window.addEventListener('bldesk:auth_error', handleAuthError)
    return () => window.removeEventListener('bldesk:auth_error', handleAuthError)
  }, [])

  // The change log stamps entries with the active account.
  useEffect(() => {
    setChangeLogProfile(activeProfile?.id)
  }, [activeProfile?.id])

  // A failed token belongs to the profile that raised it. Without this the banner
  // followed you to accounts whose keys are fine, reporting a failure that wasn't
  // theirs and couldn't be dismissed by switching away.
  useEffect(() => {
    setAuthErrorBanner(null)
  }, [activeProfile?.id])

  // Create API Client with Active Profile Token
  const client = React.useMemo(() => {
    return activeProfile?.token ? createBinaryLaneClient(activeProfile.token) : null
  }, [activeProfile?.token])

  // Queries with local cache rehydration
  const { data: apiServers = [], isLoading: isLoadingServers, isFetchedAfterMount } = useServers(client, activeProfile?.id)

  // The API's `status` does not track power (vps/vps #161). Every view below
  // gets servers whose `status` reflects the inferred power state instead, with
  // the API's own value kept on `_apiStatus`. See lib/powerState.ts.
  const { observations: powerObservations, confirmPowerState } = usePowerState(client, apiServers, activeProfile?.id)
  const servers = React.useMemo(() => annotateServers(apiServers, powerObservations), [apiServers, powerObservations])

  /*
   * Tell the main process which addresses may be probed (FEATURES.md #11).
   * reachability.ts refuses anything not on this list. Since the renderer sets
   * the list, this guards against bugs rather than a hostile renderer; the rate
   * limit in main covers the rest. Kept in step with the server list.
   */
  React.useEffect(() => {
    const ips = apiServers.flatMap((s) => (s.networks?.v4 ?? []).map((n) => n.ip_address).filter(Boolean))
    void window.bldeskApi?.setProbeTargets?.(ips as string[])
  }, [apiServers])

  // `selectedServer` is the object clicked in the list, copied at click time. The
  // details header reads status from it, so without this a server shut down
  // from the details view said "Running" until you went back and re-opened it.
  const liveSelectedServer = React.useMemo(
    () => (selectedServer ? (servers.find((s) => s.id === selectedServer.id) ?? selectedServer) : null),
    [servers, selectedServer]
  )

  const handleSwitchProfile = async (profileId: string) => {
    if (!window.bldeskApi) return
    setAuthErrorBanner(null)
    await window.bldeskApi.setActiveProfile(profileId)
    await refreshProfiles()
    queryClient.invalidateQueries()
  }

  const handleOpenTerminalForIp = (ip: string) => {
    void openSsh({ host: ip, username: 'root' })
  }

  const handleSelectTab = (tab: ActiveTab) => {
    setSelectedServer(null)
    setActiveTab(tab)
  }

  const handleSelectServer = (server: any) => {
    setSelectedServer(server)
    setActiveServerSubTab('overview')
  }

  // bldesk:// deep links (cold start + while running)
  useDeepLinkRouter({
    profiles,
    activeProfile,
    client,
    servers,
    isLoadingServers,
    onSwitchProfile: handleSwitchProfile,
    onSelectServer: handleSelectServer,
    onSelectServerSubTab: setActiveServerSubTab,
    onSelectTab: setActiveTab
  })

  if (isInitializing) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#212529] text-[#f8f9fa] space-y-4 select-none">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#017cb6]/20 flex items-center justify-center">
            <Server className="w-6 h-6 text-[#017cb6]" />
          </div>
          <div className="text-2xl font-bold tracking-tight">
            <span className="text-[#017cb6]">binary</span>
            <span className="text-[#f1ca00]">lane</span>
            <span className="text-xs font-normal text-[#6c757d] ml-2">BLDesk</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-xs text-[#adb5bd]">
          <Loader2 className="w-4 h-4 text-[#017cb6] animate-spin" />
          <span>Connecting to BinaryLane Cloud...</span>
        </div>
      </div>
    )
  }

  return (
    <ConfirmProvider>
    <ActionTrackerProvider client={client} confirmPowerState={confirmPowerState}>
      <FleetWatch servers={servers} isFetchedAfterMount={isFetchedAfterMount} client={client} activeProfile={activeProfile} />
      <div
        className={`h-screen w-screen flex flex-col bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa] overflow-hidden font-sans select-none ${
          linuxFrame ? 'ring-1 ring-inset ring-[#212529]/30 dark:ring-white/20' : ''
        }`}
      >
        {/* Frameless Custom Titlebar */}
        <TitleBar
          activeProfile={activeProfile}
          profiles={profiles}
          onSwitchProfile={handleSwitchProfile}
          onOpenAuth={() => setIsAuthOpen(true)}
          onOpenCommandPalette={() => setIsPaletteOpen(true)}
          onToggleMobileDrawer={() => setIsMobileDrawerOpen((prev) => !prev)}
        />

        {/* Auth Error Banner if Token Fails / Returns 401 */}
        {authErrorBanner && (
          <div className="bg-amber-500 text-slate-900 px-4 py-2 text-xs font-medium flex items-center justify-between shadow-md z-30 animate-in slide-in-from-top duration-150">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{authErrorBanner}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsAuthOpen(true)}
                className="bg-slate-900 text-white hover:bg-slate-800 px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                <span>Update API Token</span>
              </button>
              <button onClick={() => setAuthErrorBanner(null)} className="p-0.5 hover:bg-black/10 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Main Workspace Layout */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Navigation Sidebar (Global + SubNav + Mobile Drawer) */}
          <Sidebar
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            serverCount={servers.length}
            selectedServer={selectedServer}
            activeServerSubTab={activeServerSubTab}
            onSelectServerSubTab={setActiveServerSubTab}
            onBackToServers={() => setSelectedServer(null)}
            isMobileDrawerOpen={isMobileDrawerOpen}
            onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
          />

          {/* Dynamic Center Viewport */}
          <main className="flex-1 overflow-hidden bg-[#f8f9fa] dark:bg-[#212529] relative pb-14 md:pb-0 select-text">
            {activeTab === 'servers' && (
              selectedServer ? (
                <ServerDetails
                  server={liveSelectedServer}
                  servers={servers}
                  client={client}
                  activeSubTab={activeServerSubTab}
                  onSelectSubTab={setActiveServerSubTab}
                  onBack={() => setSelectedServer(null)}
                  onOpenTerminal={handleOpenTerminalForIp}
                  onSaveAsTemplate={openTemplateDraft}
                />
              ) : (
                <ServerList
                  servers={servers}
                  isLoading={isLoadingServers && servers.length === 0}
                  client={client}
                  onSelectServer={handleSelectServer}
                  onOpenTerminal={handleOpenTerminalForIp}
                  onOpenTemplates={() => setActiveTab('templates')}
                />
              )
            )}

            {window.bldeskApi?.pty ? <div className={activeTab === 'terminal' ? 'h-full' : 'hidden'}>
              <TerminalView servers={servers} profileId={activeProfile?.id} active={activeTab === 'terminal'} onActivate={() => setActiveTab('terminal')} />
            </div> : activeTab === 'terminal' && (
              // Reachable on Android via `go terminal` or bldesk://tab/terminal even though the sidebar hides the tab.
              <div className="p-6 text-sm text-[#6c757d] dark:text-slate-400">Embedded SSH is available in the desktop app only. Use the SSH button on a server to open your device's SSH client.</div>
            )}

            {activeTab === 'vpcs' && (
              <VpcManager
                servers={servers}
                client={client}
                onSelectServer={(s) => {
                  handleSelectServer(s)
                  setActiveTab('servers')
                }}
              />
            )}

            {activeTab === 'firewall' && (
              <FirewallManager client={client} profileId={activeProfile?.id} servers={servers} />
            )}

            {activeTab === 'loadbalancers' && (
              <LoadBalancerManager
                servers={servers}
                client={client}
                onSelectServer={(s) => {
                  handleSelectServer(s)
                  setActiveTab('servers')
                }}
              />
            )}

            {activeTab === 'dns' && (
              <DnsManager client={client} />
            )}

            {activeTab === 'backups' && (
              <BackupManager client={client} servers={servers} />
            )}

            {activeTab === 'keys' && (
              <SshKeysManager client={client} />
            )}

            {activeTab === 'billing' && (
              <BillingOverview client={client} />
            )}

            {activeTab === 'account' && (
              <AccountOverview client={client} />
            )}

            {activeTab === 'map' && (
              <NetworkMap
                client={client}
                servers={servers}
                onSelectServer={(s) => {
                  handleSelectServer(s)
                  setActiveTab('servers')
                }}
              />
            )}

            {activeTab === 'templates' && (
              <TemplatesView
                client={client}
                servers={servers}
                profileId={activeProfile?.id}
                draft={templateDraft}
                onDraftConsumed={() => setTemplateDraft(null)}
                applyRequest={templateApply}
                onApplyConsumed={() => setTemplateApply(null)}
              />
            )}

            {activeTab === 'heatmap' && (
              <FleetHeatmap
                client={client}
                servers={servers}
                serversLoading={isLoadingServers && servers.length === 0}
                onSelectServer={(server) => {
                  handleSelectServer(server)
                  setActiveServerSubTab('usage')
                  setActiveTab('servers')
                }}
              />
            )}

            {activeTab === 'history' && (
              <HistoryView profileId={activeProfile?.id} profileName={activeProfile?.name} />
            )}
            {activeTab === 'help' && <HelpView location={helpLocation} contextHint={selectedServer
              ? [selectedServer.image?.distribution, selectedServer.region?.name].filter(Boolean).join(', ')
              : undefined} />}
          </main>
        </div>

        {/* Mobile Bottom Bar */}
        <BottomNav activeTab={activeTab} onSelectTab={handleSelectTab} onOpenDrawer={() => setIsMobileDrawerOpen(true)} />

        {/* Encrypted Vault Modal */}
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          profiles={profiles}
          activeProfile={activeProfile}
          onProfileAddedOrUpdated={refreshProfiles}
        />

        {/* Command Palette (Ctrl+K / Cmd+K) */}
        <CommandPalette
          isOpen={isPaletteOpen}
          onOpen={() => setIsPaletteOpen(true)}
          onClose={() => setIsPaletteOpen(false)}
          servers={servers}
          client={client}
          profileId={activeProfile?.id}
          onSelectServer={handleSelectServer}
          onSelectServerSubTab={setActiveServerSubTab}
          onNavigateTab={setActiveTab}
          onCreateFromTemplate={(template, hostname) => {
            setTemplateApply({ template, hostname })
            setSelectedServer(null)
            setActiveTab('templates')
          }}
        />

        {/* Actions BinaryLane has paused pending an answer. Mounted at the shell so
            the question still reaches the user after they navigate away from the
            view that started it. */}
        <ActionInteractionPrompt client={client} profileId={activeProfile?.id} servers={servers} />

        {/* Outcomes of actions still running in the background, for the same reason. */}
        <ActionToasts />
      </div>
    </ActionTrackerProvider>
    </ConfirmProvider>
  )
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-[#212529] text-[#f8f9fa] flex flex-col items-center justify-center p-8 gap-4 select-text">
          <div className="flex items-center gap-3 text-red-400">
            <AlertCircle className="w-8 h-8" />
            <h1 className="text-xl font-bold">Something went wrong</h1>
          </div>
          <p className="text-sm text-[#adb5bd] max-w-md text-center">
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                localStorage.clear()
                window.location.reload()
              }}
              className="px-4 py-2 bg-[#017cb6] hover:bg-[#02699a] text-white rounded text-sm font-medium transition-colors"
            >
              Reset Cache & Reload
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#343a40] hover:bg-[#495057] text-[#f8f9fa] rounded text-sm font-medium transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <MainDashboard />
        </QueryClientProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  )
}
export default App
