# UI Refactor Plan

Based on the `/impeccable:audit` and `/impeccable:extract` analysis. Work in phases — each phase is independent and shippable.

---

## Phase 1: Normalize (theming consistency)
**Command:** `/impeccable:normalize`
**Effort:** Large | **Impact:** High

The biggest systemic issue. 200+ hard-coded Tailwind colors and 28 manual `useTheme()` ternaries.

- [ ] Replace manual `isLightTheme` ternaries with Tailwind `dark:` prefix in all tournament components
- [ ] Define semantic color tokens for status states (success, warning, error, info) as CSS variables
- [ ] Migrate hard-coded `bg-green-*`, `bg-red-*`, `bg-blue-*` to semantic tokens where they represent status (not Redemption card brigades)
- [ ] Consolidate on shadcn/ui — replace Flowbite `<Button gradientDuoTone="...">` with shadcn button variants
- [ ] Remove glassmorphism (`backdrop-blur-sm` + transparency) from auth layout — use solid backgrounds
- [ ] Add missing `dark:hover:` variants where `hover:` exists without dark counterpart

**Key files:**
- `components/ui/EditParticipantModal.tsx`
- `components/ui/match-edit.tsx`
- `components/ui/PodGenerationModal.tsx`
- `components/ui/TournamentSettings.tsx`
- `components/ui/TournamentRounds.tsx`
- `components/ui/participant-form-modal.tsx`
- `components/ui/CountdownTimer.tsx`
- `components/ui/TournamentStartModal.tsx`
- `components/top-nav.tsx`
- `app/(auth-pages)/layout.tsx`
- `app/tracker/tournaments/page.tsx`

---

## Phase 2: Extract (shared Dialog component)
**Command:** `/impeccable:extract`
**Effort:** Medium | **Impact:** High

12+ modals each re-implementing ESC handling, backdrop click, scroll lock, and styling.

- [ ] Create a `Dialog` component in `components/ui/dialog.tsx` with:
  - ESC key dismissal
  - Backdrop click to close
  - Body scroll lock
  - Consistent overlay (`bg-black/50`)
  - Standard header/body/footer slots
- [ ] Create a `ConfirmationDialog` variant (for delete/clear patterns)
- [ ] Migrate existing modals to use the shared component:
  - `DeleteDeckModal`, `ClearDeckModal` (near-identical)
  - `UsernameModal`, `FolderModal`, `LoadDeckModal`
  - `EditParticipantModal`, `EditTournamentNameModal`
  - `tournament-form-modal`, `participant-form-modal`
  - `PodGenerationModal`, `TournamentStartModal`, `RepairPairingModal`

---

## Phase 3: Harden (accessibility)
**Command:** `/impeccable:harden`
**Effort:** Medium | **Impact:** High

Critical a11y gaps — keyboard users and screen readers blocked.

- [ ] Convert div-with-onClick to `<button>` in `register/page.tsx` (7+ instances)
- [ ] Add `aria-label` to icon-only buttons in `ModalWithClose.tsx`, `DeckBuilderPanel.tsx`
- [ ] Fix focus indicators — replace bare `focus:outline-none` with `focus-visible:ring-2` in toggle switches
- [ ] Fix form semantics in `register/page.tsx` — use proper `<label htmlFor>` instead of div onClick wrappers
- [ ] Add keyboard handlers wherever `onClick` exists on non-button elements

---

## Phase 4: Optimize (performance)
**Command:** `/impeccable:optimize`
**Effort:** Medium | **Impact:** Medium

Performance wins, mostly in goldfish game components.

- [ ] Replace `<img>` with `next/image` in `CardHoverPreview.tsx`, `PhaseBar.tsx`, `CardZoomModal.tsx`, `FilterGrid.tsx`
- [ ] Replace direct style mutations (`e.currentTarget.style.transform = ...`) with CSS classes + `transition` in goldfish components
- [ ] Fix `ParticipantTable.tsx` line 33: `participants.sort()` mutates in render — wrap in `useMemo` with spread
- [ ] Consider splitting `DeckBuilderPanel.tsx` (2,949 lines) and `client.tsx` (2,664 lines)

---

## Phase 5: Adapt (mobile/responsive)
**Command:** `/impeccable:adapt`
**Effort:** Small | **Impact:** Medium

Touch targets and mobile edge cases.

- [ ] Increase touch targets to 44x44px minimum: `CardContextMenu.tsx` (30px), `DeckContextMenu.tsx` (24px), `ParticipantTable.tsx` (24px)
- [ ] Add `safe-area-inset` handling in `GameHUD.tsx` and `PhaseBar.tsx` for iPhone notch
- [ ] Make fixed pixel widths responsive: `CardZoomModal.tsx` (maxWidth: 400), `LoadingScreen.tsx` (320px progress bar)
- [ ] Add text truncation for participant names and card names on mobile

---

## Phase 6: Polish (final pass)
**Command:** `/impeccable:polish`
**Effort:** Small | **Impact:** Low

After all structural work is done.

- [ ] Remove redundant copy ("Get started by clicking Host A Tournament")
- [ ] Fix nested card patterns in `admin/registrations/page.tsx`
- [ ] Extract goldfish hex colors (`#2a1f12`, `#6b4e27`, etc.) to CSS variables
- [ ] Final alignment, spacing, and consistency sweep

---

## Suggested order

```
Phase 1 (normalize) → Phase 2 (extract) → Phase 3 (harden) → Phase 4 (optimize) → Phase 5 (adapt) → Phase 6 (polish)
```

Normalize first because it establishes the token/component foundation everything else builds on. Extract second because the shared Dialog reduces the surface area for phases 3-5. Harden before optimize because a11y is more important than perf. Polish last.

Each phase can be run as a single `/impeccable:*` command scoped to the relevant files.
