# Bit-Office UI/UX Architecture Audit

**Auditor**: Nova (UX Architect)
**Date**: 2026-03-21
**Scope**: `apps/web/src/` -- all components, styles, store, hooks

---

## Executive Summary

The app has strong product-market fit and a compelling terminal-meets-office aesthetic.
However, the current implementation has accumulated significant **architectural debt**
that prevents it from feeling like a polished, professional product. The issues fall
into three tiers:

| Tier | Category | Impact |
|------|----------|--------|
| P0 | Inline style sprawl, no component abstraction | Unmaintainable, inconsistent UI |
| P1 | Dual theme system, mutable exports, spacing chaos | Visual inconsistency, theme bugs |
| P2 | Accessibility gaps, no responsive system, no error boundaries | Poor UX for edge cases |

---

## P0 -- Critical Architecture Issues

### 1. Inline Style Epidemic

**Files affected**: Every `.tsx` file (AgentPane, MultiPaneView, page.tsx, all modals)

The entire UI is built with inline `style={{}}` objects. There are **zero reusable
CSS classes** for buttons, inputs, modals, cards, or layout patterns.

**Evidence**:
```tsx
// AgentPane.tsx -- a button style repeated 8+ times with slight variations
<button style={{
  padding: "6px 18px", border: `1px solid ${TERM_DIM}`,
  backgroundColor: "transparent", color: TERM_SEM_GREEN,
  fontSize: TERM_SIZE, fontFamily: TERM_FONT,
  cursor: "pointer", transition: "border-color 0.15s",
}} />
```

**Problems**:
- Cannot be overridden, composed, or themed externally
- Hover/focus states require `onMouseEnter`/`onMouseLeave` JS handlers
  (fragile, no keyboard support, no `:hover` cascade)
- 50+ unique button style objects across the codebase
- No `:focus-visible` ring on any interactive element

**Recommendation**: Extract a `<TermButton>` primitive (and similar for inputs,
modals, badges) that uses CSS classes with CSS variable theming. Keep inline styles
only for truly dynamic, per-instance values (e.g. positioning).


### 2. No Component Abstraction Layer

The codebase has **no shared UI primitives**. Every component rebuilds:

| Pattern | Duplicated In |
|---------|---------------|
| Modal backdrop + centering + container | HireModal, HireTeamModal, CreateAgentModal, SettingsModal, CelebrationModal, ConfirmModal, PreviewOverlay, RatingPopup |
| Text input with border + theme | AgentPane (3 variants), ReviewFooter, CreateAgentModal, SettingsModal |
| Status badge (color + border + bg) | AgentPane, MultiPaneView, page.tsx (mobile header), TeamActivityCard |
| Action button (border + transparent bg) | AgentPane (~12 instances), MultiPaneView, BottomToolbar, all modals |

**Recommendation**: Create a `ui/primitives/` directory:
```
ui/primitives/
  TermButton.tsx      -- <button> with variant="primary|ghost|danger"
  TermInput.tsx       -- <textarea> or <input> with consistent sizing
  TermBadge.tsx       -- status/role/phase badges
  TermModal.tsx       -- backdrop + container + close + scroll
  TermTooltip.tsx     -- consistent tooltips (currently none exist)
```


### 3. Monolithic Page Component

`page.tsx` is **~2000+ lines** and owns:
- WebSocket connection logic
- All agent CRUD handlers
- All team management handlers
- All UI state (20+ useState hooks)
- Demo script logic
- Tauri drag-drop integration
- Image paste/upload logic
- Layout computation
- Mobile/desktop switching
- Preview/celebration/confetti state

This is the single biggest maintainability risk. Any change to any feature
requires reading and understanding the entire file.

**Recommendation**: Extract into focused hooks and container components:
```
hooks/useAgentHandlers.ts     -- agent CRUD, fire, hire
hooks/useTeamHandlers.ts      -- team creation, delegation
hooks/useImageUpload.ts       -- paste, drop, pending images
hooks/usePreviewState.ts      -- preview URL, ratings, celebration
containers/DesktopLayout.tsx  -- desktop scene + console layout
containers/MobileLayout.tsx   -- mobile chat overlay layout
```

---

## P1 -- Consistency & Theme Issues

### 4. Dual Theme System (CSS Vars vs Mutable JS Exports)

Two parallel systems exist:

**System A** -- CSS custom properties in `global.css`:
```css
:root {
  --term-bg: #141218;
  --term-text: #c8b8a8;
  ...
}
```

**System B** -- Mutable `export let` in `termTheme.ts`:
```ts
export let TERM_BG = "#111010";
export let TERM_TEXT = "#b8ae9e";
```

`applyTermTheme()` updates **both** systems simultaneously. But:
- Components only use the JS exports (inline styles)
- CSS classes in `global.css` use the CSS variables
- Changing theme requires a **full re-render** because JS exports are not reactive

**Problems**:
- `export let` is a code smell -- other modules import a stale binding
  unless they re-read after `applyTermTheme()` runs
- No React-level reactivity -- theme change doesn't trigger re-render
  of components that imported the old value at module level
- Two sources of truth that can drift

**Recommendation**: Migrate to CSS-variables-only theming:
- `applyTermTheme()` sets CSS vars on `:root` (already done)
- Components use `var(--term-bg)` in CSS classes instead of JS imports
- Remove all `export let` mutable exports
- This also unlocks CSS `:hover`, `:focus`, `@media` usage


### 5. Spacing Chaos

No spacing scale exists. Padding/margin values found across components:

```
3px, 4px, 5px, 6px, 7px, 8px, 10px, 12px, 14px, 16px, 18px, 20px, 22px, 24px, 28px
```

Same logical elements use different values:
- Modal padding: `14px 18px 10px` (HireModal), `22px 20px` (RatingPopup), `20px` (ConfirmModal)
- Input padding: `6px 10px` (ReviewFooter), `6px 5px` (AgentPane textarea), `7px 10px` (CreateAgentModal)
- Section padding: `8px 12px` (input area), `5px 12px` (info bar), `6px 12px` (review header)

**Recommendation**: Adopt a 4px base spacing scale:
```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 20px;  --space-6: 24px;
--space-8: 32px;  --space-10: 40px;
```


### 6. Font Family Inconsistency

Three different font stacks are used:

| Context | Font |
|---------|------|
| Terminal/chat | `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace` |
| BottomToolbar | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Modals (inline) | `"monospace"` (bare keyword) |
| Pixel art labels | `'Press Start 2P', monospace` |

BottomToolbar breaking from the monospace aesthetic feels jarring.
The bare `monospace` keyword renders differently across platforms.

**Recommendation**: Use TERM_FONT everywhere except pixel art labels.
Define a `--font-mono` CSS var for consistency.


### 7. Color Opacity Inconsistency

Four different opacity/alpha syntaxes are mixed:

```tsx
// Hex suffix
`${color}40`          // e.g. TERM_SEM_YELLOW + "40"
`${TERM_GREEN}1e`

// rgba()
"rgba(0,0,0,0.6)"
"rgba(255, 255, 255, 0.1)"

// color-mix() -- only in 1 place
"color-mix(in srgb, var(--term-bg) 70%, transparent)"

// Hardcoded with opacity
"rgba(var(--term-accent-rgb), 0.15)"
```

The hex-suffix approach (`${color}40`) breaks if the color is in
`rgb()` or `hsl()` format. It also makes opacity semantics unclear.

**Recommendation**: Standardize on CSS `color-mix()` or define
opacity-stepped CSS variables:
```css
--term-green-10: color-mix(in srgb, var(--term-green) 10%, transparent);
--term-green-20: color-mix(in srgb, var(--term-green) 20%, transparent);
```

---

## P2 -- UX & Accessibility Issues

### 8. Zero Keyboard Navigation

- No `:focus-visible` outlines on any button or input
- Tab order is undefined (relies on DOM order, which is acceptable but
  not optimized for multi-pane layout)
- Modal trap: focus is not trapped inside modals -- users can Tab out
  into background elements
- No keyboard shortcut for common actions (hire, fire, approve, cancel)
- `Escape` to close modals is implemented in some places but not all

**Recommendation**:
- Add global `:focus-visible` style to `global.css`
- Implement focus trap for all modals
- Add `role="dialog"` and `aria-modal="true"` to modals
- Add keyboard shortcuts with a discoverable cheat sheet


### 9. No Responsive Design System

Mobile detection is a boolean check:
```tsx
const isMobile = windowWidth < 768; // hardcoded magic number
```

No intermediate breakpoints. The app is either "full desktop" or
"full mobile" with no tablet/small-desktop adaptation. The console
pane system (`MAX_VISIBLE = 3`) doesn't adapt to viewport width.

**Recommendation**:
- Define breakpoints as constants: `SM=640, MD=768, LG=1024, XL=1280`
- Let `MAX_VISIBLE` scale: 1 pane on mobile, 2 on tablet, 3 on desktop
- Use container queries for pane-internal layout


### 10. Hover States via JS (Fragile Pattern)

Every button implements hover via:
```tsx
onMouseEnter={(e) => { e.currentTarget.style.borderColor = TERM_GREEN; }}
onMouseLeave={(e) => { e.currentTarget.style.borderColor = TERM_DIM; }}
```

**Problems**:
- No keyboard equivalent (no `:focus` styling)
- Stale state if mouse leaves during fast movement
- Breaks on touch devices (hover gets "stuck")
- Cannot be expressed in CSS due to inline styles

**Recommendation**: Replace with CSS classes + `:hover` pseudo-class.
This is only possible once inline styles are migrated to CSS classes
(see P0-1 and P0-2).


### 11. No Error Boundaries

No React `<ErrorBoundary>` exists. A rendering error in any component
crashes the entire app. Given the complexity of page.tsx and the
real-time WebSocket data, this is a real risk.

**Recommendation**: Add error boundaries at:
- App root level (fallback: "Something went wrong, reload")
- Each AgentPane (fallback: "Agent pane error")
- Scene/canvas (fallback: "Scene failed to load")


### 12. No Loading/Empty/Error State Pattern

Components jump from "nothing" to "content" with no intermediate states.
- Agent list: no skeleton/placeholder when loading
- Chat messages: no "loading older messages" indicator
- Preview overlay: no loading state while iframe loads
- Team activity: no empty state illustration

**Recommendation**: Define a `<TermEmptyState>` and `<TermSkeleton>`
component for consistent loading patterns.

---

## P3 -- Polish & Professional Feel

### 13. No Animation System

Transitions are applied ad-hoc:
- Some elements have `transition: "border-color 0.15s ease"`
- Others have `transition: "all 0.3s ease"` (over-broad)
- Pane open/close has no animation
- Modal appear/disappear is instant (except review overlay)

**Recommendation**: Define a motion system:
```css
--duration-fast: 100ms;
--duration-normal: 200ms;
--duration-slow: 350ms;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
```


### 14. No Shadow/Elevation System

Shadows are inconsistent:
- BottomToolbar: `0 4px 12px rgba(0, 0, 0, 0.3)`
- HireModal: `4px 4px 0px rgba(0,0,0,0.5)` (pixel art style)
- Info bar: `0 1px 0 var(--term-border-dim)` (1px line)

**Recommendation**: Define 3 elevation levels:
```css
--shadow-sm: 0 1px 0 var(--term-border-dim);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
```


### 15. No Border Radius System

Values found: `0, 1.5px, 2px, 3px, 4px, 8px, 20px, 24px, 50%`.
The terminal aesthetic implies sharp corners (0 or 2px), but some
components use rounded values inconsistently.

**Recommendation**: Pick a stance:
- **Terminal-pure**: 0px everywhere (current aesthetic leans this way)
- **Soft terminal**: 2px for containers, 0px for inputs
- Enforce via `--radius-sm: 0px; --radius-md: 2px; --radius-full: 50%;`

---

## Architecture Refactoring Roadmap

### Phase 1: Design Tokens (1-2 days)
Create `ui/tokens.css` with spacing, color, shadow, radius, motion variables.
Update `global.css` to use them. No component changes yet.

### Phase 2: UI Primitives (3-5 days)
Build `TermButton`, `TermInput`, `TermBadge`, `TermModal` components.
Use CSS modules or a CSS-in-JS solution that supports pseudo-classes.
Migrate one modal (e.g. ConfirmModal) as proof of concept.

### Phase 3: Theme Migration (2-3 days)
Remove `export let` from `termTheme.ts`.
Convert all inline `TERM_*` usages to `var(--term-*)` in CSS classes.
Components should not import theme colors directly.

### Phase 4: Page Decomposition (3-5 days)
Extract page.tsx into hooks and container components.
Target: page.tsx < 300 lines, each handler hook < 100 lines.

### Phase 5: Accessibility & Polish (2-3 days)
Add focus styles, keyboard shortcuts, error boundaries, loading states.
Add modal focus trapping and ARIA attributes.

### Phase 6: Responsive System (2-3 days)
Define breakpoints, make MAX_VISIBLE dynamic, add tablet layout.

---

## Quick Wins (< 1 hour each)

These can be done immediately without architectural changes:

1. **Add global focus-visible style** to `global.css`:
   ```css
   :focus-visible { outline: 1px solid var(--term-green); outline-offset: 2px; }
   ```

2. **Fix BottomToolbar font** -- change to TERM_FONT for visual consistency.

3. **Add `role="dialog"` and `aria-modal="true"`** to all modal backdrops.

4. **Add `aria-label`** to icon-only buttons (close, pagination arrows).

5. **Add error boundary** wrapper around `<AgentPane>` in MultiPaneView.

6. **Unify modal container shadow** -- pick one style, apply to all.

7. **Add `prefers-reduced-motion` media query** to disable CRT animations.

---

## File-by-File Summary

| File | Lines | Issues |
|------|-------|--------|
| `page.tsx` | ~2000 | Monolithic, 20+ useState, mix of logic and UI |
| `AgentPane.tsx` | ~900 | 12+ inline button styles, ReviewFooter embedded |
| `MultiPaneView.tsx` | ~550 | StableAgentPane wrapper adds complexity |
| `MessageBubble.tsx` | ~420 | Inline markdown renderer, termBtnStyle duplicated |
| `CreateAgentModal.tsx` | ~450 | No shared modal/input primitives |
| `SettingsModal.tsx` | ~340 | Inline styles, inconsistent spacing |
| `HireModal.tsx` | ~280 | Different modal container style |
| `HireTeamModal.tsx` | ~240 | Copy-paste of HireModal pattern |
| `termTheme.ts` | ~520 | Mutable exports, 17 themes (good coverage!) |
| `office-constants.ts` | ~290 | Clean, well-structured catalog |
| `global.css` | ~393 | Good foundation, but underused |
| `BottomToolbar.tsx` | ~140 | Wrong font family, hardcoded colors |

---

## Verdict

The product vision is strong. The terminal aesthetic is compelling. The theme
system (17 themes!) shows real attention to user preference.

But the implementation is at a **prototype-grade architecture** trying to support
a **production-grade feature set**. The gap between the two creates:
- Visual inconsistencies (spacing, borders, opacity)
- Maintenance friction (change one button = find 12 inline styles)
- Accessibility failures (no keyboard nav, no screen reader support)
- Fragile state management (mutable theme exports, 2000-line page.tsx)

The refactoring roadmap above prioritizes **design tokens first** (Phase 1),
because every subsequent phase depends on having a consistent token system.
Phase 2 (UI primitives) delivers the highest ROI -- it makes every future
feature faster to build and more consistent by default.
