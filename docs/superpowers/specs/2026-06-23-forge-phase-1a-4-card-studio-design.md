# The Forge — Phase 1a.4: Card Design Studio + Ideas Library (Design)

**Date:** 2026-06-23
**Status:** Design approved; ready for implementation plan
**Parent spec:** `docs/superpowers/specs/2026-06-19-forge-card-design-playtesting-design.md`
**Builds on:** 1a.1 (access/roles + RLS foundation, mig 048), 1a.2 (invites/members, mig 049), 1a.3 (private art pipeline, mig 050) — all merged to `main`.

This addendum specifies the slice the parent spec calls the **card design studio** plus the **ideas library**. The parent spec already resolved the overall design (data model, `DesignCard` field schema, lifecycle, studio UX); this document records the slice-specific decisions, the faithful card-preview architecture (new), the frame/font asset pipeline (new), and the resolutions from a two-subagent review pass (security/arch + requirements/scope) plus a font-licensing verification.

---

## 1. Scope

**In scope (1a.4):**
- **Migration 051** — add card *content* to the identity-only `forge_cards` from 1a.3.
- **`DesignCard` schema + validation** — a pure module (types, enums, cardType→field applicability matrix, advisory `validate()`).
- **`<ForgeCardPreview>`** — a faithful, layered card-frame render composited from exported Figma element PNGs + libre fonts, with graceful fallback.
- **Studio editor** at `/forge/ideas/[cardId]` — live preview + form, napkin mode + full mode, debounced autosave, art control reused from 1a.3.
- **Ideas library** at `/forge/ideas` — dense preview grid of the signed-in member's cards, type/brigade/search filters, empty state. Replaces `/forge/art` as the Forge home.
- **Security spine extension** — owner-or-superadmin SELECT policy, content-safe RPCs, and a broadened anon/non-member leak guardrail.

**Explicitly deferred to later sub-phases (NOT in 1a.4):**
- Sets, set-elders/grants, set notes, the progress dashboard, printer/promotion export.
- Card lifecycle transitions (publish → `card_versions`, approve, promote, share/send-back) and the interactive status stepper.
- The review layer (proposals, single-field suggestions, comments, presence) — Phase 1b.
- Playtester role, deckbuilder, games — Phase 2.

The `status` **column** lands now (cheap forward-compat), but no transition UI or RPC ships (a transition RPC with no caller is dead attack surface).

---

## 2. Decisions made during brainstorming

| Question | Decision |
|---|---|
| Slice size | Studio editor **+** Ideas library (one coherent, shippable home for solo card design). |
| Field depth | **Full** `DesignCard` schema (all ~17 fields) — the schema is the cheap, stable part; building napkin mode against a partial schema would force rework. |
| Preview fidelity | **Faithful** layered frame, rebuilt from the user's Figma "Redemption card designer" kit (one parameterized Modern frame), with graceful fallback. |
| Fonts | Proprietary kit fonts (Helvetica, Symphony Black, Grail) **removed**; replaced with libre substitutes (see §6). |
| Frame assets | Kept as **public static** (consistent with the app's existing public Redemption card imagery); low, non-enforced IP risk. |

---

## 3. Data model — migration 051

`forge_cards` already exists (mig 050) as **identity + art only**: `id, owner_id, title, working_art_key, working_art_is_placeholder, working_art_original_key, created_at, updated_at`. 051 adds card *content* and the content RPCs.

**Columns added to `forge_cards`:**
- `working_snapshot jsonb not null default '{}'` — the live `DesignCard` fields (autosave target; mutable draft).
- `status forge_card_status not null default 'private_idea'` — create the enum `('private_idea','draft','playtesting','approved','promoted','archived')` from the parent spec.

**Reconciliation with 050 (must be explicit):**
- **`title` stays** as a denormalized mirror of `working_snapshot->>'name'`, so the ideas-grid list query stays cheap and indexable without parsing jsonb. `forge_save_card` updates both `title` and `working_snapshot`.
- **No `set_id` yet.** Sets don't exist in 1a.4, so the ideas grid lists *all* of the member's cards (every card is an idea pre-sets). The parent spec's `set_id IS NULL` predicate arrives with the sets sub-phase; a code comment documents this.
- **`forge_create_card` (050) stays** for creation; **`forge_save_card` (new)** handles autosave/update. Two distinct, intentional paths (create → then edit). The 050 art RPCs (`forge_set_working_art`, `forge_set_art_placeholder`, `forge_log_art_download`) are unchanged and reused.

**RLS fix (CRITICAL — replaces the 050 policy):**
050 shipped `for select to authenticated using (is_forge_member())` — acceptable when the only readable columns were a title + opaque art key, but a **leak** once `working_snapshot` holds card names + ability text: any member (and any future playtester) could read every member's private ideas. The parent spec says a `private_idea` is owner-(+superadmin)-only. 051 replaces the policy:

```sql
create policy "forge_cards_select" on public.forge_cards
  for select to authenticated using (
    owner_id = auth.uid() or public.is_forge_superadmin()
  );
```

This makes 1a.4 a true single-author tool per member — consistent with the parent spec's "single-author Phase 1a." Add a `public.is_forge_superadmin()` SECURITY DEFINER helper (mirroring 048's `is_forge_member`/`is_forge_elder_or_super`: `set search_path=''`, revoke from public/anon, grant authenticated). The sets sub-phase later `create or replace`s this policy to add the set-elder/granted branches — a clean evolution, not throwaway.

**New RPCs (clone 050's proven pattern: `security definer set search_path=''`, owner-or-elder authz, `revoke ... from public, anon` + `grant ... to authenticated`):**
- `forge_save_card(p_card_id uuid, p_snapshot jsonb)`:
  - Authz: card owner or elder/superadmin (matches 050's art RPCs).
  - **Column-only write:** writes *only* `working_snapshot` (+ syncs `title` from `p_snapshot->>'name'`, + `updated_at = now()`). Never trusts `owner_id`/`status`/`set_id`/version keys inside the jsonb.
  - **Size cap:** `if octet_length(p_snapshot::text) > 64000 then raise exception`.
  - Returns the new `updated_at` (forward-compat for optimistic concurrency in 1b; last-write-wins is accepted for single-author 1a).
- `forge_set_card_status` — **deferred** (no stepper ⇒ no caller). Only the column lands.

**No new tables.** `forge_sets`, `card_versions`, proposals/comments stay in later sub-phases.

---

## 4. `DesignCard` schema + validation (`app/forge/lib/designCard.ts`)

Pure module — TS types, enums, applicability matrix, and `validate()`. No UI, no DB. Consumed by the form, the preview, and (later) the publish validation. Fully unit-testable.

- **Fields:** all ~17 from the parent spec's field table. Multi-value fields are **arrays** natively (`cardType: CardType[]`, `brigades: Brigade[]`, `class`, `icons`, `identifiers`). The legacy delimited-string `toCardData()` adapter is deferred to Phase 2 (deck-validation/promotion reuse).
- **`class` vs `icons` split:** the parent spec claims grounding in the repo's `CardData`, but the live `CardData.class` field **conflates** Warrior/Weapon *and* Cloud/Star/Territory in one column. `DesignCard` correctly **splits** them (`class` = Warrior/Weapon; `icons` = Territory/Star/Cloud). This is a deliberate normalization, *not* a 1:1 mapping — the future `toCardData()` adapter must re-merge them. Documented so no one assumes a straight passthrough.
- **Brigade enum:** drop `GoodMulti`/`EvilMulti` as selectable values. Per parent-spec Decision #2 the tool stores *resolved* brigades; a multi-brigade card is an explicit array (e.g. `["Blue","Green"]`), not a `Multi` sentinel. **Red, Teal, and Evil Gold are also not supported** (the kit has no frame for them) — they are not selectable. The remaining brigades map 1:1 to the shipped washes. (The preview supports ≤2 brigades; 3+ renders best-effort — see §5.)
- **Applicability matrix (concrete — corrected against the real card pool):**
  - Hero / Evil Character: brigade + might + toughness required; class/icons/identifiers optional.
  - Artifact / Dominant: ability + identifiers; **no** brigade/stats.
  - Lost Soul: ability optional but legality-relevant; no brigade/stats.
  - GE / EE: brigade + ability; strength/toughness as signed modifiers.
  - **Site: brigade expected** (100% of the real pool have one) — not "some".
  - **Fortress: brigade rare/optional** (~6% of the real pool have one).
  - City: brigade optional.
  - **Dual-type** (`cardType` array, e.g. Hero/GE): applicability is the **union** of all selected types' fields (a Hero/GE needs Hero's brigade+stats *and* GE's ability).
- **`validate()` is advisory only in 1a.4.** It returns per-field hints for gentle badges; it **never** blocks autosave or card creation. This protects the napkin promise ("structure never demanded"). Blocking schema validation belongs to the publish RPC in a later sub-phase (server-side, since publish is the gate that exposes content to playtesters).

---

## 5. `<ForgeCardPreview card artUrl />` — the faithful composite

A pure client component rendering on a **750×1050** CSS canvas (the canonical card size; scaled to fit), compositing absolutely-positioned layers back-to-front. Inputs are the `DesignCard` and an art URL; no DB access.

Source assets are the Figma kit's **clean element layers** (`public/forge/frames/Elements/` + `Icons/`) — *not* the per-type assembled frames (those have baked placeholder text + an opaque checkerboard art window, so they're reference/validation only).

**Layer order (back → front):**
1. `Elements/White Border.png` — white rounded base.
2. Brigade wash — `Elements/Background={brigade}.png` (border + title strip + colored regions). Special types use `Background=lost-soul/artifact/good-dom/evil-dom/good-fort/evil-fort.png`; dual brigades use the nested `Background={b1}/{b2}.png`.
3. **Art** — `artUrl` (the 1a.3 private-art proxy `/forge/api/art/[cardId]`), positioned in the art-window rect. Plain `<img>` only (next/image is banned under `app/forge` — see `__tests__/forge-no-next-image.test.ts`).
4. `Elements/Art Box.png` — rounded border over the art.
5. **Stat box** (stat-bearing types only) — `Elements/Color={b1}[/{b2}].png` + `Icons/{type}.png` + might/toughness text.
6. **Title** text over the title strip.
7. `Elements/Identifier Box.png` + identifier text.
8. `Elements/Verse Lines={n}.png` ability/scripture box + ability text + scripture (italic) + reference.
9. Footer — Illus. credit / © line / "CARD DESIGNER" watermark.

**Graceful fallback (built in):** a missing brigade wash → solid brigade color; a missing icon → omitted; an unsupported combination (3+ brigades, Classic frame, full-art) → best-effort render (wash by first brigade) **+ a small "preview approximate" affordance**. Input is **never** blocked by asset gaps — honoring the napkin promise. The component is the unit iterated on visually (screenshotted against `Complete Cards/` references until it matches).

**Geometry** is derived from the 750×1050 canvas + the reference renders; slots are expressed as percentages so the component scales cleanly (grid thumbnail ↔ studio hero ↔ mobile).

---

## 6. Asset pipeline

**Frames** (`public/forge/frames/`): the consumed set is `Elements/` + `Icons/` only. The per-type assembled folders (`Heroes/`, `*Enhancements/`, `Evil Characters/`, `Sites/`, `Covenants/`, `Curses/`) and `Complete Cards/` are baked-text **reference only** — they are *not* served and must be removed from the deployed `public/` (≈49 MB of the current 107 MB). `Elements/` backgrounds convert to **WebP** and load lazily per card-type/brigade, targeting a shipped payload of ~6–10 MB rather than 107 MB. Frame chrome stays public static (low IP risk, consistent with the app's existing public card imagery).

**Fonts** (`public/forge/fonts/`): the four proprietary kit fonts were **removed** (untracked, never committed → zero exposure). Verified proprietary via their own embedded copyright + two independent research passes: Helvetica = macOS-bundled (© Apple/Linotype, Monotype-enforced — DMCA'd on GitHub by name); Symphony Black = CG Symphony (© Agfa/Monotype, "all rights reserved"); grail.ttf = WSI proprietary clone. Substitutes (libre, safe to commit + webfont-embed):

| Role (was) | Substitute | License |
|---|---|---|
| Body / ability / stats (Helvetica Bold) | **Arimo** — metrically identical to Helvetica | Apache-2.0 |
| Scripture italic (Helvetica Oblique) | **Arimo Italic** | Apache-2.0 |
| Card title (Symphony Black) | **Anton** or **Archivo Black** (tuned visually) | SIL OFL 1.1 |
| Identifier/footer (Grail) | **Arimo** (or an OFL face matching its use) | Apache-2.0 |

`@font-face` is structured so a substitute is a one-line swap.

---

## 7. Studio editor — `/forge/ideas/[cardId]`

Live `<ForgeCardPreview>` (the hero) + form.
- **Napkin mode** is the default on a new card: a single free-text field (ghost prompt, zero required fields) that renders a real frame immediately; smart chips light up recognized structure (type/brigade) — **never demanded**.
- **Full mode** reveals the typed fields, driven by the applicability matrix (segmented type control, multi-select brigade color pills, stat inputs, ability textarea, reference, etc.). Dual-type unions the revealed fields.
- **Autosave:** debounced writes to `forge_save_card`. Last-write-wins (single-author 1a; the RPC returns `updated_at` for future optimistic concurrency). Autosave always persists whatever was typed — `validate()` only surfaces gentle hints, never blocks.
- **Art control:** reuses 1a.3 (upload / mark placeholder / download original) — the three art states (No art → Placeholder with diagonal stamp → Final). Folded into the studio; `ArtPanel.tsx` is superseded.
- **Status:** a read-only "Private idea" pill (no interactive/disabled stepper — transitions belong to the lifecycle sub-phase).
- **Mobile-first:** preview and form cannot sit side-by-side on a phone — sticky/collapsible preview on top, form below (or a preview/edit toggle).

---

## 8. Ideas library — `/forge/ideas`

The new Forge home (replaces `/forge/art`).
- Dense `<ForgeCardPreview>` thumbnail grid of the member's cards (all of them, pre-sets).
- Filters: **type / brigade / free-text search**. (Status facet is deferred — trivial while everything is `private_idea`.)
- **Grid query selects only what the grid renders** (name/type/brigade, art-presence, status, updated_at) — never `select('*')` / the full `working_snapshot` jsonb into a list payload.
- Empty state: card-shaped dashed cut-out slot + one sentence + a single "Jot an idea" CTA (napkin). No "create a set" / "send to a set" actions (those flows don't exist yet — omit, don't disable).
- **Migration housekeeping:** `/forge/art` redirects to `/forge/ideas`; the stale `revalidatePath("/forge/art")` calls in `app/forge/lib/cards.ts` move to `/forge/ideas`; legacy 1a.3 cards (title + art, empty `working_snapshot`) render correctly.

---

## 9. Security & guardrails

- **RLS** — the owner-or-superadmin SELECT policy (§3) is the boundary; app-layer `owner_id` filters are convenience, not security.
- **Content never leaks to non-owners.** The studio route legitimately ships the owner's snapshot to that owner's client (unavoidable + fine). The grid trims its projection (§8). Server actions/RPCs never echo snapshot content in error strings (keep 1a.3's generic `"Could not save card"` discipline). All `/forge` routes stay `force-dynamic` (no ISR caching of content).
- **Leak guardrail broadened** (`__tests__/forge-anon-leak.test.ts`): today it only probes the **anon** role, so a member-to-member content leak (exactly the §3 failure mode) passes CI. Add the parent-spec-promised **step 2**: an authenticated **non-owner** (and non-member) session asserting **0 rows** on `forge_cards`. This needs a seeded non-owner test account — the test-infra cost is called out for the plan. Also add the two new-RPC anon-reject probes.
- **Gate-first defense** — `/forge` has no middleware coverage; the layout gate + in-route `requireForge()`/`requireElder()` are the only defense. 1a.4 adds the most routes yet but uses **server actions** (not new `route.ts`), so the layout gate covers the new pages. (Optional hardening, recommended: build the parent-spec-promised gate-first grep CI test — it never shipped — since the route count is crossing the threshold where forgetting becomes likely. Low cost.)
- **Frame assets / fonts in `public/`** carry **no** playtest-secret content; only card data + uploaded art stay behind RLS/the proxy, as already built.

---

## 10. Two-subagent review — resolutions

A security/arch reviewer and a requirements/scope reviewer audited this design. All actionable findings are folded in:

| Finding | Resolution |
|---|---|
| **CRIT** (sec) member-wide SELECT leaks private ideas once content lands | owner-or-superadmin policy + `is_forge_superadmin()` helper in 051 (§3) |
| **CRIT** (req) 051 ignores 050's shipped `title`/no-`set_id`/`forge_create_card` | explicit reconciliation (§3) |
| **HIGH** guardrail only probes anon | add authenticated non-owner/non-member probe (§9) |
| **HIGH** snapshot content in grid/RSC | trim grid projection; studio-only full snapshot (§8/§9) |
| **HIGH** unbounded/loose jsonb write | column-only write + 64 KB cap in `forge_save_card` (§3) |
| **HIGH** gate-first grep CI never built | recommended optional hardening (§9) |
| **HIGH** `class`/`icons` divergence from `CardData` | documented; adapter must re-merge (§4) |
| **HIGH** Site/Fortress brigade applicability wrong | concrete matrix (§4) |
| **HIGH** unsupported combos render behavior unspecified | best-effort + "preview approximate", never block (§5) |
| **MED** `/forge/art` orphans panel + revalidate paths | redirect + path fixes + ArtPanel superseded (§8) |
| **MED** dead status stepper | read-only pill; drop the status RPC (§3/§7) |
| **MED** `GoodMulti`/`EvilMulti` ambiguity | drop as selectable; explicit array (§4) |
| **MED** dual-type applicability | union of selected types (§4) |
| **MED** 107 MB assets | reference frames removed, WebP + lazy-load (§6) |
| **MED** font licensing | proprietary removed, libre substitutes (§6) |
| **LOW** validate() vs napkin promise | advisory only (§4) |
| **LOW** mobile two-pane | collapsible preview (§7) |

---

## 11. Open items / risks

- **Preview fidelity is the long pole.** All assets exist and it's one parameterized frame, so it's achievable — but pixel-tuning geometry + fonts across types is the bulk of the effort. Mitigated by the swappable component + graceful fallback (ship best-effort, sharpen iteratively).
- **Authenticated leak-test infra** — needs a seeded non-owner Supabase test account; scope in the plan.
- **Title-font pick** (Anton vs Archivo Black) — finalized visually against references during the build.
- **Frame IP posture** — public static is the recommendation; revisit only if the owner wants frames locked down (would need a private-blob+proxy path).
