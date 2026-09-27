import { BoardList } from "@/components/board/board-list";

export const dynamic = "force-dynamic";

export default function BoardPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="bd-needs-convex">
        <div>
          <h1>Board braucht Convex</h1>
          <p>Starte das Board mit `npm run dev:board`.</p>
        </div>
      </main>
    );
  }
  return <BoardList />;
}
