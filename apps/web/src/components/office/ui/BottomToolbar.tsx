"use client"

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

export default function BottomToolbar({ editMode, onToggleEditMode, onOpenSettings, onOpenHistory, onOpenOfficeSwitcher, onToggleTest, testActive, showEditorControls = true }: BottomToolbarProps) {
  return (
    <div className="btb">
      {onOpenOfficeSwitcher && (
        <button className="btb-btn" onClick={onOpenOfficeSwitcher} title="Switch office appearance">
          Office
        </button>
      )}
      {showEditorControls && (
        <button
          className={editMode ? "btb-btn btb-btn-active" : "btb-btn"}
          onClick={onToggleEditMode}
          title="Edit office layout"
        >
          Layout
        </button>
      )}
      {onOpenHistory && (
        <button className="btb-btn" onClick={onOpenHistory} title="Project history">
          History
        </button>
      )}
      <button
        className="btb-btn"
        onClick={onOpenSettings}
        title={`Settings \u00b7 Web UI v${APP_VERSION}`}
      >
        Settings
      </button>
      {onToggleTest && (
        <button
          className={testActive ? "btb-btn btb-btn-danger" : "btb-btn"}
          onClick={onToggleTest}
          title="Fill all work seats with test characters"
        >
          {testActive ? 'Clear Test' : 'Test'}
        </button>
      )}
    </div>
  )
}
