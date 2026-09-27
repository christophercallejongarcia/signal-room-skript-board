export const dynamic = "force-dynamic";

/** Placeholder until Phase 1 builds the board list. The proxy hands out the session here. */
export default function BoardPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="empty-state">
        <h1>Board braucht Convex</h1>
        <p>Starte das Board mit `npm run dev:board`.</p>
      </main>
    );
  }
  return (
    <main className="empty-state">
      <h1>Skript-Board</h1>
    </main>
  );
}
