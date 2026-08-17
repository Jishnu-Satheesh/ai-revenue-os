/**
 * The Telegram Mini App runs outside the platform AppShell.
 *
 * It is an operator control surface, not a customer surface and not a
 * compressed desktop editor. It deliberately has no sidebar, no organization
 * switcher, and no navigation: an operator arrives here from one notification
 * about one campaign version.
 */
export default function TelegramLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
