import { CreatorDetail } from "@/components/creator-detail";

/** One route per tracked creator, opened from Tracked Channels and from the Discover cards. */
export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CreatorDetail creatorId={decodeURIComponent(id)} />;
}
