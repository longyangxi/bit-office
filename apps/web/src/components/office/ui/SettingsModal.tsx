"use client"

import { useState, useRef, useEffect } from 'react'
import { TERM_SEM_GREEN, TERM_SEM_RED } from "./termTheme"
import type { OfficeLayout } from '../types'
import { serializeLayout, deserializeLayout } from '../layout/layoutSerializer'
import { loadRoomZip } from '../layout/roomZipLoader'
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

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '15px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  textAlign: 'left',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '13px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: 'rgba(255, 255, 255, 0.9)',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 4,
  outline: 'none',
  boxSizing: 'border-box' as const,
}

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'rgba(255, 255, 255, 0.5)',
  marginBottom: 4,
  display: 'block',
}

const sectionStyle: React.CSSProperties = {
  padding: '6px 10px',
}

const saveBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: '13px',
  color: '#fff',
  background: 'rgba(90, 140, 255, 0.7)',
  border: '1px solid rgba(90, 140, 255, 0.5)',
  borderRadius: 4,
  cursor: 'pointer',
}

export default function SettingsModal({
  isOpen,
  onClose,
  layout,
  onImportLayout,
  onImportRoomZip,
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const roomZipInputRef = useRef<HTMLInputElement>(null)
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

  const handleExport = () => {
    const json = serializeLayout(layout)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `office-layout-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    onClose()
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const imported = deserializeLayout(text)
      if (imported) {
        onImportLayout(imported)
        onClose()
      } else {
        alert('Invalid layout file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImportRoomZip = () => {
    roomZipInputRef.current?.click()
  }

  const handleRoomZipChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const result = await loadRoomZip(file)
    if (result && onImportRoomZip) {
      onImportRoomZip(result.layout, result.backgroundImage)
      onClose()
    }
  }

  const toggleSound = () => {
    const next = !soundEnabled
    onSoundEnabledChange(next)
    localStorage.setItem('office-sound-enabled', JSON.stringify(next))
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
      // Send empty string to clear, or actual token
      telegramBotToken: tgToken.includes('...') ? undefined : tgToken,
      telegramAllowedUsers: allowedUsers,
    })
  }

  const tgStatusDot: React.CSSProperties = {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: tgConnected ? TERM_SEM_GREEN : 'rgba(255, 255, 255, 0.25)',
    marginRight: 6,
    flexShrink: 0,
  }

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
          background: 'rgba(20, 20, 25, 0.92)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 10,
          padding: '4px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
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
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '15px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 4,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '15px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >X</button>
        </div>

        {/* ---- Telegram Section ---- */}
        <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 8, marginBottom: 4 }}>
          <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 2 }}>
            <span style={tgStatusDot} />
            <span style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>
              Telegram {tgConnected ? '(connected)' : '(disconnected)'}
            </span>
          </div>
          <div style={sectionStyle}>
            <label style={labelStyle}>Bot Token</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type={showToken ? 'text' : 'password'}
                value={tgToken}
                onChange={e => setTgToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                style={{ ...inputStyle, flex: 1 }}
                onFocus={() => {
                  // Clear masked value on focus so user can type new token
                  if (tgToken.includes('...')) setTgToken('')
                }}
              />
              <button
                onClick={() => setShowToken(!showToken)}
                onMouseEnter={() => setHovered('eye')}
                onMouseLeave={() => setHovered(null)}
                style={{
                  ...inputStyle,
                  width: 32,
                  padding: '4px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  fontSize: '14px',
                  background: hovered === 'eye' ? 'rgba(255, 255, 255, 0.1)' : inputStyle.background,
                }}
                title={showToken ? 'Hide' : 'Show'}
              >{showToken ? '🙈' : '👁'}</button>
            </div>
          </div>
          <div style={sectionStyle}>
            <label style={labelStyle}>Allowed User IDs <span style={{ opacity: 0.6 }}>(comma-separated, empty = all)</span></label>
            <input
              type="text"
              value={tgUsers}
              onChange={e => setTgUsers(e.target.value)}
              placeholder="123456789, 987654321"
              style={inputStyle}
            />
          </div>
          <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleSaveTelegram}
              disabled={tgSaving}
              onMouseEnter={() => setHovered('tg-save')}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...saveBtnStyle,
                opacity: tgSaving ? 0.5 : 1,
                background: hovered === 'tg-save' ? 'rgba(90, 140, 255, 0.9)' : saveBtnStyle.background,
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

        {/* ---- Layout Section ---- */}
        <button
          onClick={handleExport}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >Export Layout</button>
        <button
          onClick={handleImport}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >Import Layout</button>
        <button
          onClick={handleImportRoomZip}
          onMouseEnter={() => setHovered('room-zip')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'room-zip' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >Import Room (.zip)</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <input
          ref={roomZipInputRef}
          type="file"
          accept=".zip"
          onChange={handleRoomZipChange}
          style={{ display: 'none' }}
        />
        <button
          onClick={toggleSound}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 3,
              background: soundEnabled ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundEnabled ? 'X' : ''}
          </span>
        </button>
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />
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
            background: hovered === 'agents' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
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
              {agentsMessage.startsWith('Failed') ? 'X' : 'OK'}
            </span>
          )}
        </button>
        <div
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            marginTop: 4,
            padding: '8px 10px 6px',
            fontSize: 11,
            color: 'rgba(255, 255, 255, 0.45)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            lineHeight: 1.45,
            userSelect: 'text',
          }}
          title="From monorepo root package.json at build time — compare after deploy / desktop bundle"
        >
          <div>
            <span style={{ opacity: 0.75 }}>Web UI</span>{' '}
            <span style={{ color: 'rgba(255, 255, 255, 0.75)' }}>v{APP_VERSION}</span>
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
