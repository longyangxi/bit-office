"use client"

import { useState, useEffect } from 'react'
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
  consoleCols?: number
  consoleRows?: number
  onConsoleColsChange?: (v: number) => void
  onConsoleRowsChange?: (v: number) => void
}

/** Horizontal form row: label on left, input on right */
function FormRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <label className="text-term text-muted-foreground shrink-0 w-[100px] text-right">
        {label}
        {hint && <span className="block text-[10px] opacity-50 mt-0.5">{hint}</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export default function SettingsModal({
  isOpen,
  onClose,
  soundEnabled,
  onSoundEnabledChange,
  consoleCols = 3,
  consoleRows = 1,
  onConsoleColsChange,
  onConsoleRowsChange,
}: SettingsModalProps) {
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

  const toggleCls = "flex items-center justify-between w-full px-3 py-2 text-term text-foreground bg-transparent border-none cursor-pointer text-left font-mono transition-colors duration-fast hover:bg-white/5"

  return (
    <TermModal
      open={isOpen}
      onClose={onClose}
      maxWidth={520}
      zIndex={100}
      title="Settings"
    >
      {/* ---- Telegram Section ---- */}
      <div className="border-b border-term-border-dim pb-3 mb-3">
        <div className="flex items-center gap-1.5 mb-3">
          <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", tgConnected ? "bg-sem-green" : "bg-muted-foreground")} />
          <span className="text-[13px] text-foreground font-medium">
            Telegram {tgConnected ? '(connected)' : '(disconnected)'}
          </span>
        </div>
        <FormRow label="Bot Token">
          <div className="flex gap-1">
            <TermInput
              type={showToken ? 'text' : 'password'}
              value={tgToken}
              onChange={e => setTgToken(e.target.value)}
              placeholder="123456:ABC-DEF..."
              className="flex-1"
              onFocus={() => { if (tgToken.includes('...')) setTgToken('') }}
            />
            <TermButton
              variant="dim"
              size="sm"
              onClick={() => setShowToken(!showToken)}
              title={showToken ? 'Hide' : 'Show'}
            >{showToken ? '\u{1F648}' : '\u{1F441}'}</TermButton>
          </div>
        </FormRow>
        <FormRow label="Allowed IDs" hint="comma-sep, empty=all">
          <TermInput
            type="text"
            value={tgUsers}
            onChange={e => setTgUsers(e.target.value)}
            placeholder="123456789, 987654321"
          />
        </FormRow>
        <div className="flex items-center gap-2 pl-[112px]">
          <TermButton variant="primary" onClick={handleSaveTelegram} disabled={tgSaving}>
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
      <div className="border-b border-term-border-dim pb-3 mb-3">
        <div className="flex items-center gap-1.5 mb-3">
          <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", tunnelRunning ? "bg-sem-green" : "bg-muted-foreground")} />
          <span className="text-[13px] text-foreground font-medium">
            Tunnel {tunnelRunning ? '(running)' : '(stopped)'}
          </span>
        </div>
        <FormRow label="Token">
          <div className="flex gap-1">
            <TermInput
              type={showTunnelToken ? 'text' : 'password'}
              value={tunnelToken}
              onChange={e => setTunnelToken(e.target.value)}
              placeholder="eyJ..."
              className="flex-1"
              onFocus={() => { if (tunnelToken.includes('...')) setTunnelToken('') }}
            />
            <TermButton
              variant="dim"
              size="sm"
              onClick={() => setShowTunnelToken(!showTunnelToken)}
              title={showTunnelToken ? 'Hide' : 'Show'}
            >{showTunnelToken ? '\u{1F648}' : '\u{1F441}'}</TermButton>
          </div>
        </FormRow>
        <FormRow label="Public URL">
          <TermInput
            type="text"
            value={tunnelBaseUrl}
            onChange={e => setTunnelBaseUrl(e.target.value)}
            placeholder="https://office.example.com"
          />
        </FormRow>
        <div className="flex items-center gap-2 pl-[112px]">
          <TermButton variant="primary" onClick={handleSaveTunnel} disabled={tunnelSaving}>
            {tunnelSaving ? 'Saving...' : 'Save & Start'}
          </TermButton>
          {tunnelMessage && (
            <span className={cn("text-term", tunnelMessage.includes('not') || tunnelMessage.includes('Failed') ? "text-sem-red" : "text-sem-green")}>
              {tunnelMessage}
            </span>
          )}
        </div>
      </div>

      {/* ---- Toggles ---- */}
      <div className="mb-1">
        <button onClick={toggleWorktree} className={toggleCls} title="Each agent works in its own git worktree branch, merged on completion">
          <span>Agent Isolation</span>
          <span className={checkboxCls(worktreeOn)}>{worktreeOn ? '\u2713' : ''}</span>
        </button>
        <button onClick={toggleAutoMerge} className={toggleCls} title="Auto-merge agent changes to main on task completion. Turn off to review before merging.">
          <span>Auto-merge</span>
          <span className={checkboxCls(autoMergeOn)}>{autoMergeOn ? '\u2713' : ''}</span>
        </button>
        <button onClick={toggleSound} className={toggleCls}>
          <span>Sound Notifications</span>
          <span className={checkboxCls(soundEnabled)}>{soundEnabled ? '\u2713' : ''}</span>
        </button>
      </div>

      {/* ---- Console Grid ---- */}
      <div className="border-b border-term-border-dim pb-3 mb-2">
        <span className="text-[13px] text-foreground font-medium block mb-2">Console Grid</span>
        <div className="flex items-center gap-4">
          <FormRow label="Columns">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4].map(v => (
                <button
                  key={v}
                  onClick={() => onConsoleColsChange?.(v)}
                  className={cn(
                    "w-8 h-7 text-term font-mono border rounded cursor-pointer transition-colors duration-150",
                    consoleCols === v
                      ? "border-accent bg-accent/20 text-accent"
                      : "border-muted-foreground/30 bg-transparent text-muted-foreground hover:border-muted-foreground"
                  )}
                >{v}</button>
              ))}
            </div>
          </FormRow>
          <FormRow label="Rows">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map(v => (
                <button
                  key={v}
                  onClick={() => onConsoleRowsChange?.(v)}
                  className={cn(
                    "w-8 h-7 text-term font-mono border rounded cursor-pointer transition-colors duration-150",
                    consoleRows === v
                      ? "border-accent bg-accent/20 text-accent"
                      : "border-muted-foreground/30 bg-transparent text-muted-foreground hover:border-muted-foreground"
                  )}
                >{v}</button>
              ))}
            </div>
          </FormRow>
        </div>
        <div className="text-[10px] text-muted-foreground mt-1 pl-[112px]">
          {consoleCols} × {consoleRows} = {consoleCols * consoleRows} agents per page
        </div>
      </div>

      {/* ---- Version ---- */}
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
