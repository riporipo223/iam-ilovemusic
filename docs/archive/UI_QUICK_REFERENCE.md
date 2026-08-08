# ILoveMusic UI - Quick Reference
**For Claude Design - TL;DR Version**

---

## 🎨 Core Design Identity

**Style**: Brutalist • Monospace • Black & White  
**Window**: 1200×800px (fixed, non-resizable)  
**Font**: SF Mono, Monaco, Roboto Mono  
**Colors**: #1a1a1a (black), #fff (white), #666 (gray)  
**Background**: Animated video loop  

---

## 📐 Layout Structure

```
┌─ VIDEO BACKGROUND ────────────────────────────────────┐
│                                                         │
│ ┌─ HEADER (white panel) ─────────────────────────────┐│
│ │ [BLACK INPUT: PASTE URL] [BLACK BUTTON: ADD]      ││
│ └──────────────────────────────────────────────────── ┘│
│                                                         │
│ ┌─ TABS ─────────────────────────────────────────────┐│
│ │ [ABOUT] [PREVIEW] ← Active tab is inverted         ││
│ └──────────────────────────────────────────────────── ┘│
│                                                         │
│ ┌─ SEARCH & FILTER (white panel) ────────────────────┐│
│ │ [SEARCH TRACKS...] [SELECT ALL]                    ││
│ │ [BPM MIN] [BPM MAX] [ARTIST]                       ││
│ │ SORT BY: [TITLE ▼] [↑ ASC]                         ││
│ └──────────────────────────────────────────────────── ┘│
│                                                         │
│ ┌─ TRACK CARDS (stacked) ────────────────────────────┐│
│ │ [▶] TITLE - ARTIST                    [☐][✏][×]   ││
│ │     BPM: 128                                       ││
│ │     00:45 / 04:15                                  ││
│ │     ████████░░░░░░░░ ← progress bar                ││
│ └──────────────────────────────────────────────────── ┘│
│                                                         │
└────────────────────────────────────────────────────────┘
```

---

## 🎨 Design Tokens

### Typography
```css
Font Family: "SF Mono", Monaco, Roboto Mono, monospace
ALL TEXT: UPPERCASE
Sizes: 10px, 11px, 12px, 14px
Weights: 400, 600, 700
Letter Spacing: 0.01em - 0.02em
```

### Colors
```css
--black: #1a1a1a
--white: #fff
--gray: #666
--gray-light: #999

Backgrounds: Video + White panels
Text: Black on white, White on black
Borders: 1px solid #1a1a1a
```

### Spacing
```css
Component Padding: 16px, 20px 32px, 32px 48px
Gaps: 8px, 12px, 16px, 24px, 32px
Border Radius: 0 (no rounding anywhere)
```

### Interactions
```css
Hover: Invert colors (black ↔ white)
Transition: all 0.2s ease-out
Focus: outline: none
Cursor: pointer on interactive elements
```

---

## 🧩 Component Patterns

### Button Pattern
```jsx
Normal:    bg: #1a1a1a, color: #fff
Hover:     bg: #fff,    color: #1a1a1a, outline: 1px solid
Active:    (same as normal)
Disabled:  opacity: 0.6, cursor: wait
```

### Input Pattern
```jsx
Background: #1a1a1a (for header) or #fff (for filters)
Color: Inverted from background
Border: 1px solid #1a1a1a or none
Padding: 8-10px
Font: 11px, UPPERCASE
```

### Track Card Pattern
```jsx
<White Panel, padding: 16px, gap: 16px>
  [Play Button: 32px square, transparent]
  <Track Info (flex: 1)>
    <Title: 12px, black>
    <BPM: 10px, gray>
    <Time: 11px, black>
    <Progress Bar: 2px height, #999 bg, #1a1a1a fill>
  </Track Info>
  [Select: 32px square checkbox]
  [Edit: 32px square]
  [Delete: 32px square]
</White Panel>
```

---

## 🎯 Key UI Features

### 1. Video Background
- Fullscreen, fixed position, z-index: -1
- Looping video (bg01.mp4)
- Adds ambient motion
- White panels overlay on top

### 2. Inverted Hover States
- All buttons invert colors on hover
- Black → White, White → Black
- Smooth 0.2s transition
- 1px outline when inverted

### 3. Monospace Aesthetic
- Terminal/CLI inspired
- Technical, precise feel
- All text uppercase
- Monospace font family

### 4. Sharp Corners
- border-radius: 0 everywhere
- No rounded corners
- Brutalist, modern

### 5. High Contrast
- Pure black & white
- No gradients
- No shadows
- Flat design

---

## 📱 States & Interactions

### Loading State
```jsx
Button: "LOADING..." + opacity: 0.6 + cursor: wait
Input: disabled
```

### Playing State
```jsx
Play button: Shows pause icon (two bars)
Progress bar: Animates width
Time: Updates in real-time
```

### Selected State
```jsx
Checkbox: Black bg, white checkmark
Track highlight: (none, only checkbox changes)
```

### Hover State
```jsx
Buttons: Invert colors
Track items: (no hover effect on card itself)
Action buttons: Individual hover effects
```

---

## 🎵 Functional Components

### Header Input
- **Placeholder**: "PASTE SOUNDCLOUD OR SPOTIFY URL"
- **Black background**, white text
- **Full width** (flex: 1)
- **Enter key** triggers ADD

### ADD Button
- **Black background**, white text
- **Hover**: Inverts
- **Loading**: Shows "LOADING..."

### Tab Navigation
- **Two tabs**: ABOUT | PREVIEW
- **Active**: Black bg, white text
- **Inactive**: White bg, black text

### Search Bar
- **White background**, black text
- **Placeholder**: "SEARCH TRACKS..."
- **Instant filter** on type

### Filter Inputs
- **BPM MIN/MAX**: 80px width, number input
- **ARTIST**: Flex: 1, text input
- All filter **instantly**

### Sort Controls
- **Dropdown**: TITLE, ARTIST, BPM, DURATION
- **Toggle button**: ↑ ASC or ↓ DESC
- **Instant reorder**

### Track Card
- **Play button**: Left, 32px square
- **Info section**: Center, flex: 1
- **Actions**: Right, 32px squares each

### Progress Bar
- **2px height**
- **Click to seek**
- **Drag to scrub**
- **Gray background**, black fill

---

## 🎨 Typography Scale

```
H1 (About): 12px, bold, white
Buttons: 11px, uppercase
Input: 11px, uppercase
Track Title: 12px, uppercase
Track Meta (BPM): 10px, gray
Track Time: 11px
CTA Button: 14px, semi-bold
```

---

## 🔧 Implementation Tips

### For Claude Design:

1. **Start with video background** - Fixed, fullscreen layer
2. **Layer white panels on top** - Content area, z-index: 1
3. **Use monospace font throughout** - SF Mono primary
4. **All text uppercase** - CSS: text-transform: uppercase
5. **Sharp corners everywhere** - border-radius: 0
6. **Invert hover states** - Swap black ↔ white on hover
7. **Keep it minimal** - No shadows, no gradients
8. **High contrast** - Pure black & white only

### Design System Summary:
```jsx
Colors: 3 (#1a1a1a, #fff, #666)
Fonts: 1 family (monospace)
Border Radius: 0 (always)
Font Sizes: 4-5 (10-14px)
Transitions: 1 (0.2s ease-out)
Shadows: 0 (none)
Gradients: 0 (none)
```

---

## 📸 Visual Examples

### Button
```
┌─────────────┐
│     ADD     │  ← Black bg, white text
└─────────────┘

Hover:
┌─────────────┐
│┃   ADD    ┃│  ← White bg, black text, outline
└─────────────┘
```

### Track Card
```
┌────────────────────────────────────────────┐
│ ▶ LOVE FOR LOVE - ROBIN S         ☐ ✏ ×   │
│   BPM: 128                                 │
│   00:45 / 04:15                            │
│   ████████░░░░░░░░░░░░░░░░░░░             │
└────────────────────────────────────────────┘
```

### Progress Bar
```
Track: ░░░░░░░░░░░░░░░░░░░░░░░░ (gray #999)
Fill:  ████████                 (black #1a1a1a)
       ↑ Width animates 0-100%
```

---

## 🎯 Design Goals

- ✅ **Professional**: Clean, no-nonsense
- ✅ **Functional**: Every element has purpose
- ✅ **Technical**: Monospace, terminal aesthetic
- ✅ **Minimal**: Black & white only
- ✅ **Consistent**: Inverted hover pattern everywhere
- ✅ **Modern**: Brutalist, flat design

---

**Copy this to Claude Design and start building!** 🎨

**Full spec**: See `UI_DESIGN_SPEC.md` for complete details.
