# Kolours — Project Context & Requirements
> Generated from product design session. Drop this file into your project root so Claude Code picks it up automatically every session.

---

## Project Overview

**Kolours** is a multi-artist online art marketplace for displaying and selling original paintings. The design aesthetic is **clean and minimal — white gallery feel**.

---

## Core Purpose

- A marketplace where **multiple artists** can list and sell original paintings
- Buyers can browse, filter, wishlist, and purchase works
- Artists can upload their own paintings with full metadata
- Every painting is an original, one-of-a-kind work

---

## Design System

| Token | Value |
|---|---|
| **Aesthetic** | Clean, minimal, white gallery |
| **Primary font** | Cormorant Garamond (serif) — headings, titles |
| **Secondary font** | DM Sans — body, UI, labels |
| **Primary colour** | #1a1a1a (near black) |
| **Background** | #ffffff / #f5f5f3 (off-white) |
| **Accent / sold** | #B85C38 (warm terracotta) |
| **Success / available** | #2D6A4F (deep green) |
| **Border style** | 0.5px solid rgba(0,0,0,0.08–0.18) |
| **Border radius** | Subtle — 2px for buttons, 4–12px for cards/panels |
| **Icon library** | Tabler Icons (@tabler/icons-webfont) |

---

## Pages & Sections

### 1. Gallery Page (Home)
- Sticky top navigation with logo, category links, cart icon with item count badge
- **Hero section**: eyebrow text, serif headline with italic accent, short description, CTA buttons
- **Category filter tabs**: All, Abstract, Landscape, Portrait, Still Life, Figurative
- **Sidebar filters**: Medium, Price range (slider), Availability, Origin/country
- **Painting grid**: responsive, auto-fill columns (min 160–240px)
- **Featured Artists strip** at the bottom of the gallery

### 2. Upload / List Art Page
- Accessible via "List art" tab (bottom nav on mobile, nav link on desktop)
- **Drop zone** for image upload (JPG, PNG, WEBP)
- Form fields: Title, Price (CAD), Category, Medium, Dimensions, Artist name, Description
- Live preview of uploaded image before submission
- **Listings panel**: shows all artist's listed works with stats (total listed, total value, categories)
- Each listing shows: thumbnail, title, artist, category, price, status pill (live/draft), delete button
- Success confirmation bar on submission

### 3. Painting Detail Modal
- Triggered by clicking any painting card
- Shows: full image, category + medium eyebrow, title, artist, price
- Detail grid: Dimensions, Year, Medium, Availability
- Description text
- Add to cart + Save (wishlist) actions
- On mobile: bottom sheet style (slides up), drag handle

### 4. Cart Sheet
- Slides up from bottom (mobile sheet pattern)
- Lists cart items with thumbnail, name, artist, price
- Shows total
- Checkout button (placeholder — connect payment provider)

---

## Painting Card Component

Each card includes:
- Image area (aspect ratio 4:5) — renders uploaded photo OR generative canvas art for seed data
- Badge overlay: `featured`, `new`, `sold`
- Wishlist heart button (top right, appears on hover/tap)
- Title (Cormorant Garamond)
- Artist name + origin
- Price + dimensions
- "Add to cart" button → transitions to "In cart ✓" state (green) once added
- Disabled + "Sold" state for unavailable works

---

## Mobile (PWA) Requirements

- Fully responsive, optimised for iPhone and Android
- Bottom navigation bar: Gallery | List art
- Safe area insets (`env(safe-area-inset-bottom)`) for iPhone notch/home bar
- `-webkit-tap-highlight-color: transparent` on interactive elements
- Modal/cart use bottom sheet pattern with drag handle
- `<meta name="apple-mobile-web-app-capable" content="yes">` for PWA install
- Theme colour: `#ffffff`
- App name: `Atelier Market` (can be updated to `Kolours`)
- Installable via Netlify Drop or any static host → "Add to Home Screen"

---

## Data Model

### Painting
```json
{
  "id": "number | timestamp",
  "title": "string",
  "artist": "string",
  "price": "number (CAD)",
  "size": "string (e.g. 60×80 cm)",
  "medium": "string",
  "category": "Abstract | Landscape | Portrait | Still Life | Figurative",
  "origin": "string (country)",
  "year": "number",
  "available": "boolean",
  "badge": "featured | new | sold | null",
  "desc": "string",
  "img": "base64 string | null",
  "colors": "string[] (fallback palette for generative canvas)"
}
```

### Artist
```json
{
  "name": "string",
  "works": "number",
  "country": "emoji flag string",
  "hue": "string[] (avatar gradient colors)"
}
```

---

## Filtering & Sorting

- Filter by **category** (tabs)
- Filter by **medium** (sidebar)
- Filter by **price range** (slider, max $5,000)
- Filter by **availability** (all / available / sold)
- Filter by **origin/country** (sidebar)
- Sort by: Featured | Price low→high | Price high→low | Newest

---

## Key Interactions & UX

- Toast notifications (bottom centre) for cart actions, wishlist, errors
- Wishlist toggle (heart icon) — persists in session
- Cart badge count on nav icon
- Hover: card lifts (`translateY(-2px)`), border darkens
- Active/tap: card scales down slightly (`scale(0.98)`) on mobile
- Filter tabs update gallery count label in real time
- Upload form resets fully after successful submission
- Newly listed paintings appear immediately in gallery with `new` badge

---

## Tech Stack (current prototype)

- **Single-file HTML** (HTML + CSS + JS, no build step)
- Fonts via Google Fonts CDN
- Icons via Tabler Icons CDN (`cdn.jsdelivr.net`)
- Generative canvas art for seed/placeholder paintings
- All state in-memory (no backend yet)

## Recommended Next Steps (Backend)

- [ ] Connect **Supabase** or **Firebase** for persistent painting storage
- [ ] Add **Stripe** or **Stripe Payment Links** for checkout
- [ ] Artist authentication (sign up / log in)
- [ ] Image storage via **Supabase Storage** or **Cloudinary**
- [ ] Admin panel for moderation
- [ ] SEO metadata per painting page

---

## Seed Data

12 sample paintings pre-loaded across 6 artists:
Sophie Marceau (France), Kenji Watanabe (Japan), Ana Lima (Brazil), Lena Fischer (Germany), James Okello (Kenya), Clara Thompson (UK).

Categories covered: Abstract, Landscape, Portrait, Still Life, Figurative.
Price range: $750 – $5,000.
2 sold works (Threshold by Ana Lima, Rupture by James Okello).

---

## File Reference

- `atelier-market.html` — full working PWA prototype (single file)
- `CLAUDE.md` — this file (project context for Claude Code)
