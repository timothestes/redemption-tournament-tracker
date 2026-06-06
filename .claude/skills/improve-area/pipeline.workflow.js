export const meta = {
  name: 'improve-area-pipeline',
  description: 'Multi-perspective improvement pass for an area of the app — ideate, synthesize, implement, review',
  phases: [
    { title: 'Ideate', detail: '3 agents propose improvements from distinct lenses' },
    { title: 'Synthesize', detail: '1 agent merges + prioritizes into a v2 spec' },
    { title: 'Implement', detail: '1 agent implements the high-priority subset' },
    { title: 'Review', detail: '2 agents verify the changes landed and are sound' },
  ],
}

// ── args (passed by the skill after live inspection) ──────────────────────────
// {
//   area:        string   — short name, e.g. "Spotlight mode"
//   context:     string   — the full context brief (purpose, current behavior,
//                           observed limitations, key files, conventions,
//                           screenshot paths). REQUIRED.
//   screenshots: string[] — absolute paths to inspection screenshots (optional;
//                           usually already referenced inside `context`)
//   lenses:      [{key,prompt}]? — override the 3 default ideation lenses (optional)
//   implement:   boolean  — actually implement (default true). false = stop at spec.
// }
const A = args || {}
const AREA = A.area || 'this area of the app'
const CONTEXT = A.context
if (!CONTEXT) throw new Error('improve-area-pipeline requires args.context (the context brief)')
const DO_IMPLEMENT = A.implement !== false

// ── Phase 1: Ideate (3 parallel lenses) ───────────────────────────────────────
phase('Ideate')

const REC_SCHEMA = {
  type: 'object',
  required: ['lens', 'recommendations'],
  properties: {
    lens: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'problem', 'proposal', 'impact', 'effort'],
        properties: {
          title: { type: 'string' },
          problem: { type: 'string', description: 'the current pain point this addresses' },
          proposal: { type: 'string', description: 'concrete change, referencing files/components' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
        },
      },
    },
  },
}

// Default lenses generalize to any area. Override via args.lenses for a tuned pass.
const DEFAULT_LENSES = [
  {
    key: 'ux-workflow',
    prompt: `You are a senior UX engineer. Evaluate "${AREA}" through the lens of the REAL USER'S ` +
      `TASK FLOW: who uses this, what are they trying to accomplish, and where is the friction? ` +
      `Consider ergonomics, number of steps, discoverability, error recovery, mobile vs desktop, ` +
      `and shareability/handoff. Propose concrete improvements to how the flow WORKS.`,
  },
  {
    key: 'visual-design',
    prompt: `You are a senior visual/UI designer. Evaluate "${AREA}" through the lens of visual ` +
      `layout, hierarchy, legibility, and polish. Consider composition, spacing, typography, ` +
      `states (empty/loading/error), transitions, and fit with the project's design system in ` +
      `both light and dark mode. Propose concrete improvements to how it LOOKS and reads.`,
  },
  {
    key: 'functionality',
    prompt: `You are a product engineer focused on FUNCTIONALITY & ROBUSTNESS. Evaluate "${AREA}" ` +
      `through the lens of missing capabilities and edge cases: persistence, configurability, ` +
      `keyboard/hotkey support, performance, error/empty/edge states, and accessibility. Propose ` +
      `concrete feature additions and hardening — and explicitly call out ideas that would be ` +
      `over-engineering to avoid.`,
  },
]
const LENSES = Array.isArray(A.lenses) && A.lenses.length ? A.lenses : DEFAULT_LENSES

const ideas = await parallel(LENSES.map(l => () =>
  agent(
    `${CONTEXT}\n\n---\n\nYOUR TASK: ${l.prompt}\n\n` +
    `Read any screenshots and the key files referenced above BEFORE forming opinions. ` +
    `Then return 4-7 prioritized, concrete recommendations. Each must name the specific current ` +
    `problem, a concrete proposal (reference real files/components), and honest impact + effort ` +
    `ratings. Do NOT invent APIs — verify what exists by reading the code.`,
    { label: `ideate:${l.key}`, phase: 'Ideate', schema: REC_SCHEMA, agentType: 'Explore' }
  )
))
const ideaBundle = ideas.filter(Boolean)

// ── Phase 2: Synthesize ───────────────────────────────────────────────────────
phase('Synthesize')

const SPEC_SCHEMA = {
  type: 'object',
  required: ['summary', 'mustHave', 'niceToHave', 'deferred'],
  properties: {
    summary: { type: 'string', description: 'the improved-version vision in 2-3 sentences' },
    mustHave: {
      type: 'array',
      description: 'the high-value, reasonable-effort changes to implement NOW',
      items: {
        type: 'object',
        required: ['title', 'rationale', 'changeSketch', 'files'],
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          changeSketch: { type: 'string', description: 'concrete implementation approach' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    niceToHave: { type: 'array', items: { type: 'string' } },
    deferred: { type: 'array', items: { type: 'string' }, description: 'good ideas out of scope this pass (with why)' },
  },
}

const spec = await agent(
  `${CONTEXT}\n\n---\n\nYou are the SYNTHESIZER / tech lead. Three reviewers proposed improvements ` +
  `to "${AREA}" from different lenses. Combined input as JSON:\n\n${JSON.stringify(ideaBundle, null, 2)}\n\n` +
  `Merge and de-duplicate into a single coherent spec. Prioritize ruthlessly: "mustHave" = the ` +
  `HIGH-IMPACT, REASONABLE-EFFORT, LOW-REGRESSION-RISK changes that form a coherent pass and can be ` +
  `implemented SURGICALLY (think ~3-6 focused changes, not a rewrite). Respect the project's ` +
  `simplicity-first and surgical-changes guidelines and design system. Push larger/risky ideas to ` +
  `niceToHave or deferred with a one-line reason. For each mustHave give a concrete changeSketch and ` +
  `the files it touches. Read the actual files if you need to validate feasibility.`,
  { label: 'synthesize:spec', phase: 'Synthesize', schema: SPEC_SCHEMA }
)
log(`Synthesized spec: ${spec.mustHave.length} must-have changes`)

if (!DO_IMPLEMENT) {
  log('implement=false — returning spec only (no code changes).')
  return { spec, ideasOnly: true }
}

// ── Phase 3: Implement ─────────────────────────────────────────────────────────
phase('Implement')

const IMPL_SCHEMA = {
  type: 'object',
  required: ['implemented', 'skipped', 'filesChanged', 'verification', 'notes'],
  properties: {
    implemented: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' }, description: 'items NOT done, with reason' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string', description: 'how you verified it typechecks (command + result)' },
    notes: { type: 'string' },
  },
}

const impl = await agent(
  `${CONTEXT}\n\n---\n\nYou are the IMPLEMENTER. Implement the "mustHave" items from this approved spec:\n\n` +
  `${JSON.stringify(spec, null, 2)}\n\n` +
  `RULES:\n` +
  `- Make REAL edits to the real files using Edit/Write.\n` +
  `- SURGICAL: change only what the spec requires. Match existing code style. No speculative abstractions.\n` +
  `- Follow the project's design system and conventions described in the context above.\n` +
  `- Preserve all existing behavior outside the targeted area; do not cause regressions.\n` +
  `- After editing, verify it typechecks (e.g. \`npx tsc --noEmit\`). Do NOT run a full production build. ` +
  `Report the exact command and its result.\n` +
  `- If an item is risky or infeasible, SKIP it and explain rather than forcing a fragile change.\n` +
  `Return what you implemented, what you skipped (with reasons), files changed, and verification output.`,
  { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA }
)
log(`Implemented ${impl.implemented.length} items across ${impl.filesChanged.length} files`)

// ── Phase 4: Review (2 parallel) ────────────────────────────────────────────────
phase('Review')

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'specItemsLanded', 'issues', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['changes-landed-clean', 'landed-with-issues', 'did-not-land'] },
    specItemsLanded: {
      type: 'array',
      items: {
        type: 'object',
        required: ['item', 'landed'],
        properties: { item: { type: 'string' }, landed: { type: 'boolean' }, evidence: { type: 'string' } },
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'detail'],
        properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] }, detail: { type: 'string' }, file: { type: 'string' } },
      },
    },
    summary: { type: 'string' },
  },
}

const reviewBrief =
  `${CONTEXT}\n\n---\n\nThe implementer was asked to deliver these mustHave items:\n` +
  `${JSON.stringify(spec.mustHave, null, 2)}\n\nThe implementer reported:\n${JSON.stringify(impl, null, 2)}\n\n` +
  `Inspect the ACTUAL working-tree changes. Run \`git diff\` and \`git status\` to see what really changed, ` +
  `read the changed files, and verify the claims against reality.`

const REVIEWERS = [
  {
    key: 'correctness',
    extra: `YOUR FOCUS: CORRECTNESS & "did the changes actually land". For each mustHave item confirm ` +
      `whether it is genuinely present in the diff (cite file:line). Check for regressions, broken wiring, ` +
      `TypeScript errors, and dead/half-wired code. If a claimed change isn't in the diff, mark landed:false. ` +
      `You may run \`npx tsc --noEmit\` to confirm types.`,
  },
  {
    key: 'design-conventions',
    extra: `YOUR FOCUS: DESIGN QUALITY & PROJECT CONVENTIONS. Check the changes honor the design system ` +
      `and conventions stated in the context, use design tokens (no hardcoded colors), work in light and ` +
      `dark mode, and actually improve the area as intended. Flag visual/UX or convention violations, and ` +
      `any unrelated/over-reaching edits (surgical-ness).`,
  },
]

const reviews = await parallel(REVIEWERS.map(r => () =>
  agent(`${reviewBrief}\n\n${r.extra}`, { label: `review:${r.key}`, phase: 'Review', schema: REVIEW_SCHEMA, agentType: 'Explore' })
))

return { spec, implementation: impl, reviews: reviews.filter(Boolean) }
