---
name: celebratedeal-design-system
description: Design, implement, or audit CelebrateDeal SaaS and live-commerce interfaces using the repository's brand, typography, colors, spacing, components, accessibility, responsive behavior, and anti-AI-design rules. Use for any UI page, React component, Tailwind styling, design token, UX flow, visual review, or screenshot-based QA in this repository.
---

# CelebrateDeal Design System

## Workflow

1. Read `docs/design/DESIGN_DIRECTION.md`, `DESIGN_TOKENS.md`, and [design-checklist.md](references/design-checklist.md).
2. Identify the page audience, single primary job, density, dominant data type, and mobile workflow.
3. Reuse `src/components/ui.tsx` or extend a shared primitive before creating page-local styles.
4. Define all interactive states before visual polish: default, hover, focus-visible, disabled, loading, empty, error, success, and selected.
5. Verify 390, 768, 1280, and 1440 widths. Verify keyboard, semantic labels, contrast, and reduced motion.
6. Capture screenshots for material UI changes and compare hierarchy, clipping, overlap, and real content density.

## Design direction

- Keep the operations UI neutral, precise, and information-dense.
- Reserve orange/red-orange/gold for conversion, urgency, success, or the single primary action.
- Use restrained radii and shadows. Page sections are not floating cards; cards represent discrete objects or tools.
- Use Traditional Chinese labels with comfortable line height and plain action verbs.
- Use animation to explain state; confetti only follows a real confirmed conversion.

## Output format

For design work, provide:

1. Audience and page job.
2. Reused components/tokens.
3. Interaction and responsive states.
4. Accessibility checks.
5. Screenshot or automated evidence.
6. Remaining design debt.

## Prohibitions

- Do not add purple-blue gradients, glowing blobs, glassmorphism, giant radii, nested cards, emoji icons, or decorative animation without a product reason.
- Do not create multiple competing primary CTAs.
- Do not use desktop shrinkage as the mobile design.
- Do not claim accessibility or responsive completion without verification.

