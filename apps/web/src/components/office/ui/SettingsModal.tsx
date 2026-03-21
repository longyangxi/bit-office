"use client"

import { useState, useEffect } from 'react'
import { TERM_BG, TERM_PANEL, TERM_BORDER, TERM_BORDER_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_DIM, TERM_GREEN, TERM_HOVER, TERM_SURFACE, TERM_SEM_GREEN, TERM_SEM_RED } from "./termTheme"
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
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'var(--font-mono)',
    transition: 'background var(--duration-fast) ease',
  }

  return (
    <TermModal
      open={isOpen}
      onClose={onClose}
      maxWidth={400}
      zIndex={100}
      title="Settings"
    >
      {/* ---- Telegram Section ---- */}
      <div style={{ borderBottom: `1px solid ${TERM_BORDER_DIM}`, paddingBottom: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: tgConnected ? TERM_SEM_GREEN : TERM_DIM, flexShrink: 0,
          }} />
          <span style={{ fontSize: '13px', color: TERM_TEXT, fontWeight: 500 }}>
            Telegram {tgConnected ? '(connected)' : '(disconnected)'}
          </span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: '12px', color: TERM_DIM, marginBottom: 4, display: 'block' }}>Bot Token</label>
          <div style={{ display: 'flex', gap: 4 }}>
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
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: '12px', color: TERM_DIM, marginBottom: 4, display: 'block' }}>
            Allowed User IDs <span style={{ opacity: 0.6 }}>(comma-separated, empty = all)</span>
          </label>
          <TermInput
            type="text"
            value={tgUsers}
            onChange={e => setTgUsers(e.target.value)}
            placeholder="123456789, 987654321"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TermButton
            variant="primary"
            onClick={handleSaveTelegram}
            disabled={tgSaving}
          >
            {tgSaving ? 'Saving...' : 'Save & Connect'}
          </TermButton>
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
        style={menuItemBase}
        title="Each agent works in its own git worktree branch, merged on completion"
      >
        <span>Agent Isolation</span>
        <span style={checkboxStyle(worktreeOn)}>
          {worktreeOn ? '\u2713' : ''}
        </span>
      </button>
      <button onClick={toggleSound} style={menuItemBase}>
        <span>Sound Notifications</span>
        <span style={checkboxStyle(soundEnabled)}>
          {soundEnabled ? '\u2713' : ''}
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
        style={{ ...menuItemBase, opacity: agentsUpdating ? 0.5 : 1 }}
      >
        <span>
          {agentsUpdating ? 'Updating Agents...' : agentsMessage ?? 'Update Agency Agents'}
        </span>
        {agentsMessage && (
          <span style={{
            fontSize: 11,
            color: agentsMessage.startsWith('Failed') ? TERM_SEM_RED : TERM_SEM_GREEN,
          }}>
            {agentsMessage.startsWith('Failed') ? '\u2717' : '\u2713'}
          </span>
        )}
      </button>
      <div
        style={{
          borderTop: `1px solid ${TERM_BORDER_DIM}`,
          marginTop: 4,
          paddingTop: 8,
          fontSize: 11,
          color: TERM_DIM,
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.45,
          userSelect: 'text',
        }}
        title="From monorepo root package.json at build time"
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
    </TermModal>
  )
}
