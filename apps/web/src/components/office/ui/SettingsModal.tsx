"use client"

import { useState, useRef, useEffect } from 'react'
import type { OfficeLayout } from '../types'
import { serializeLayout, deserializeLayout } from '../layout/layoutSerializer'
import { loadRoomZip } from '../layout/roomZipLoader'
import { sendCommand } from '@/lib/connection'
import { useOfficeStore } from '@/store/office-store'

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const roomZipInputRef = useRef<HTMLInputElement>(null)
  const agencyResult = useOfficeStore((s) => s.agencyAgentsResult)

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
          minWidth: 200,
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
        {/* Menu items */}
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
              color: agentsMessage.startsWith('Failed') ? '#e04848' : '#48cc6a',
            }}>
              {agentsMessage.startsWith('Failed') ? 'X' : 'OK'}
            </span>
          )}
        </button>
      </div>
    </>
  )
}
