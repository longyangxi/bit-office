"use client"

import { useState, useEffect, useRef } from 'react'
import { ZOOM_MIN, ZOOM_MAX } from '../constants'
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface ZoomControlsProps {
  zoom: number
  onZoomChange: (zoom: number) => void
}

const FADE_DELAY_MS = 1200
const HIDE_DELAY_MS = 1800

export default function ZoomControls({ zoom, onZoomChange }: ZoomControlsProps) {
  const [showLevel, setShowLevel] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevZoomRef = useRef(zoom)

  const minDisabled = zoom <= ZOOM_MIN
  const maxDisabled = zoom >= ZOOM_MAX

  useEffect(() => {
    if (zoom === prevZoomRef.current) return
    prevZoomRef.current = zoom

    if (timerRef.current) clearTimeout(timerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)

    setShowLevel(true)
    setFadeOut(false)

    fadeTimerRef.current = setTimeout(() => {
      setFadeOut(true)
    }, FADE_DELAY_MS)

    timerRef.current = setTimeout(() => {
      setShowLevel(false)
      setFadeOut(false)
    }, HIDE_DELAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [zoom])

  const btnClass = cn(
    "w-9 h-9 p-0 flex items-center justify-center",
    "bg-[rgba(20,20,25,0.85)] backdrop-blur-xl",
    "text-white/80 border border-white/10 rounded-lg",
    "cursor-pointer shadow-lg",
    "transition-colors duration-fast",
    "hover:bg-white/[0.12]",
    "disabled:opacity-40 disabled:cursor-default disabled:hover:bg-[rgba(20,20,25,0.85)]",
  )

  return (
    <>
      {/* Zoom level indicator at top-center */}
      {showLevel && (
        <div
          className={cn(
            "absolute top-2.5 left-1/2 -translate-x-1/2 z-50",
            "bg-[rgba(20,20,25,0.85)] backdrop-blur-xl",
            "border border-white/10 rounded-lg",
            "px-3 py-1 shadow-lg",
            "text-[15px] text-white/80",
            "select-none pointer-events-none",
            "transition-opacity duration-500 ease-out",
          )}
          style={{ opacity: fadeOut ? 0 : 1 }}
        >
          {zoom}x
        </div>
      )}

      {/* Vertically stacked buttons — top-left */}
      <div className="absolute top-2 left-2 z-50 flex flex-col gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={btnClass}
              onClick={() => onZoomChange(zoom + 1)}
              disabled={maxDisabled}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Zoom in (Ctrl+Scroll)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={btnClass}
              onClick={() => onZoomChange(zoom - 1)}
              disabled={minDisabled}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Zoom out (Ctrl+Scroll)</TooltipContent>
        </Tooltip>
      </div>
    </>
  )
}
