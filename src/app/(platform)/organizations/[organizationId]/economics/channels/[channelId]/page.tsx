import { redirect } from "next/navigation";

/**
 * Channel economics merged into Channels on 2026-08-28.
 *
 * A redirect rather than a removal: links and bookmarks point here, and the
 * money this page showed now lives on the merged page under one clock. See
 * `docs/superpowers/specs/2026-08-28-channels-and-economics-merge-design.md`.
 */
export default async function ChannelEconomicsChannelPage({
  params,
}: {
  params: Promise<{ organizationId: string; channelId: string }>;
}) {
  const { organizationId, channelId } = await params;
  redirect(`/organizations/${organizationId}/channels/${channelId}`);
}
