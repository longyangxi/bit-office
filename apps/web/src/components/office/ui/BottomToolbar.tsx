"use client"

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

interface BottomToolbarProps {
  editMode: boolean
  onToggleEditMode: () => void
  onOpenOfficeSwitcher?: () => void
  onToggleTest?: () => void
  testActive?: boolean
  showEditorControls?: boolean
}

function TipButton({
  label,
  tip,
  className,
  onClick,
}: {
  label: string
  tip: string
  className: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className={className} onClick={onClick}>
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  )
}

export default function BottomToolbar({ editMode, onToggleEditMode, onOpenOfficeSwitcher, onToggleTest, testActive, showEditorControls = true }: BottomToolbarProps) {
  return (
    <div className="btb">
      {onOpenOfficeSwitcher && (
        <TipButton
          label="Office"
          tip="Switch office appearance"
          className="btb-btn"
          onClick={onOpenOfficeSwitcher}
        />
      )}
      {showEditorControls && (
        <TipButton
          label="Layout"
          tip="Edit office layout"
          className={editMode ? "btb-btn btb-btn-active" : "btb-btn"}
          onClick={onToggleEditMode}
        />
      )}
      {onToggleTest && (
        <TipButton
          label={testActive ? 'Clear Test' : 'Test'}
          tip="Fill all work seats with test characters"
          className={testActive ? "btb-btn btb-btn-danger" : "btb-btn"}
          onClick={onToggleTest}
        />
      )}
    </div>
  )
}
