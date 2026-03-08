"use client"

import { useState } from 'react'

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
  background: '#1e1a30',
  border: '1px solid #3d2e54',
  borderRadius: 0,
  padding: '3px 4px',
  boxShadow: '2px 2px 0px rgba(0,0,0,0.6)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '11px',
  fontFamily: 'monospace',
  color: '#7a6858',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
  letterSpacing: '0.03em',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(200, 155, 48, 0.12)',
  border: '1px solid #e8b04060',
  color: '#e8b040',
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
            background: hovered === 'office' ? 'rgba(200,155,48,0.08)' : btnBase.background,
            color: hovered === 'office' ? '#a08a6c' : btnBase.color,
          }}
          title="Switch office appearance"
        >
          Office
        </button>
      )}
      {showEditorControls && (
        <>
          <button
            onClick={onToggleEditMode}
            onMouseEnter={() => setHovered('edit')}
            onMouseLeave={() => setHovered(null)}
            style={
              editMode
                ? btnActive
                : {
                    ...btnBase,
                    background: hovered === 'edit' ? 'rgba(200,155,48,0.08)' : btnBase.background,
                    color: hovered === 'edit' ? '#a08a6c' : btnBase.color,
                  }
            }
            title="Edit office layout"
          >
            Layout
          </button>
          <button
            onClick={onOpenSettings}
            onMouseEnter={() => setHovered('settings')}
            onMouseLeave={() => setHovered(null)}
            style={{
              ...btnBase,
              background: hovered === 'settings' ? 'rgba(200,155,48,0.08)' : btnBase.background,
              color: hovered === 'settings' ? '#a08a6c' : btnBase.color,
            }}
            title="Settings"
          >
            Settings
          </button>
        </>
      )}
      {onOpenHistory && (
        <button
          onClick={onOpenHistory}
          onMouseEnter={() => setHovered('history')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'history' ? 'rgba(200,155,48,0.08)' : btnBase.background,
            color: hovered === 'history' ? '#a08a6c' : btnBase.color,
          }}
          title="Project history"
        >
          History
        </button>
      )}
      {onToggleTest && (
        <button
          onClick={onToggleTest}
          onMouseEnter={() => setHovered('test')}
          onMouseLeave={() => setHovered(null)}
          style={
            testActive
              ? { ...btnActive, color: '#e85040', borderColor: '#e8504060', background: 'rgba(200, 48, 48, 0.12)' }
              : {
                  ...btnBase,
                  background: hovered === 'test' ? 'rgba(200,155,48,0.08)' : btnBase.background,
                  color: hovered === 'test' ? '#a08a6c' : btnBase.color,
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
