# Extractable Components

## AppShell

- Source: `src/components/layout/app-shell.tsx`
- Category: layout
- Description: Authenticated agency shell with shadcn sidebar, header, search action, and notification action.
- Extractable props: `children`
- Hardcoded: agency breadcrumb, navigation copy, shell tokens.

## Sidebar

- Source: `src/components/layout/sidebar.tsx`
- Category: layout
- Description: Organization switcher, workspace navigation, settings, and operator identity.
- Extractable props: active navigation item when routes expand.
- Hardcoded: navigation labels/icons, current workspace placeholder, operator copy.

## OrganizationSwitcher

- Source: `src/components/layout/organization-switcher.tsx`
- Category: layout
- Description: shadcn DropdownMenu trigger for organization context.
- Extractable props: selected organization label and organization list in a later data-backed version.
- Hardcoded: current foundation workspace copy.

## OnboardingSectionCard

- Source: planned from `src/app/(platform)/organizations/new/page.tsx`
- Category: basic
- Description: Card-composed focused editor section with title, description, source state, fields, and actions.
- Extractable props: `title`, `description`, `status`, `children`.
- Hardcoded: semantic tokens and shadcn composition.

## AnimatedOnboardingStepper

- Source: planned `src/components/onboarding/animated-onboarding-stepper.tsx`
- Category: basic
- Description: Framer Motion transition shell for the active section, adapted from the approved Superdesign stepper reference.
- Extractable props: `currentSection`, `sections`, `onSectionChange`, `onNext`, `onBack`, `disableFutureNavigation`.
- Hardcoded: RIS motion timing, step indicator language, reduced-motion behavior.
