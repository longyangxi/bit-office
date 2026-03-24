"use client"

import { useState, useEffect } from 'react'
import { TERM_BG, TERM_PANEL, TERM_BORDER, TERM_BORDER_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_DIM, TERM_GREEN, TERM_HOVER, TERM_SURFACE, TERM_SEM_GREEN, TERM_SEM_RED } from "./termTheme"
import { cn } from "@/lib/utils"
import type { OfficeLayout } from '../types'
import { sendCommand } from '@/lib/connection'
import { useOfficeStore } from '@/store/office-store'
import { APP_VERSION, APP_BUILD_TIME } from '@/lib/appMeta'
import TermModal from './primitives/TermModal'
import TermButton from './primitives/TermButton'
import TermInput from './primitives/TermInput'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  layout: OfficeLayout
  onImportLayout: (layout: OfficeLayout) => void
  onImportRoomZip?: (layout: OfficeLayout, backgroundImage: HTMLImageElement | null) => void
  soundEnabled: boolean
  onSoundEnabledChange: (enabled: boolean) => void
}

export default function SettingsModal({
  isOpen,
  onClose,
  soundEnabled,
  onSoundEnabledChange,
}: SettingsModalProps) {
  const [agentsUpdating, setAgentsUpdating] = useState(false)
  const [agentsMessage, setAgentsMessage] = useState<string | null>(null)
  const [tgToken, setTgToken] = useState('')
  const [tgUsers, setTgUsers] = useState('')
  const [tgSaving, setTgSaving] = useState(false)
  const [tgMessage, setTgMessage] = useState<string | null>(null)
  const [tgConnected, setTgConnected] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [worktreeOn, setWorktreeOn] = useState(true)
  const [autoMergeOn, setAutoMergeOn] = useState(true)
  const [tunnelToken, setTunnelToken] = useState('')
  const [tunnelBaseUrl, setTunnelBaseUrl] = useState('')
  const [tunnelRunning, setTunnelRunning] = useState(false)
  const [tunnelSaving, setTunnelSaving] = useState(false)
  const [tunnelMessage, setTunnelMessage] = useState<string | null>(null)
  const [showTunnelToken, setShowTunnelToken] = useState(false)
  const agencyResult = useOfficeStore((s) => s.agencyAgentsResult)
  const configData = useOfficeStore((s) => s.configData)
  const configResult = useOfficeStore((s) => s.configResult)

  useEffect(() => {
    if (isOpen) {
      sendCommand({ type: "GET_CONFIG" })
    }
  }, [isOpen])

  useEffect(() => {
    if (configData) {
      setTgToken(configData.telegramBotToken ?? '')
      setTgUsers(configData.telegramAllowedUsers?.join(', ') ?? '')
      setTgConnected(configData.telegramConnected ?? false)
      setWorktreeOn(configData.worktreeEnabled ?? true)
      setAutoMergeOn(configData.autoMergeEnabled ?? true)
      setTunnelToken(configData.tunnelToken ?? '')
      setTunnelBaseUrl(configData.tunnelBaseUrl ?? '')
      setTunnelRunning(configData.tunnelRunning ?? false)
    }
  }, [configData])

  useEffect(() => {
    if (configResult && tgSaving) {
      setTgSaving(false)
      setTgMessage(configResult.message)
      if (configResult.telegramConnected !== undefined) {
        setTgConnected(configResult.telegramConnected)
      }
      const t = setTimeout(() => setTgMessage(null), 5000)
      return () => clearTimeout(t)
    }
    if (configResult && tunnelSaving) {
      setTunnelSaving(false)
      if (configResult.tunnelRunning !== undefined) {
        setTunnelRunning(configResult.tunnelRunning)
      }
      setTunnelMessage(configResult.tunnelRunning ? 'Tunnel started' : 'Tunnel not running')
      const t = setTimeout(() => setTunnelMessage(null), 5000)
      return () => clearTimeout(t)
    }
  }, [configResult])

  useEffect(() => {
    if (agencyResult && agentsUpdating) {
      setAgentsUpdating(false)
      setAgentsMessage(
        agencyResult.success
          ? `Updated${agencyResult.count ? ` (${agencyResult.count} agents)` : ''}`
          : `Failed: ${agencyResult.message}`
      )
      const t = setTimeout(() => setAgentsMessage(null), 5000)
      return () => clearTimeout(t)
    }
  }, [agencyResult])

  const toggleSound = () => {
    const next = !soundEnabled
    onSoundEnabledChange(next)
    localStorage.setItem('office-sound-enabled', JSON.stringify(next))
  }

  const toggleWorktree = () => {
    const next = !worktreeOn
    setWorktreeOn(next)
    sendCommand({ type: "SAVE_CONFIG", worktreeEnabled: next })
  }

  const toggleAutoMerge = () => {
    const next = !autoMergeOn
    setAutoMergeOn(next)
    sendCommand({ type: "SAVE_CONFIG", autoMergeEnabled: next })
  }

  const handleSaveTelegram = () => {
    setTgSaving(true)
    setTgMessage(null)
    const allowedUsers = tgUsers
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    sendCommand({
      type: "SAVE_CONFIG",
      telegramBotToken: tgToken.includes('...') ? undefined : tgToken,
      telegramAllowedUsers: allowedUsers,
    })
  }

  const handleSaveTunnel = () => {
    setTunnelSaving(true)
    setTunnelMessage(null)
    sendCommand({
      type: "SAVE_CONFIG",
      tunnelToken: tunnelToken.includes('...') ? undefined : tunnelToken,
      tunnelBaseUrl: tunnelBaseUrl,
    })
  }

  const checkboxCls = (checked: boolean) => cn(
    "w-3.5 h-3.5 border-2 border-muted-foreground rounded-sm shrink-0",
    "flex items-center justify-center text-[11px] leading-none",
    checked ? "bg-accent text-background" : "bg-transparent",
  )

  const menuItemCls = "flex items-center justify-between w-full px-2.5 py-1.5 text-[15px] text-foreground bg-transparent border-none cursor-pointer text-left font-mono transition-colors duration-fast hover:bg-white/5"

  return (
    <TermModal
      open={isOpen}
      onClose={onClose}
      maxWidth={400}
      zIndex={100}
      title="Settings"
    >
      {/* ---- Telegram Section ---- */}
      <div className="border-b border-term-border-dim pb-2 mb-2">
        <div className="flex items-center gap-1.5 mb-2">
          <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", tgConnected ? "bg-sem-green" : "bg-muted-foreground")} />
          <span className="text-[13px] text-foreground font-medium">
            Telegram {tgConnected ? '(connected)' : '(disconnected)'}
          </span>
        </div>
        <div className="mb-2">
          <label className="text-term text-muted-foreground mb-1 block">Bot Token</label>
          <div className="flex gap-1">
            <TermInput
              type={showToken ? 'text' : 'password'}
              value={tgToken}
              onChange={e => setTgToken(e.target.value)}
              placeholder="123456:ABC-DEF..."
              style={{ flex: 1 }}
              onFocus={() => { if (tgToken.includes('...')) setTgToken('') }}
            />
            <TermButton
              variant="dim"
              onClick={() => setShowToken(!showToken)}
              title={showToken ? 'Hide' : 'Show'}
              style={{ padding: '4px 8px', fontSize: '14px' }}
            >{showToken ? '🙈' : '👁'}</TermButton>
          </div>
        </div>
        <div className="mb-2">
          <label className="text-term text-muted-foreground mb-1 block">
            Allowed User IDs <span className="opacity-60">(comma-separated, empty = all)</span>
          </label>
          <TermInput
            type="text"
            value={tgUsers}
            onChange={e => setTgUsers(e.target.value)}
            placeholder="123456789, 987654321"
          />
        </div>
        <div className="flex items-center gap-2">
          <TermButton
            variant="primary"
            onClick={handleSaveTelegram}
            disabled={tgSaving}
          >
            {tgSaving ? 'Saving...' : 'Save & Connect'}
          </TermButton>
          {tgMessage && (
            <span className={cn("text-term", tgMessage.includes('Failed') || tgMessage.includes('not') ? "text-sem-red" : "text-sem-green")}>
              {tgMessage}
            </span>
          )}
        </div>
      </div>

      {/* ---- Tunnel Section ---- */}
      <div className="border-b border-term-border-dim pb-2 mb-2">
        <div className="flex items-center gap-1.5 mb-2">
          <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", tunnelRunning ? "bg-sem-green" : "bg-muted-foreground")} />
          <span className="text-[13px] text-foreground font-medium">
            Tunnel {tunnelRunning ? '(running)' : '(stopped)'}
          </span>
        </div>
        <div className="mb-2">
          <label className="text-term text-muted-foreground mb-1 block">Tunnel Token</label>
          <div className="flex gap-1">
            <TermInput
              type={showTunnelToken ? 'text' : 'password'}
              value={tunnelToken}
              onChange={e => setTunnelToken(e.target.value)}
              placeholder="eyJ..."
              style={{ flex: 1 }}
              onFocus={() => { if (tunnelToken.includes('...')) setTunnelToken('') }}
            />
            <TermButton
              variant="dim"
              onClick={() => setShowTunnelToken(!showTunnelToken)}
              title={showTunnelToken ? 'Hide' : 'Show'}
              style={{ padding: '4px 8px', fontSize: '14px' }}
            >{showTunnelToken ? '\u{1F648}' : '\u{1F441}'}</TermButton>
          </div>
        </div>
        <div className="mb-2">
          <label className="text-term text-muted-foreground mb-1 block">
            Public URL
          </label>
          <TermInput
            type="text"
            value={tunnelBaseUrl}
            onChange={e => setTunnelBaseUrl(e.target.value)}
            placeholder="https://office.example.com"
          />
        </div>
        <div className="flex items-center gap-2">
          <TermButton
            variant="primary"
            onClick={handleSaveTunnel}
            disabled={tunnelSaving}
          >
            {tunnelSaving ? 'Saving...' : 'Save & Start'}
          </TermButton>
          {tunnelMessage && (
            <span className={cn("text-term", tunnelMessage.includes('not') || tunnelMessage.includes('Failed') ? "text-sem-red" : "text-sem-green")}>
              {tunnelMessage}
            </span>
          )}
        </div>
      </div>

      {/* ---- Toggles Section ---- */}
      <button onClick={toggleWorktree} className={menuItemCls} title="Each agent works in its own git worktree branch, merged on completion">
        <span>Agent Isolation</span>
        <span className={checkboxCls(worktreeOn)}>{worktreeOn ? '\u2713' : ''}</span>
      </button>
      <button onClick={toggleAutoMerge} className={menuItemCls} title="Auto-merge agent changes to main on task completion. Turn off to review before merging.">
        <span>Auto-merge</span>
        <span className={checkboxCls(autoMergeOn)}>{autoMergeOn ? '\u2713' : ''}</span>
      </button>
      <button onClick={toggleSound} className={menuItemCls}>
        <span>Sound Notifications</span>
        <span className={checkboxCls(soundEnabled)}>{soundEnabled ? '\u2713' : ''}</span>
      </button>
      <div className="border-t border-term-border-dim my-1" />
      <button
        onClick={() => { setAgentsUpdating(true); setAgentsMessage(null); sendCommand({ type: "UPDATE_AGENCY_AGENTS" }); }}
        disabled={agentsUpdating}
        className={cn(menuItemCls, agentsUpdating && "opacity-50")}
      >
        <span>{agentsUpdating ? 'Updating Agents...' : agentsMessage ?? 'Update Agency Agents'}</span>
        {agentsMessage && (
          <span className={cn("text-[11px]", agentsMessage.startsWith('Failed') ? "text-sem-red" : "text-sem-green")}>
            {agentsMessage.startsWith('Failed') ? '\u2717' : '\u2713'}
          </span>
        )}
      </button>
      <div className="border-t border-term-border-dim mt-1 pt-2 text-[11px] text-muted-foreground font-mono leading-snug select-text" title="From monorepo root package.json at build time">
        <div>
          <span className="opacity-75">Web UI</span>{' '}
          <span className="text-foreground">v{APP_VERSION}</span>
        </div>
        {APP_BUILD_TIME ? (
          <div className="mt-0.5 text-[10px] opacity-90">
            build {APP_BUILD_TIME.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}
          </div>
        ) : null}
      </div>
    </TermModal>
  )
}
