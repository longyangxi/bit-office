"use client"

import { useState } from 'react'
import { APP_VERSION } from '@/lib/appMeta'

interface BottomToolbarProps {
  editMode: boolean
  onToggleEditMode: () => void
  onOpenSettings: () => void
  onOpenHistory?: () => void
  onOpenOfficeSwitcher?: () => void
  onToggleTest?: () => void
  testActive?: boolean
  showEditorControls?: boolean
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 15,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  background: 'rgba(20, 20, 25, 0.85)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 8,
  padding: '3px 4px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '12px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: 'rgba(255, 255, 255, 0.5)',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 4,
  cursor: 'pointer',
  letterSpacing: '0.03em',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(130, 160, 255, 0.15)',
  border: '1px solid rgba(130, 160, 255, 0.4)',
  color: 'rgba(160, 185, 255, 0.9)',
}

export default function BottomToolbar({ editMode, onToggleEditMode, onOpenSettings, onOpenHistory, onOpenOfficeSwitcher, onToggleTest, testActive, showEditorControls = true }: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <div style={panelStyle}>
      {onOpenOfficeSwitcher && (
        <button
          onClick={onOpenOfficeSwitcher}
          onMouseEnter={() => setHovered('office')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'office' ? 'rgba(255, 255, 255, 0.08)' : btnBase.background,
            color: hovered === 'office' ? 'rgba(255, 255, 255, 0.8)' : btnBase.color,
          }}
          title="Switch office appearance"
        >
          Office
        </button>
      )}
      {showEditorControls && (
        <button
          onClick={onToggleEditMode}
          onMouseEnter={() => setHovered('edit')}
          onMouseLeave={() => setHovered(null)}
          style={
            editMode
              ? btnActive
              : {
                  ...btnBase,
                  background: hovered === 'edit' ? 'rgba(255, 255, 255, 0.08)' : btnBase.background,
                  color: hovered === 'edit' ? 'rgba(255, 255, 255, 0.8)' : btnBase.color,
                }
          }
          title="Edit office layout"
        >
          Layout
        </button>
      )}
      {onOpenHistory && (
        <button
          onClick={onOpenHistory}
          onMouseEnter={() => setHovered('history')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'history' ? 'rgba(255, 255, 255, 0.08)' : btnBase.background,
            color: hovered === 'history' ? 'rgba(255, 255, 255, 0.8)' : btnBase.color,
          }}
          title="Project history"
        >
          History
        </button>
      )}
      <button
        onClick={onOpenSettings}
        onMouseEnter={() => setHovered('settings')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: hovered === 'settings' ? 'rgba(255, 255, 255, 0.08)' : btnBase.background,
          color: hovered === 'settings' ? 'rgba(255, 255, 255, 0.8)' : btnBase.color,
        }}
        title={`Settings · Web UI v${APP_VERSION}`}
      >
        Settings
      </button>
      {onToggleTest && (
        <button
          onClick={onToggleTest}
          onMouseEnter={() => setHovered('test')}
          onMouseLeave={() => setHovered(null)}
          style={
            testActive
              ? { ...btnActive, color: '#e85040', borderColor: 'rgba(232, 80, 64, 0.4)', background: 'rgba(200, 48, 48, 0.12)' }
              : {
                  ...btnBase,
                  background: hovered === 'test' ? 'rgba(255, 255, 255, 0.08)' : btnBase.background,
                  color: hovered === 'test' ? 'rgba(255, 255, 255, 0.8)' : btnBase.color,
                }
          }
          title="Fill all work seats with test characters"
        >
          {testActive ? 'Clear Test' : 'Test'}
        </button>
      )}
    </div>
  )
}
