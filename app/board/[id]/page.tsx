import { notFound } from "next/navigation";
import { BoardEditor } from "@/components/board/editor/board-editor";
import { isBoardId } from "@/lib/board/ids";

export const dynamic = "force-dynamic";

/** Board canvas (PLAN.md phase 2). The deployment ID keys the local journal (point 24). */
export default async function BoardCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const boardId = decodeURIComponent(id);
  if (!isBoardId(boardId)) notFound();
  const env: Record<string, string | undefined> = process.env;
  if (!env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="bd-needs-convex">
        <div>
          <h1>Board braucht Convex</h1>
          <p>Starte das Board mit `npm run dev:board`.</p>
        </div>
      </main>
    );
  }
  return <BoardEditor boardId={boardId} deploymentId={env.CONVEX_DEPLOYMENT ?? env.NEXT_PUBLIC_CONVEX_URL ?? "unbekannt"} />;
}
