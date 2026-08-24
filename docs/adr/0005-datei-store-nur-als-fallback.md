# ADR-0005: Datei-Store nur als Fallback

Status: akzeptiert, 2026-08-24

## Kontext

Convex braucht einen manuellen Login (SPEC T2.1), der zum Start der Arbeit noch nicht erledigt war. Ohne Persistenz hätte kein Ticket die Akzeptanzkriterien mit echten Daten prüfen können. `lib/adapters/storage/file.ts` schreibt deshalb `data/store.json`.

## Entscheidung

Der Datei-Store bleibt als Fallback, wenn `NEXT_PUBLIC_CONVEX_URL` fehlt (`storageKind() === "file"`). Er ist kein zweites Backend: Neue Features werden gegen das `StorageAdapter`-Interface gebaut und in Convex vollständig umgesetzt. Der Datei-Store bekommt nur, was er für lokale Entwicklung braucht. `scripts/migrate-store-to-convex.mjs` überführt vorhandene Daten einmalig.

## Konsequenzen

- `data/store.json` und `data/covers` sind gitignored; Datenverlust im Datei-Store ist akzeptiert.
- Keine Live-Updates, keine Indizes, keine Nebenläufigkeit im Datei-Store. Cron plus offene UI kann sich überschreiben.
- Akzeptanzkriterien mit "persistiert" gelten erst als erfüllt, wenn sie gegen Convex laufen, siehe [ADR-0001](0001-convex-statt-supabase.md).
