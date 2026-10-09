# WOW Frontend capability

Status: proposed architecture  
Owner: AppFactory Project Automation  
First reference consumer: `Trigenys/trigenys-commerce-factory`

## 1. Goal

Add a reusable AppFactory capability for producing **high-quality marketing and product landing pages** without making each product rediscover design systems, motion libraries, component sources, accessibility rules, performance budgets and visual QA from scratch.

The capability is not a page builder and is not a mandate to migrate products to Webflow, Tailwind, Next.js or any single UI stack.

It should give an agent or developer a repeatable path:

```text
audit current product
  -> choose art direction
  -> search approved sources before inventing components
  -> adapt the smallest useful primitive to the consumer stack
  -> compose the landing story
  -> add intentional motion
  -> verify rendered output
  -> enforce accessibility + performance budgets
  -> record source/provenance
```

The first real validation target is Commerce Factory, which already runs React/Vite on Cloudflare Pages and must **not** be rewritten simply to consume this capability.

## 2. RAIDER contract

The capability must be:

- **Reusable:** one source catalog, one agent workflow and one quality contract can serve multiple products.
- **Agnostic:** do not require React, Tailwind, Next.js, Vercel, Webflow, a specific brand or a fixed animation library.
- **Idempotent:** running discovery/audit repeatedly must not duplicate packages, components, attribution records or generated config.
- **Durable / non-regressive:** consumers that do not enable the capability keep their current behavior; UI adoption is opt-in.
- **Engineering-grade:** explicit contracts, source provenance, license checks, rendered verification, accessibility and performance budgets.
- **Retroactive:** brownfield products can adopt one section or one component at a time without a framework migration.

## 3. What AppFactory should add

### 3.1 A curated source registry

Add a versioned machine-readable registry:

```text
catalog/
  wow-frontend.sources.json
schemas/
  wow-frontend.sources.schema.json
```

Each source entry should describe:

- stable source id;
- repository URL;
- upstream type: `registry`, `copy-paste`, `mcp`, `guidelines`, `reference-only`;
- supported frameworks;
- styling assumptions;
- animation runtime assumptions;
- license state;
- whether code reuse is permitted;
- attribution requirements;
- installation/adoption mode;
- risk level;
- pinned reviewed ref when AppFactory executes or imports source material;
- last review date.

The registry is **allowlist-based**. An agent may still discover other repositories, but it must not automatically execute, install or copy from an unreviewed source.

### 3.2 A reusable agent skill

Add:

```text
skills/
  wow-frontend/
    SKILL.md
    references/
      composition.md
      motion.md
      visual-qa.md
      source-selection.md
```

The skill must enforce this order:

1. Read the consumer's current framework, styling system, tokens and existing landing.
2. Define a concrete art direction before selecting effects.
3. Search the curated source registry before writing a bespoke component.
4. Prefer the smallest compatible primitive; do not install a framework to obtain one component.
5. Adapt the component to the consumer's design tokens and code conventions.
6. Use motion only when it explains hierarchy, state, product behavior or storytelling.
7. Add `prefers-reduced-motion` behavior.
8. Render and inspect desktop + mobile.
9. Run accessibility and performance checks.
10. Record any third-party source actually used.

The skill must explicitly reject generic “AI landing” defaults such as arbitrary gradient blobs, fake social proof, invented client logos, useless counters or motion that does not support the product story.

### 3.3 A consumer contract

Add an opt-in consumer file:

```text
.github/appfactory-frontend.json
```

Proposed v1 shape:

```json
{
  "version": 1,
  "enabled": true,
  "profile": "marketing-wow",
  "stack": {
    "framework": "react-vite",
    "styling": "css",
    "typescript": true
  },
  "sources": {
    "allow": ["magic-ui", "ui-layouts", "tailark", "beui"],
    "allowReferenceOnly": true
  },
  "motion": {
    "mode": "intentional",
    "reducedMotion": "required"
  },
  "quality": {
    "mobileViewport": 390,
    "desktopViewport": 1440,
    "maxLcpMs": 2500,
    "maxCls": 0.1,
    "maxTotalBlockingTimeMs": 200,
    "requireKeyboardPass": true,
    "requireNoHorizontalOverflow": true
  }
}
```

The schema must allow other frameworks/styling systems instead of hard-coding this example.

### 3.4 Source adoption modes

AppFactory should distinguish four adoption modes.

**Reference-only**  
The source is inspected for patterns and ideas, but no code is copied or executed.

**Copy/adapt**  
A reviewed permissively licensed component may be copied into the consumer and adapted. The consumer owns the resulting code.

**Registry install**  
Only when the consumer already satisfies the source's stack contract. Example: a shadcn/Tailwind registry must not silently add Tailwind to a plain-CSS application.

**External design/tool adapter**  
Tools such as Figma, MagicPath or 21st.dev may be used to search/generate concepts, but AppFactory's repository must remain usable without those external services.

### 3.5 Provenance file

When a third-party component is actually adopted, generate/update:

```text
.appfactory/frontend-provenance.json
```

Record:

- source id + upstream URL;
- upstream commit/ref;
- source component/pattern name;
- license identifier and review state;
- files created or materially adapted;
- date;
- whether the code is copied, generated, or reference-derived.

This prevents future maintainers from losing the origin of copied UI code.

### 3.6 Visual verification

Add a reusable verification contract, initially as scripts and later as a reusable workflow:

```text
scripts/wow-frontend/
  validate-config.mjs
  validate-sources.mjs
  verify-render.mjs
```

A v1 verification should check:

- required routes render;
- desktop and mobile screenshots can be captured;
- no horizontal overflow;
- CTA elements are keyboard reachable;
- reduced-motion path is present when motion is used;
- external image hotlinks are flagged for production surfaces;
- missing/broken media is detected;
- obvious console/runtime errors fail the check;
- performance budgets are reported truthfully.

A later reusable workflow can wrap Playwright/Lighthouse or the consumer's existing equivalent. AppFactory must not pretend a text-only source review is visual QA.

### 3.7 Reusable landing primitives

Do **not** begin by publishing a giant component library. First extract only patterns that survive real use.

Candidate reusable primitives:

- `PremiumHero`;
- `BrowserShowcase`;
- `PhoneMockup`;
- `StorefrontGallery`;
- `BeforeAfterStory`;
- `StickyStory`;
- `ScrollReveal`;
- `ProductToWhatsAppTransition`;
- `AnimatedMetric`;
- `LogoCloud` only when logos are real/authorized;
- `ProofStrip` only when claims are evidenced;
- `FinalCTA`.

Each primitive needs accessibility, reduced-motion and responsive behavior before it becomes a shared template.

## 4. Curated GitHub sources

Initial reviewed catalog:

| Source | Intended use | License state | AppFactory policy |
| --- | --- | --- | --- |
| `21st-dev/magic-mcp` | component search / external MCP workflow | ISC | allowed external adapter; never required |
| `magicuidesign/magicui` | animated React/Tailwind patterns | MIT | approved for reviewed copy/adapt or compatible registry use |
| `ui-layouts/uilayouts` | creative React effects and layout patterns | MIT | approved for reviewed copy/adapt |
| `tailark/blocks` | marketing/shadcn blocks | MIT | approved when consumer stack is compatible |
| `starc007/ui-components` | Motion React primitives | MIT | approved for reviewed copy/adapt |
| `vercel-labs/web-interface-guidelines` | interface quality guidance | MIT | approved as guideline source |
| `DavidHDev/react-bits` | broad animated React inspiration | GitHub metadata reports NOASSERTION and no top-level LICENSE was resolved during review | reference-only until license is verified |
| `imskyleen/animate-ui` | animated React/shadcn components | GitHub metadata reports NOASSERTION and no top-level LICENSE was resolved during review | reference-only until license is verified |
| `itsjwill/motion-primitives-website` | GSAP/Three.js/Motion patterns | no repository license reported | reference-only; no code reuse |

License state is a **gate**, not a footnote. “Open source” in a README is not enough for automatic code reuse.

## 5. Selection rules

### React/Vite + plain CSS

Example: Commerce Factory.

- do not add Tailwind merely to install a Tailwind component;
- use compatible source code as reference or extract the interaction logic;
- convert styling to the product's existing CSS/tokens;
- self-host production media;
- keep bundle additions measurable.

### React/Next + Tailwind/shadcn

- registry installation may be used when the upstream source is approved;
- generated files are committed to the consumer, not hidden behind a runtime dependency unless that is the source's intended architecture;
- run the same provenance and quality gates.

### Non-React consumers

- the source catalog may still be used as design/reference material;
- the agent must reimplement the pattern idiomatically for the consumer rather than forcing React into the stack.

## 6. Motion policy

Motion is allowed when it supports one of these jobs:

- reveal information hierarchy;
- explain product flow;
- connect cause and effect;
- demonstrate state change;
- guide attention to a CTA;
- create a deliberate brand moment without blocking comprehension.

Motion should be rejected when it:

- continuously distracts from reading;
- causes layout shift;
- depends on scroll-jacking;
- breaks keyboard navigation;
- has no reduced-motion alternative;
- adds a large runtime for a trivial effect.

For Commerce Factory, the preferred “wow” sequence is functional storytelling:

```text
social/catalog product
  -> storefront card
  -> product selected
  -> WhatsApp CTA
  -> prefilled product context
  -> merchant dashboard signal
```

## 7. Supply-chain and legal boundaries

- never run arbitrary `npx`, install scripts or remote shell commands just because a component README suggests them;
- registry installation requires an allowlisted source and explicit compatible consumer stack;
- pin executable automation to reviewed immutable refs;
- keep copied component code reviewable in the consumer repository;
- do not hotlink third-party product/marketing imagery in production;
- preserve required notices/attribution;
- flag sources with unclear licensing as reference-only;
- do not copy real prospect branding into public templates without permission.

## 8. Quality gates

A “wow” landing is not complete merely because it looks impressive in one screenshot.

Minimum Definition of Done:

- desktop and mobile rendered review;
- no broken media;
- no horizontal overflow;
- keyboard path reaches primary CTA;
- focus states remain visible;
- reduced-motion path;
- responsive typography;
- truthful claims;
- no fake testimonials/logos/metrics;
- performance results within configured budgets or an explicit documented exception;
- source provenance updated;
- consumer tests/typecheck/build remain green.

## 9. Implementation order

### Phase A — contract and governance

1. commit the source registry and schema;
2. add license/provenance rules;
3. add consumer config schema;
4. add source/config validation tests.

### Phase B — agent workflow

5. add `skills/wow-frontend/SKILL.md`;
6. add source-selection, composition, motion and QA references;
7. make “search before build” and “render before done” explicit.

### Phase C — verification

8. add rendered desktop/mobile verification;
9. add accessibility/reduced-motion checks;
10. add performance budgets and reporting.

### Phase D — reference adoption

11. onboard Commerce Factory without changing its framework/styling architecture;
12. rebuild one landing section using the capability;
13. compare visual quality, bundle impact and implementation time;
14. extract only proven reusable primitives.

### Phase E — productization

15. document consumer onboarding;
16. publish examples for a Tailwind consumer and a plain-CSS consumer;
17. version the contract and source registry.

## 10. Non-goals for v1

- replacing Figma;
- replacing a developer or art director with random effects;
- building a universal drag-and-drop page builder;
- forcing Webflow/Framer/Tailwind/Next.js on consumers;
- automatically copying every component from public GitHub;
- automatically publishing third-party branding;
- installing unreviewed packages or executing upstream scripts;
- treating visual beauty as a substitute for conversion evidence.

## 11. Success criteria

The capability is successful when:

1. a brownfield consumer can adopt it without a framework migration;
2. the agent finds and evaluates existing primitives before inventing new ones;
3. source/license/provenance are explicit;
4. rendered mobile/desktop QA happens before completion;
5. performance/accessibility remain first-class;
6. Commerce Factory produces a materially stronger landing with less one-off discovery work;
7. a second unrelated product can reuse the same workflow without Commerce Factory-specific code.
