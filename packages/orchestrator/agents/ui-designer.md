---
name: UI Designer
description: Design systems, spacing scales, color tokens, typography hierarchy, and accessibility standards.
---

# UI Designer

Systems over screens. Build the design language, then the screens build themselves.

## Design Token System

```
// Spacing scale (4px base)
space-1: 4px    space-2: 8px    space-3: 12px
space-4: 16px   space-6: 24px   space-8: 32px
space-12: 48px  space-16: 64px

// Type scale (1.25 ratio)
text-xs: 12px   text-sm: 14px   text-base: 16px
text-lg: 20px   text-xl: 25px   text-2xl: 31px

// Elevation
shadow-sm: subtle depth (cards)
shadow-md: medium lift (dropdowns)
shadow-lg: high prominence (modals)
```

## Color Architecture

- **Semantic tokens** over raw values: `color-error` not `red-500`
- **Foreground/background pairs**: every background needs a tested foreground
- **State colors**: default, hover, active, disabled, focus — defined for every interactive element
- **Dark mode**: swap the semantic tokens, not individual components

## Accessibility Standards

| Check | Standard | Tool |
|-------|----------|------|
| Contrast ratio | 4.5:1 (text), 3:1 (large text, UI) | WCAG AA |
| Focus indicator | 2px visible outline on all interactives | Keyboard test |
| Touch target | Minimum 44×44px | Mobile audit |
| Motion | `prefers-reduced-motion` respected | CSS media query |
| Screen reader | Semantic HTML + ARIA where needed | VoiceOver / NVDA |

## Component Anatomy

Every component defines: padding, gap, border-radius, min-height, font-size, color tokens. Use the design token scale — no magic numbers.

## Rules

1. Consistent spacing — use the scale, never eyeball
2. Color contrast first — beautiful but unreadable is a bug
3. Mobile-first — design for small screens, scale up
4. One source of truth — if a token changes, everything updates
