# Occupy POS — Design System

A Square-inspired design language for Occupy: neutral, high-contrast, built for a
countertop touchscreen. Flatness over shadows, restraint over decoration, one accent
color reserved for meaning (occupied vs. open), and tabular numerals everywhere a
price or quantity appears.

Reference implementation: `occupy-pos-mockup.html` (register screen).

---

## 1. Principles

1. **Borders do the separating, not shadows.** Nearly everything is flat. The only
   elevation in the system is a very soft `--shadow` reserved for floating/modal
   surfaces (dialogs, popovers) — never for cards or buttons in the base UI.
2. **Ink black is the only "loud" color for actions.** Primary buttons, active tabs,
   and the brand mark are all `--ink`. Never make a primary CTA orange or green.
3. **Accent color is reserved for state, not decoration.** Orange = occupied/pending.
   Green = open/paid/success. If a color doesn't communicate a state, it shouldn't
   appear as a solid fill — use it only as a small dot, chip, or 2px accent.
4. **All numbers are tabular monospace.** Prices, quantities, totals, timestamps.
   Digits must not jitter or reflow when they update — this is what makes a register
   feel trustworthy at a glance.
5. **Touch targets ≥ 44px, ideally ≥ 96px for primary actions.** This is a
   countertop screen operated by thumb and palm, not a mouse-driven dashboard.
6. **Generous, consistent radius.** 20 / 14 / 10px scale (see tokens). No sharp
   corners, no fully-pill buttons except status chips and tabs.

---

## 2. Color tokens

```css
:root {
  /* Base */
  --ink:            #121212; /* primary text, primary buttons, active states */
  --ink-soft:        #63615c; /* secondary text, captions, timestamps */
  --paper:          #ffffff; /* page background */
  --surface:        #f5f4f1; /* cards, panels, item tiles */
  --surface-hover:  #eeece6; /* hover state for surface elements */
  --line:           #e4e2dc; /* all hairline borders/dividers */

  /* Signal (state only — never decorative) */
  --occupied:       #ff4b2e; /* tab/table occupied, pending payment */
  --occupied-soft:  #fff0ec; /* occupied chip background */
  --open:           #1fae5c; /* available, paid, success */
  --open-soft:      #eafaf1; /* success chip background */

  /* Radius */
  --radius-lg: 20px; /* panels, modals */
  --radius-md: 14px; /* item tiles, cards */
  --radius-sm: 10px; /* buttons, inputs */

  /* Elevation — floating surfaces only, never base cards */
  --shadow: 0 1px 2px rgba(18,18,18,0.04), 0 8px 24px rgba(18,18,18,0.04);
}
```

**Rules of use**
- Never introduce a new brand color without a stated state it represents.
- `--occupied` / `--open` should almost always appear as: a 7px dot, a soft-background
  chip with the solid color as text, or a 2px left-border accent. Rarely as a large
  solid fill.
- Category dots on item tiles (see mockup) may use a wider palette purely for visual
  differentiation between menu categories — that's the one place decorative color is
  allowed, since it's functioning as iconography, not brand signal.

---

## 3. Typography

| Role                        | Family         | Weight        | Notes |
|------------------------------|----------------|---------------|-------|
| UI text, labels, headings    | Inter          | 400/500/600/700/800 | Tight tracking (`-0.02em`) on headings |
| **All numerals** (prices, qty, totals, time) | IBM Plex Mono | 500/600/700 | `font-variant-numeric: tabular-nums` |

```css
font-family: 'Inter', system-ui, sans-serif;      /* default */
font-family: 'IBM Plex Mono', monospace;           /* .mono utility, numbers only */
```

Import:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet">
```

**Type scale**
- Brand name: 16px / 800 / -0.02em
- Section/panel title: 14–15px / 700
- Body / item name: 14px / 600
- Secondary / caption: 12–13px / 400–500, `--ink-soft`
- Total (cart summary): 16px / 700
- Charge button label: 15px / 700

---

## 4. Layout

- **Grid:** two-column app shell — catalog (flexible width) + fixed 380px cart rail,
  divided by a `1px solid var(--line)` border. No shadow between them.
- **Item grid:** `repeat(auto-fill, minmax(148px, 1fr))`, 12px gap, tiles min-height
  104px, `--radius-md`, `--surface` background, no border unless selected.
- **Top bar:** 16px/28px padding, bottom hairline, brand mark left, clock + avatar
  right.
- **Cart rail signature detail — the receipt edge:** a 14px strip at the top of the
  cart panel using a repeating radial-gradient to fake perforation, echoing a
  register receipt tape. This is the one deliberately characterful element in the
  system — keep everything else quiet around it.

```css
.receipt-edge {
  height: 14px;
  background:
    radial-gradient(circle at 10px 0, transparent 6px, var(--surface) 6.5px) top,
    var(--paper);
  background-size: 20px 14px;
  background-repeat: repeat-x;
  border-bottom: 1px dashed var(--line);
}
```

---

## 5. Components

### Buttons
- **Primary (Charge, Save, Confirm):** `--ink` background, `--paper` text, 700
  weight, `--radius-sm`, 16px vertical padding. Hover: opacity 0.88. No border.
- **Tab / filter pill:** `--paper` bg, `1px solid var(--line)`, pill radius (100px).
  Active: `--ink` bg, `--paper` text, border matches bg.
- **Icon stepper (qty +/-):** circular 22px buttons inside a pill-shaped
  `--paper` container with `1px solid var(--line)`.

### Status chip
Soft-background + solid-color text + small dot. Used for tab/table/order state only.
```html
<span class="status-chip"><span class="dot"></span>Tab occupied</span>
```
```css
background: var(--occupied-soft); color: var(--occupied);
```
Swap `--occupied`/`--occupied-soft` for `--open`/`--open-soft` on paid/available states.

### Item tile
`--surface` background, `--radius-md`, category-color dot (26px, `--radius-sm`-ish
8px), item name (14px/600), price in mono (13px, `--ink-soft`). `active:` scale(0.97)
for tactile touch feedback.

### Cart line
Flex row: name + unit price (mono) stacked left, stepper center, line total (mono,
600) right. `1px solid var(--line)` bottom divider, 12px vertical padding.

---

## 6. Copy voice

- **Active voice, plain verbs.** "Charge $19.85," not "Submit payment."
- **Name things by what the person controls.** "Tab," "Table," "Item" — not
  "order object" or "line entry."
- **Errors state what happened and what to do next, without apologizing.**
  e.g. "Card declined — try again or use another payment method," not "Oops!
  Something went wrong."
- **Empty states are an invitation to act,** not a mood. e.g. "No items yet — tap a
  category to start a tab," not "Nothing here."
- **Button label = resulting toast/state.** A button that says "Charge" produces
  confirmation language that also says "Charged," never "Payment processed
  successfully!"

---

## 7. Accessibility floor

- Visible keyboard focus ring on all interactive elements (buttons, tabs, steppers).
- Minimum 44×44px hit area on every control, even where the visual element is smaller
  (use padding to extend the hit area).
- Color is never the only signal — status chips pair color with a text label, not
  just a dot.
- Respect `prefers-reduced-motion`; keep transitions under 150ms and skip
  transform-based feedback (like the tile `active:scale`) when reduced motion is set.

---

## 8. Suggested build order in Antigravity

1. Global tokens (CSS variables above) + font imports.
2. Base components: Button (primary/secondary/pill), StatusChip, Stepper.
3. Item tile + catalog grid, category tab bar.
4. Cart rail: receipt-edge, cart line, summary block, charge button.
5. Top bar: brand mark, live clock, avatar/staff switcher.
6. Additional screens (in this same token system): order history, item editor,
   tender/tip screen, settings.
