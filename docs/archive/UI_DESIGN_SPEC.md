# ILoveMusic UI Design Specification
**For Claude Design Implementation**

---

## 🎨 Design Philosophy

**Style**: Minimal, Brutalist, Monospace, Black & White  
**Inspiration**: Terminal/Command-line aesthetic  
**Target**: Professional DJs and music enthusiasts  
**Feel**: Clean, functional, no-nonsense

---

## 📐 Layout Structure

### Window Specifications
```
Fixed Size: 1200px × 800px
Resizable: NO
Fullscreen: NO
Background: Animated video (bg01.mp4)
```

### Component Hierarchy
```
App (Full Screen)
├── Video Background (Fixed, fullscreen, z-index: -1)
└── Content Container (z-index: 1)
    ├── Header Bar (URL Input + ADD button)
    ├── Main Content Area
    │   ├── Tab Navigation (ABOUT | PREVIEW)
    │   ├── About Tab
    │   └── Preview Tab
    │       ├── Search & Filter Section
    │       └── Track List
    └── Hidden Audio Elements
```

---

## 🎨 Design System

### Colors
```css
Primary Black: #1a1a1a
Pure White: #fff
Text Gray: #666
Progress Bar Gray: #999

Backgrounds:
- Video: Animated video background
- Panels: White (#fff)
- Inputs: Black (#1a1a1a)
- Hover: Inverted (black ↔ white)
```

### Typography
```css
Font Family: "SF Mono", "Monaco", "Inconsolata", "Roboto Mono", "Courier New", monospace
Font Weight: 400 (normal), 600 (semi-bold), 700 (bold)
Text Transform: UPPERCASE (all UI text)
Letter Spacing: 0.01em - 0.02em

Font Sizes:
- H1 (About): 12px
- Input Text: 11px
- Button Text: 11px, 14px (CTA)
- Track Title: 12px
- Track Meta: 10px, 11px
- Labels: 11px
```

### Spacing
```css
Component Padding:
- Header: 20px 32px
- Content Area: 32px 48px
- Cards: 16px
- Filter Section: 16px

Component Gaps:
- Between sections: 32px, 16px, 12px
- Between inputs: 8px
- Between buttons: 8px, 12px
```

### Border Radius
```css
All: 0px (Sharp corners, no rounding)
```

### Transitions
```css
All Interactive Elements:
- transition: all 0.2s ease-out
- Hover effects invert colors
```

---

## 📦 Component Breakdown

### 1. Video Background
```jsx
<video autoPlay loop muted playsInline>
  Position: fixed
  Top: 0, Left: 0
  Size: 100% × 100%
  Object Fit: cover
  Z-index: -1
  Pointer Events: none
</video>
```

**Purpose**: Ambient animated background  
**Source**: bg01.mp4 (looping video)  
**Effect**: Adds motion without distraction  

---

### 2. Header Bar (URL Input)

**Layout**: Horizontal flex, full width  
**Background**: White (#fff)  
**Border Bottom**: 1px solid #1a1a1a  
**Padding**: 20px 32px  

**Components**:

#### Input Field
```css
Flex: 1
Background: #1a1a1a
Color: #fff
Padding: 10px 14px
Font Size: 11px
Text Transform: UPPERCASE
Placeholder: "PASTE SOUNDCLOUD OR SPOTIFY URL"
Border: none
Outline: none on focus
```

**States**:
- Normal: Black bg, white text
- Disabled: opacity 0.6
- Loading: Cursor wait

#### ADD Button
```css
Padding: 10px 32px
Font Size: 11px
Text Transform: UPPERCASE
Background: #1a1a1a
Color: #fff
Border: none
Cursor: pointer
Transition: all 0.2s ease-out
```

**States**:
- Normal: Black bg, white text
- Hover: White bg, black text, 1px black outline
- Loading: Text changes to "LOADING...", opacity 0.6, cursor wait
- Disabled: opacity 0.6

---

### 3. Tab Navigation

**Layout**: Horizontal buttons  
**Gap**: 12px  
**Margin Bottom**: 32px  

**Tab Buttons**: `['about', 'preview']`

```css
Font Size: 11px
Padding: 10px 20px
Text Transform: UPPERCASE
Border Radius: 0
Cursor: pointer
Transition: color, background 0.2s
```

**Active Tab**:
```css
Background: #1a1a1a
Color: #fff
Border: 1px solid #fff
```

**Inactive Tab**:
```css
Background: #fff
Color: #1a1a1a
Border: 1px solid #1a1a1a
```

---

### 4. About Tab

**Layout**: Centered flex column  
**Min Height**: 400px  
**Alignment**: center (both axes)  
**Gap**: 24px  

**Components**:

#### Heading
```css
Text: "MADE BY LOVE ILOVEMUSIC ❤️ RIPO"
Font Size: 12px
Font Weight: 700
Color: #fff (stands out on video bg)
Text Transform: UPPERCASE
Text Align: center
```

#### Instagram Link Button
```css
Text: "@CACTUSDOMAIN"
Padding: 14px 40px
Font Size: 14px
Font Weight: 600
Background: #fff
Color: #1a1a1a
Border: 2px solid #1a1a1a
Text Decoration: none
Text Transform: UPPERCASE
Display: inline-block
Transition: all 0.2s ease-out
```

**Hover State**:
```css
Background: #1a1a1a
Color: #fff
```

---

### 5. Preview Tab - Search & Filter Section

**Layout**: White panel, vertical stack  
**Background**: #fff  
**Padding**: 16px  
**Margin Bottom**: 16px  
**Gap**: 12px  

#### Row 1: Search Bar + Select All
```jsx
<Horizontal Flex, gap: 8px>
  <Input: Search (flex: 1)>
  <Button: SELECT ALL / DESELECT ALL>
</Horizontal>
```

**Search Input**:
```css
Flex: 1
Font Size: 11px
Padding: 8px 12px
Background: #fff
Border: 1px solid #1a1a1a
Placeholder: "SEARCH TRACKS..."
Text Transform: UPPERCASE
```

**Select All Button**:
```css
Padding: 8px 16px
Font Size: 11px
Background: #fff (or #1a1a1a if all selected)
Color: #1a1a1a (or #fff if all selected)
Border: 1px solid #1a1a1a
Text: "SELECT ALL" or "DESELECT ALL"
```

#### Row 2: BPM & Artist Filters
```jsx
<Horizontal Flex, gap: 8px, wrap>
  <Input: BPM MIN (width: 80px)>
  <Input: BPM MAX (width: 80px)>
  <Input: ARTIST (flex: 1)>
</Horizontal>
```

**All Inputs**:
```css
Font Size: 11px
Padding: 6px 10px
Border: 1px solid #1a1a1a
Background: #fff
Text Transform: UPPERCASE
Outline: none
```

#### Row 3: Sort Controls
```jsx
<Horizontal Flex, gap: 8px, align: center>
  <Label: "SORT BY:">
  <Select Dropdown>
  <Button: ASC/DESC Toggle>
</Horizontal>
```

**Label**:
```css
Font Size: 11px
Text Transform: UPPERCASE
```

**Select Dropdown**:
```css
Font Size: 11px
Padding: 6px 10px
Border: 1px solid #1a1a1a
Background: #fff
Options: TITLE, ARTIST, BPM, DURATION
```

**Sort Toggle Button**:
```css
Padding: 6px 12px
Font Size: 11px
Text: "↑ ASC" or "↓ DESC"
```

---

### 6. Track Item Card

**Layout**: Horizontal flex  
**Background**: #fff  
**Padding**: 16px  
**Gap**: 16px  
**Border**: none  
**Border Radius**: 0  
**Margin Bottom**: 12px (gap between tracks)  

**Structure**:
```
[Play Button] [Track Info (flex: 1)] [Select] [Edit] [Delete]
```

#### Play Button
```css
Size: 32px × 32px
Background: transparent
Border: none
Cursor: pointer
Display: flex (center content)
Flex Shrink: 0
Outline: none
```

**Icon States**:
- **Playing**: Two vertical bars (3px wide, 10px tall, gap 2px, black)
- **Paused**: Triangle (8px border-left, 6px border-top/bottom transparent)

#### Track Info Section (flex: 1)

**Track Title**:
```css
Font Size: 12px
Color: #1a1a1a
Text Transform: UPPERCASE
Margin Bottom: 4px
Overflow: hidden
Text Overflow: ellipsis
White Space: nowrap
Format: "{title} - {artist}"
```

**BPM Display** (if available):
```css
Font Size: 10px
Color: #666
Text Transform: UPPERCASE
Margin Bottom: 4px
Display: flex, gap: 12px
Format: "BPM: {bpm}"
Font Weight: 600 for label
```

**Time Display**:
```css
Font Size: 11px
Color: #1a1a1a
Margin Bottom: 6px
Format: "00:45 / 04:15"
```

**Progress Bar**:
```css
Height: 2px
Background: #999 (track background)
Position: relative
Max Width: 100%
Cursor: pointer
Interactive: Click & drag to seek
```

**Progress Fill**:
```css
Position: absolute
Left: 0, Top: 0
Height: 100%
Width: {progress}% (0-100%)
Background: #1a1a1a
Transition: width 0.1s linear
```

#### Action Buttons (Right Side)

**Select Checkbox Button**:
```css
Size: 32px × 32px
Display: flex (center)
Font Size: 18px
Cursor: pointer
Transition: all 0.2s ease-out
```

**Unselected State**:
```css
Background: #fff
Border: 1px solid #1a1a1a
Color: #1a1a1a
Content: Empty or "☐"
```

**Selected State**:
```css
Background: #1a1a1a
Border: none
Color: #fff
Content: "✓"
```

**Hover Effect** (when unselected):
```css
Background: #1a1a1a
Color: #fff
```

**Edit Button**:
```css
Size: 32px × 32px
Background: #fff
Border: 1px solid #1a1a1a
Cursor: pointer
Icon: "✏" or "EDIT"
```

**Delete Button**:
```css
Size: 32px × 32px
Background: #fff
Border: 1px solid #1a1a1a
Color: red or #1a1a1a
Cursor: pointer
Icon: "🗑" or "×"
```

---

## 🎯 Interaction States

### Button Hover Pattern
```css
Default State:
- Background: #1a1a1a
- Color: #fff
- Border: none or 1px solid #1a1a1a

Hover State:
- Background: #fff
- Color: #1a1a1a
- Outline: 1px solid #1a1a1a (if needed)
```

### Input Focus
```css
Outline: none
Border: 1px solid #1a1a1a (no change on focus)
```

### Loading States
```css
Opacity: 0.6
Cursor: wait
Text: Changes to "LOADING..."
Disabled: true
```

### Progress Bar Interaction
```
- Click anywhere to seek
- Click and drag to scrub
- Visual feedback: cursor changes to pointer
- Smooth width transition (0.1s linear)
```

---

## 📱 Responsive Behavior

**Window is FIXED SIZE (1200×800)**

- No responsive breakpoints
- No mobile view
- Desktop-only application
- Content area max-width: 1200px, centered

---

## 🎨 Visual Hierarchy

### Primary Actions (Most Prominent)
1. **ADD button** (header) - Black, inverts on hover
2. **Tab buttons** - Active tab is inverted

### Secondary Actions
1. **Play button** - Icon-based, transparent bg
2. **Select/Edit/Delete** - Right-aligned, equal prominence

### Tertiary Actions
1. **Filter inputs** - Subtle, blend into white panel
2. **Sort controls** - Small, functional

---

## 🎬 Animation & Motion

### Transitions
```css
All interactive elements: transition: all 0.2s ease-out
Progress bar: transition: width 0.1s linear
```

### No Heavy Animations
- Video background provides ambient motion
- UI interactions are instant/snappy
- Hover states smooth (0.2s)
- No loading spinners (text-based feedback)

---

## 🎵 Audio Visualization

**Progress Bar IS the visualization**

- No waveforms
- No spectrum analyzer
- Simple 2px bar that fills as track plays
- Click/drag to seek
- Time display shows current/total

---

## 📝 Text Content

### All Text is UPPERCASE

Examples:
- "PASTE SOUNDCLOUD OR SPOTIFY URL"
- "SEARCH TRACKS..."
- "BPM MIN"
- "SELECT ALL"
- "SORT BY:"
- "MADE BY LOVE ILOVEMUSIC ❤️ RIPO"

### Format Patterns
- Track: `{TITLE} - {ARTIST}`
- BPM: `BPM: {number}`
- Time: `{MM:SS} / {MM:SS}`
- Sort: `↑ ASC` or `↓ DESC`

---

## 🔧 Functional Specifications

### Track Data Structure
```javascript
{
  id: number,              // Timestamp
  title: string,
  artist: string,
  duration: number,        // Seconds
  currentTime: number,     // Seconds
  url: string,            // file:// URL
  filePath: string,       // Absolute path
  bpm: number | null,     // 60-200
  key: string | null,     // Musical key
  artworkPath: string | null,
  source: 'soundcloud' | 'spotify',
  downloadSource: 'spotdl' | 'youtube-fallback'
}
```

### State Management
```javascript
State Variables:
- tracks: Array<Track>
- selected: Set<number> (track IDs)
- playingTrack: number | null
- loadingTrack: boolean
- downloading: boolean
- downloadProgress: number (0-100)
- searchQuery: string
- filterBpmMin: string
- filterBpmMax: string
- filterArtist: string
- sortBy: 'title' | 'artist' | 'bpm' | 'duration'
- sortOrder: 'asc' | 'desc'
- activeTab: 'about' | 'preview'
- hoveredButton: string | null
- editingTrack: Track | null
```

### Key Interactions

1. **Add Track**: Paste URL → Click ADD → Wait → Track appears
2. **Play Track**: Click play button → Icon changes to pause → Progress updates
3. **Seek**: Click/drag progress bar → Time updates instantly
4. **Select Multiple**: Click checkboxes → Download button activates
5. **Filter**: Type in filter inputs → List updates instantly
6. **Sort**: Change dropdown/toggle → List reorders instantly

---

## 🎨 Color Palette Summary

```
Background Video: Ambient (not solid color)
Primary Panel: #fff (white)
Primary Text: #1a1a1a (near-black)
Secondary Text: #666 (gray)
Progress Track: #999 (light gray)
Progress Fill: #1a1a1a (near-black)
Hover Invert: Black ↔ White
```

---

## 🚀 Implementation Notes for Claude Design

### Key Design Principles
1. **Brutalist Aesthetic** - Sharp corners, no shadows, high contrast
2. **Monospace Typography** - Terminal/code editor feel
3. **Minimal Color Palette** - Black, white, gray only
4. **Functional Over Decorative** - Every element serves a purpose
5. **Inverted Hover States** - Predictable interaction pattern

### What Makes This UI Unique
- Video background (unusual for music apps)
- All-uppercase text (assertive, confident)
- Monospace fonts (technical, precise)
- No border radius (sharp, modern)
- Inverted hover states (high contrast feedback)
- Minimalist controls (no clutter)

### Design Inspirations
- Command-line interfaces
- Terminal applications
- Brutalist web design
- Swiss typography
- DJ software (Rekordbox, Serato) simplified

---

## 📸 Visual Reference

```
┌────────────────────────────────────────────────────────┐
│ [━━━━━━━━━━━━━━ VIDEO BACKGROUND ━━━━━━━━━━━━━━━━]  │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ [INPUT: PASTE URL...  ] [ADD]                   │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ [ABOUT] [PREVIEW]                                      │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ [SEARCH...] [SELECT ALL]                        │   │
│ │ [BPM MIN] [BPM MAX] [ARTIST]                    │   │
│ │ SORT BY: [TITLE ▼] [↑ ASC]                      │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ ▶ LOVE FOR LOVE - ROBIN S                       │   │
│ │   BPM: 128                                       │   │
│ │   00:45 / 04:15                                  │   │
│ │   ████████░░░░░░░░░░░░                 [✓][✏][×]│   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
└────────────────────────────────────────────────────────┘
```

---

**This spec provides everything needed to recreate the ILoveMusic UI in Claude Design!** 🎨🎵

