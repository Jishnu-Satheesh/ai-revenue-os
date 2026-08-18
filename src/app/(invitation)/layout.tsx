/**
 * The invitation surface runs outside the platform AppShell.
 *
 * A recipient arrives here signed out, belonging to nothing, from a link in a
 * message. There is no organization to scope to and no workspace to navigate, so
 * there is deliberately no sidebar and no organization switcher -- and, unlike
 * `(platform)`, no redirect to sign-in, because being signed out is the expected
 * first state rather than a failure.
 */
export default function InvitationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
