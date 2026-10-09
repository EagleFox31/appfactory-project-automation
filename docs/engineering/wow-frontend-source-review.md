# WOW Frontend source review

Date: 2026-10-09  
Purpose: initial source allowlist for the proposed AppFactory WOW Frontend capability.

This is a **source review**, not permission to bulk-copy or auto-install every project below. Executable/installable integrations remain subject to the consumer stack, immutable ref review, license/provenance policy and normal code review.

## Approved for reviewed use

### 21st.dev Magic MCP

- Repository: https://github.com/21st-dev/magic-mcp
- GitHub license metadata: ISC
- Role: external component search/generation adapter for React/Tailwind ecosystems.
- AppFactory mode: external adapter, optional.
- Constraint: do not make AppFactory depend on the hosted service; do not execute/install components blindly.

### Magic UI

- Repository: https://github.com/magicuidesign/magicui
- GitHub license metadata: MIT
- Role: animated React/Tailwind UI patterns.
- AppFactory mode: copy/adapt or compatible registry use.
- Constraint: Tailwind/shadcn assumptions must not trigger a framework migration in a plain-CSS consumer.

### UI Layouts

- Repository: https://github.com/ui-layouts/uilayouts
- GitHub license metadata: MIT
- Role: creative effects, layout and interaction references.
- AppFactory mode: reviewed copy/adapt.
- Constraint: effects that depend on heavier animation/3D runtimes require bundle/performance review.

### Tailark Blocks

- Repository: https://github.com/tailark/blocks
- GitHub license metadata: MIT
- Role: marketing/shadcn blocks.
- AppFactory mode: compatible registry/copy-adapt.
- Constraint: use only when the consumer already has a compatible stack or when a manual adaptation is clearly cheaper than framework installation.

### beUI / UI Components

- Repository: https://github.com/starc007/ui-components
- GitHub license metadata: MIT
- Role: Motion-based React primitives.
- AppFactory mode: reviewed copy/adapt.
- Constraint: align animation runtime with the consumer instead of adding duplicate motion libraries.

### Web Interface Guidelines

- Repository: https://github.com/vercel-labs/web-interface-guidelines
- GitHub license metadata: MIT
- Role: interaction/accessibility/interface quality guidelines.
- AppFactory mode: guideline/reference source.
- Constraint: guidelines inform QA; they are not a replacement for rendered testing.

## Reference-only pending license review

### React Bits

- Repository: https://github.com/DavidHDev/react-bits
- GitHub license metadata observed during review: NOASSERTION.
- A top-level `LICENSE` path was not resolved through the connected GitHub API during this review.
- Role: broad animated React inspiration.
- Policy: reference-only until license terms are verified from an authoritative upstream path.

### Animate UI

- Repository: https://github.com/imskyleen/animate-ui
- GitHub license metadata observed during review: NOASSERTION.
- A top-level `LICENSE` path was not resolved through the connected GitHub API during this review.
- Role: animated React/shadcn inspiration.
- Policy: reference-only until license terms are verified.

### Motion Primitives Website

- Repository: https://github.com/itsjwill/motion-primitives-website
- GitHub repository metadata reported no license.
- Role: GSAP / Motion / Three.js interaction inspiration.
- Policy: reference-only; no code copying or automated installation without an explicit license review.

## Review rule

A source can move from reference-only to approved only when:

1. authoritative upstream license terms are identified;
2. the integration mode is compatible with those terms;
3. install/build behavior is understood;
4. AppFactory records an immutable reviewed ref for executable automation;
5. provenance/attribution requirements are documented.
