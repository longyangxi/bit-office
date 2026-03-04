"use client"

import { useState, useRef } from 'react'
import type { OfficeLayout } from '../types'
import { serializeLayout, deserializeLayout } from '../layout/layoutSerializer'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  layout: OfficeLayout
  onImportLayout: (layout: OfficeLayout) => void
  onImportTiledMap?: (files: FileList) => void
  soundEnabled: boolean
  onSoundEnabledChange: (enabled: boolean) => void
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '13px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

export default function SettingsModal({
  isOpen,
  onClose,
  layout,
  onImportLayout,
  onImportTiledMap,
  soundEnabled,
  onSoundEnabledChange,
}: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tiledInputRef = useRef<HTMLInputElement>(null)

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

  const handleImportTiled = () => {
    tiledInputRef.current?.click()
  }

  const handleTiledFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    onImportTiledMap?.(files)
    onClose()
    e.target.value = ''
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
          background: '#1e1e2e',
          border: '2px solid #4a4a6a',
          borderRadius: 0,
          padding: '4px',
          boxShadow: '2px 2px 0px #0a0a14',
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
            borderBottom: '1px solid #4a4a6a',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '14px',
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <button
          onClick={handleImportTiled}
          onMouseEnter={() => setHovered('tiled')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'tiled' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >Import Tiled Map</button>
        <input
          ref={tiledInputRef}
          type="file"
          multiple
          accept=".tmj,.tsj,.tsx,.png"
          onChange={handleTiledFileChange}
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
              borderRadius: 0,
              background: soundEnabled ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundEnabled ? 'X' : ''}
          </span>
        </button>
      </div>
    </>
  )
}
