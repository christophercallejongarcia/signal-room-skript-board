# ADR-0001: Convex statt Supabase als Persistenz

Status: akzeptiert, 2026-08-24

## Kontext

Der Starter hielt Daten nur im Speicher. Für Watchlist, Signale, Ideas und Runs braucht Signal Room eine Persistenz, die ein täglicher Cron beschreibt und die UI live liest. Kandidaten waren Supabase (Postgres) und Convex (Dokument-DB mit reaktiven Queries). Die Daten sind dokumentförmig (Signale mit optionalen Feldern je Netzwerk), das Projekt ist TypeScript-first und läuft als Solo-Projekt ohne Ops-Kapazität.

## Entscheidung

Convex ist das Backend. Schema und Functions liegen in `convex/` (`creators`, `signals`, `ideas`, `runs`, Indizes `by_creator`, `by_published`, `by_external_id`). `lib/adapters/storage/index.ts` wählt Convex, sobald `NEXT_PUBLIC_CONVEX_URL` gesetzt ist. Upserts sind idempotent über den Record-`id` (Index `by_external_id` liegt auf `id`; `externalId` ist der rohe Apify-Shortcode).

Gründe: reaktive Queries ohne eigenes Polling, eingebaute Scheduled Functions für den Daily Watch, TypeScript-Schema statt SQL-Migrationen, Free-Tier ohne Auto-Pause (Supabase pausiert inaktive Projekte, was einen Tages-Cron regelmäßig bricht).

## Konsequenzen

- Kein SQL, keine Joins; Aggregationen (Median je Creator) laufen im Anwendungs-Code.
- `npx convex dev` muss einmal manuell mit Login ausgeführt werden (SPEC T2.1).
- Solange Convex nicht verbunden ist, greift der Datei-Store, siehe [ADR-0005](0005-datei-store-nur-als-fallback.md).
- Convex-Code folgt `convex/_generated/ai/guidelines.md`.
