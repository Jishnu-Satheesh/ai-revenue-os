# Page Dependency Trees

## `/overview` — agency operator cockpit

- `src/app/(platform)/overview/page.tsx`
  - `src/components/ui/button.tsx`
  - `src/components/ui/card.tsx`
  - `src/components/ui/empty.tsx`
  - `src/components/ui/status-badge.tsx`
    - `src/components/ui/badge.tsx`
  - `src/app/(platform)/layout.tsx`
    - `src/components/layout/app-shell.tsx`
      - `src/components/layout/sidebar.tsx`
      - `src/components/layout/organization-switcher.tsx`
      - `src/components/ui/sidebar.tsx`
      - `src/components/ui/dropdown-menu.tsx`

## `/organizations/new` — current onboarding foundation

- `src/app/(platform)/organizations/new/page.tsx`
  - `src/components/ui/alert.tsx`
  - `src/components/ui/button.tsx`
  - `src/components/ui/card.tsx`
  - `src/components/ui/checkbox.tsx`
  - `src/components/ui/field.tsx`
  - `src/components/ui/input.tsx`
  - `src/components/ui/progress.tsx`
  - `src/components/ui/select.tsx`
  - `src/app/(platform)/layout.tsx`

## `/organizations/[organizationId]/digital-twin` — representative detail workspace

- `src/app/(platform)/organizations/[organizationId]/digital-twin/page.tsx`
  - `src/components/organizations/digital-twin-editor.tsx`
    - `src/components/ui/alert.tsx`
    - `src/components/ui/alert-dialog.tsx`
    - `src/components/ui/button.tsx`
    - `src/components/ui/card.tsx`
    - `src/components/ui/field.tsx`
    - `src/components/ui/input.tsx`
    - `src/components/ui/select.tsx`
    - `src/components/ui/textarea.tsx`
    - `src/components/ui/status-badge.tsx`
  - `src/components/ui/card.tsx`
  - `src/components/ui/empty.tsx`
  - `src/components/ui/progress.tsx`
  - `src/components/ui/status-badge.tsx`

The ten-section onboarding will reuse this shell and form primitive set.
