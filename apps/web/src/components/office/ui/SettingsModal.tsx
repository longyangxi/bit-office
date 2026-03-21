"use client"

import { useState, useEffect } from 'react'
import { TERM_BG, TERM_PANEL, TERM_BORDER, TERM_BORDER_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_DIM, TERM_GREEN, TERM_HOVER, TERM_SURFACE, TERM_SEM_GREEN, TERM_SEM_RED } from "./termTheme"
import type { OfficeLayout } from '../types'
import { sendCommand } from '@/lib/connection'
import { useOfficeStore } from '@/store/office-store'
import { APP_VERSION, APP_BUILD_TIME } from '@/lib/appMeta'

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
  const [hovered, setHovered] = useState<string | null>(null)
  const [agentsUpdating, setAgentsUpdating] = useState(false)
  const [agentsMessage, setAgentsMessage] = useState<string | null>(null)
  const [tgToken, setTgToken] = useState('')
  const [tgUsers, setTgUsers] = useState('')
  const [tgSaving, setTgSaving] = useState(false)
  const [tgMessage, setTgMessage] = useState<string | null>(null)
  const [tgConnected, setTgConnected] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [worktreeOn, setWorktreeOn] = useState(true)
  const agencyResult = useOfficeStore((s) => s.agencyAgentsResult)
  const configData = useOfficeStore((s) => s.configData)
  const configResult = useOfficeStore((s) => s.configResult)

  // Request config when modal opens
  useEffect(() => {
    if (isOpen) {
      sendCommand({ type: "GET_CONFIG" })
    }
  }, [isOpen])

  // Populate form when config arrives
  useEffect(() => {
    if (configData) {
      setTgToken(configData.telegramBotToken ?? '')
      setTgUsers(configData.telegramAllowedUsers?.join(', ') ?? '')
      setTgConnected(configData.telegramConnected ?? false)
      setWorktreeOn(configData.worktreeEnabled ?? true)
    }
  }, [configData])

  // Handle save result
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
  }, [configResult])

  // Listen for gateway response
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

  if (!isOpen) return null

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

  const menuItemBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '6px 10px',
    fontSize: '15px',
    color: TERM_TEXT,
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left',
  }

  const inputBase: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: TERM_TEXT_BRIGHT,
    background: TERM_BG,
    border: `1px solid ${TERM_BORDER}`,
    borderRadius: 4,
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const checkboxStyle = (checked: boolean): React.CSSProperties => ({
    width: 14,
    height: 14,
    border: `2px solid ${TERM_DIM}`,
    borderRadius: 3,
    background: checked ? TERM_GREEN : 'transparent',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    lineHeight: 1,
    color: TERM_BG,
  })

  return (
    <>
      {/* Dark backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 99,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 100,
          background: TERM_PANEL,
          border: `2px solid ${TERM_BORDER}`,
          borderRadius: 10,
          padding: '8px 6px',
          boxShadow: `0 0 40px ${TERM_GREEN}14, 4px 4px 0px rgba(0,0,0,0.5)`,
          minWidth: 320,
          maxWidth: 400,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: `1px solid ${TERM_BORDER_DIM}`,
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '15px', color: TERM_TEXT_BRIGHT }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? TERM_HOVER : 'transparent',
              border: 'none',
              borderRadius: 4,
              color: TERM_DIM,
              fontSize: '15px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >X</button>
        </div>

        {/* ---- Telegram Section ---- */}
        <div style={{ borderBottom: `1px solid ${TERM_BORDER_DIM}`, paddingBottom: 8, marginBottom: 4 }}>
          <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 2 }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: tgConnected ? TERM_SEM_GREEN : TERM_DIM,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: '13px', color: TERM_TEXT, fontWeight: 500 }}>
              Telegram {tgConnected ? '(connected)' : '(disconnected)'}
            </span>
          </div>
          <div style={{ padding: '6px 10px' }}>
            <label style={{ fontSize: '12px', color: TERM_DIM, marginBottom: 4, display: 'block' }}>Bot Token</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type={showToken ? 'text' : 'password'}
                value={tgToken}
                onChange={e => setTgToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                style={{ ...inputBase, flex: 1 }}
                onFocus={() => {
                  if (tgToken.includes('...')) setTgToken('')
                }}
              />
              <button
                onClick={() => setShowToken(!showToken)}
                onMouseEnter={() => setHovered('eye')}
                onMouseLeave={() => setHovered(null)}
                style={{
                  ...inputBase,
                  width: 32,
                  padding: '4px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  fontSize: '14px',
                  background: hovered === 'eye' ? TERM_HOVER : TERM_BG,
                }}
                title={showToken ? 'Hide' : 'Show'}
              >{showToken ? '🙈' : '👁'}</button>
            </div>
          </div>
          <div style={{ padding: '6px 10px' }}>
            <label style={{ fontSize: '12px', color: TERM_DIM, marginBottom: 4, display: 'block' }}>
              Allowed User IDs <span style={{ opacity: 0.6 }}>(comma-separated, empty = all)</span>
            </label>
            <input
              type="text"
              value={tgUsers}
              onChange={e => setTgUsers(e.target.value)}
              placeholder="123456789, 987654321"
              style={inputBase}
            />
          </div>
          <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleSaveTelegram}
              disabled={tgSaving}
              onMouseEnter={() => setHovered('tg-save')}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '5px 14px',
                fontSize: '13px',
                color: TERM_BG,
                background: hovered === 'tg-save' ? TERM_GREEN : `${TERM_GREEN}cc`,
                border: `1px solid ${TERM_GREEN}`,
                borderRadius: 4,
                cursor: 'pointer',
                opacity: tgSaving ? 0.5 : 1,
                fontWeight: 500,
              }}
            >
              {tgSaving ? 'Saving...' : 'Save & Connect'}
            </button>
            {tgMessage && (
              <span style={{
                fontSize: 12,
                color: tgMessage.includes('Failed') || tgMessage.includes('not') ? TERM_SEM_RED : TERM_SEM_GREEN,
              }}>
                {tgMessage}
              </span>
            )}
          </div>
        </div>

        {/* ---- Toggles Section ---- */}
        <button
          onClick={toggleWorktree}
          onMouseEnter={() => setHovered('worktree')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'worktree' ? TERM_HOVER : 'transparent',
          }}
          title="Each agent works in its own git worktree branch, merged on completion"
        >
          <span>Agent Isolation</span>
          <span style={checkboxStyle(worktreeOn)}>
            {worktreeOn ? '✓' : ''}
          </span>
        </button>
        <button
          onClick={toggleSound}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? TERM_HOVER : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span style={checkboxStyle(soundEnabled)}>
            {soundEnabled ? '✓' : ''}
          </span>
        </button>
        <div style={{ borderTop: `1px solid ${TERM_BORDER_DIM}`, margin: '4px 0' }} />
        <button
          onClick={() => {
            setAgentsUpdating(true)
            setAgentsMessage(null)
            sendCommand({ type: "UPDATE_AGENCY_AGENTS" })
          }}
          disabled={agentsUpdating}
          onMouseEnter={() => setHovered('agents')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'agents' ? TERM_HOVER : 'transparent',
            opacity: agentsUpdating ? 0.5 : 1,
          }}
        >
          <span>
            {agentsUpdating ? 'Updating Agents...' : agentsMessage ?? 'Update Agency Agents'}
          </span>
          {agentsMessage && (
            <span style={{
              fontSize: 11,
              color: agentsMessage.startsWith('Failed') ? TERM_SEM_RED : TERM_SEM_GREEN,
            }}>
              {agentsMessage.startsWith('Failed') ? '✗' : '✓'}
            </span>
          )}
        </button>
        <div
          style={{
            borderTop: `1px solid ${TERM_BORDER_DIM}`,
            marginTop: 4,
            padding: '8px 10px 6px',
            fontSize: 11,
            color: TERM_DIM,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            lineHeight: 1.45,
            userSelect: 'text',
          }}
          title="From monorepo root package.json at build time — compare after deploy / desktop bundle"
        >
          <div>
            <span style={{ opacity: 0.75 }}>Web UI</span>{' '}
            <span style={{ color: TERM_TEXT }}>v{APP_VERSION}</span>
          </div>
          {APP_BUILD_TIME ? (
            <div style={{ marginTop: 2, fontSize: 10, opacity: 0.9 }}>
              build {APP_BUILD_TIME.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
