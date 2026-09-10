import { ScriptDetail } from "@/components/script-detail";

/** One route per Script, opened from the Scripts tab. */
export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScriptDetail scriptId={decodeURIComponent(id)} />;
}
