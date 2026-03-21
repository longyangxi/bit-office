"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TERM_THEMES, applyTermTheme } from "./termTheme";

export interface CommandAction {
  id: string;
  label: string;
  icon?: string;
  hint?: string;
  group?: string;
  action: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Dynamic actions from the parent (hire, fire agents, etc.) */
  actions?: CommandAction[];
  /** Current theme key for highlighting */
  currentTheme?: string;
  /** Callback when theme changes */
  onThemeChange?: (key: string) => void;
  /** Callbacks for common actions */
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  onHire?: () => void;
}

export default function CommandPalette({
  open, onClose, actions = [],
  currentTheme, onThemeChange,
  onOpenSettings, onOpenHistory, onHire,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build complete action list: built-in + themes + dynamic
  const allActions = useMemo(() => {
    const builtIn: CommandAction[] = [];

    if (onOpenSettings) {
      builtIn.push({ id: "settings", label: "Settings", icon: "\u2699", group: "Navigation", action: () => { onOpenSettings(); onClose(); } });
    }
    if (onOpenHistory) {
      builtIn.push({ id: "history", label: "Project History", icon: "\u25F6", group: "Navigation", action: () => { onOpenHistory(); onClose(); } });
    }
    if (onHire) {
      builtIn.push({ id: "hire", label: "Hire Team", icon: "+", group: "Actions", action: () => { onHire(); onClose(); } });
    }

    // Theme actions
    const themeActions: CommandAction[] = Object.entries(TERM_THEMES).map(([key, theme]) => ({
      id: `theme:${key}`,
      label: theme.name,
      icon: currentTheme === key ? "\u25CF" : "\u25CB",
      hint: currentTheme === key ? "active" : undefined,
      group: "Themes",
      action: () => {
        if (onThemeChange) onThemeChange(key);
        else applyTermTheme(key);
        onClose();
      },
    }));

    // Dynamic actions from parent (agent-specific)
    const dynamic = actions.map(a => ({
      ...a,
      action: () => { a.action(); onClose(); },
    }));

    return [...builtIn, ...dynamic, ...themeActions];
  }, [actions, currentTheme, onThemeChange, onOpenSettings, onOpenHistory, onHire, onClose]);

  // Filter by query
  const filtered = useMemo(() => {
    if (!query.trim()) return allActions;
    const q = query.toLowerCase();
    return allActions.filter(a =>
      a.label.toLowerCase().includes(q) ||
      a.group?.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  }, [allActions, query]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Clamp activeIndex when filtered list changes
  useEffect(() => {
    setActiveIndex(i => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const execute = useCallback((index: number) => {
    const item = filtered[index];
    if (item) item.action();
  }, [filtered]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [filtered.length, activeIndex, execute, onClose]);

  if (!open) return null;

  // Group items for rendering
  let lastGroup = "";

  return (
    <div className="cp-backdrop" onClick={onClose}>
      <div className="cp-container" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cp-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command..."
          spellCheck={false}
          autoComplete="off"
        />
        <div ref={listRef} className="cp-list">
          {filtered.length === 0 && (
            <div className="cp-empty">No matching commands</div>
          )}
          {filtered.map((item, i) => {
            const showGroup = item.group && item.group !== lastGroup;
            if (item.group) lastGroup = item.group;
            return (
              <div key={item.id}>
                {showGroup && <div className="cp-group-label">{item.group}</div>}
                <button
                  className={`cp-item${i === activeIndex ? " cp-item-active" : ""}`}
                  onClick={() => execute(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  {item.icon && <span className="cp-item-icon">{item.icon}</span>}
                  <span className="cp-item-label">{item.label}</span>
                  {item.hint && <span className="cp-item-hint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
