# Signal Room für Instagram. Spec und Ticket-Plan

Stand: 2026-08-24. Ziel: Aus dem Starter eine persönliche Content-Intelligence-App für Instagram-Reels in Chris' Nische (Referenzen: @sebastiankauffmann, @denizdeke). Vorbild: Marks private Signal Room (Video "My Content Surveillance System", Frames in der Vault-Note).

Begriffe (Creator, Signal, Reel, Watchlist, Backfill, Delta-Refresh, Run, Outlier, Channel-Relative, Schwelle, Owned Creator, Format Signal, Hook) sind in `CONTEXT.md` definiert. Gefallene Entscheidungen stehen in `docs/adr/` (Index: `docs/adr/README.md`). Bei Widerspruch zwischen Spec und ADR gilt das ADR.

Jeder Ticket-Block hat Ziel, Scope, Akzeptanzkriterien und Abhängigkeiten. Reihenfolge = empfohlene Abarbeitung. Tickets mit `[done]` sind im Repo umgesetzt.

---

## Epic 1. Design: Dark Intelligence Desk

Referenz-Frames: `frames/frames/cue_0000.jpg` (Discover), `cue_0006.jpg` (Tracked Channels), `cue_0013.jpg` (Title board), `cue_0004.jpg` (Trend Radar Tabelle).

Design-Tokens (aus den Frames abgeleitet):
- Page `#0b0d0c`, Surface `#121513`, Surface-Strong `#181c19`, Line `#232825`
- Ink `#f2f4f1`, Muted `#8a948d`
- Accent Lime `#b9ff5c`, Accent-Soft `rgba(185,255,92,0.14)`, Accent-Deep `#8fd93a`
- Headline: fett, 54-64px, `letter-spacing -0.03em`. Kicker darüber in Lime, 11px, uppercase-frei ("Tracked AI channels / updated daily")
- Topbar: Logo-Icon (Pulse) + "Signal Room" / "Intelligence desk", 9 Tabs mit Icon, aktiver Tab als dunkle Pill mit Lime-Text
- Stat-Blöcke: Zahl 28px mono, Label 11px muted, durch Linien getrennt
- Filter-Leiste: segmentierte Kacheln (View / Published / Channel / Sort by / Videos per page / Matches)
- Karten: 1px Line, Radius 12px, Thumbnail 16:9 (YouTube) oder 4:5 (Reels), Badge "NEW" in Lime, Badge "SHORT FORM"
- Tabellen: Header 11px uppercase muted, Outlier-Spalte in Lime, Zeilen-Divider

### T1.1 Token-System und Grundflächen umstellen `[done]`
- `app/globals.css`: `:root` auf Dark-Tokens, Body-Font auf Inter (Google Fonts) mit System-Fallback, Mono für Zahlen.
- AK: Alle Views rendern ohne helle Restflächen. Kontrast Ink/Page ≥ 12:1.

### T1.2 Topbar und Navigation `[done]`
- Logo links (Pulse-Icon + zwei Zeilen), Tabs zentriert, aktiver Tab = Pill `--surface-strong` + Lime-Text + Icon.
- AK: Sieht aus wie `cue_0000.jpg` oben.

### T1.3 Discover-Hero mit Stat-Blöcken und Filter-Leiste `[done]`
- Kicker + Headline + Subline links, drei Stat-Blöcke rechts (known videos, new in 48h, 2x+ outliers).
- Filter-Leiste als segmentierte Kacheln, View-Toggle All/Outliers/Saved.
- Netzwerk-Toggle YouTube / IG oberhalb (Pill-Gruppe).
- AK: Layout wie `cue_0000.jpg`.

### T1.4 Signal-Karten mit echtem Thumbnail `[done]`
- Karte zeigt das Cover aus dem lokalen Cover-Cache (`coverUrl`, Ticket 02) wenn vorhanden, sonst generative Artwork. Die CDN-`thumbnailUrl` wird nie direkt gerendert, weil Instagram-Links nach Tagen ablaufen.
- Reels im 4:5-Format, Badge NEW (< 48h) und Outlier-Faktor (z.B. "5.2x") oben links in Lime.
- AK: Grid 3-4 Spalten, Hover hebt Karte leicht an.

### T1.5 Tabellen-Views (Tracked Channels, Creator-Detail, Profile) `[done]`
- Tabelle mit Spalten Creator / Status / Corpus / Latest video / Controls.
- AK: Wie `cue_0006.jpg` und `cue_0008.jpg`.

### T1.6 Formular-Panels (Ideas, Titles, Thumbnail Lab)
- Dunkle Panels mit Lime-Border-Glow beim aktiven Panel, Primary-Button Lime mit dunklem Text.
- AK: Wie `cue_0013.jpg`.

---

## Epic 2. Persistenz: Convex

Entscheidung: Convex statt Supabase (Live-Updates, agentenfreundlich, Free-Tier ohne Auto-Pause), siehe ADR-0001 und ADR-0005. Bis Convex verbunden ist, arbeitet ein Datei-Adapter (`data/store.json`), damit die App heute schon Daten hält.

### T2.1 Convex-Projekt anlegen (manuell, Chris)
- `npx convex dev` im Repo ausführen, mit GitHub einloggen, Projekt "signal-room" erstellen.
- Schreibt `NEXT_PUBLIC_CONVEX_URL` und `CONVEX_DEPLOYMENT` in `.env.local`.
- AK: `npx convex dev` läuft ohne Fehler, Dashboard zeigt Tabellen.

### T2.2 Schema und Functions `[done, wartet auf T2.1]`
- `convex/schema.ts`: Tabellen `creators`, `signals`, `ideas`, `runs` mit Indizes (`by_creator`, `by_published`, `by_external_id`).
- `convex/creators.ts`, `convex/signals.ts`: list / upsert / bulkUpsert (idempotent über `externalId`).
- AK: Doppelter Import erzeugt keine Duplikate.

### T2.3 StorageAdapter mit Convex-Backend `[done, wartet auf T2.1]`
- `lib/adapters/storage/convex.ts` implementiert `StorageAdapter`.
- `lib/adapters/storage/index.ts` wählt Convex wenn `NEXT_PUBLIC_CONVEX_URL` gesetzt, sonst Datei-Adapter.
- AK: UI liest und schreibt ohne Code-Änderung gegen beide Backends.

### T2.4 Datei-Adapter als Fallback `[done]`
- `lib/adapters/storage/file.ts`, `data/store.json` (gitignored).
- AK: Server-Neustart behält Creators und Signals.

---

## Epic 3. Datenquelle: Apify Instagram

Entscheidung: ADR-0002 (Reels+Posts-Merge).

### T3.1 Apify-Client und Env `[done]`
- `APIFY_TOKEN` in `.env.local` (serverseitig, nie im Client).
- `lib/adapters/sources/apify-client.ts`: run-sync-get-dataset-items Wrapper mit Timeout.
- AK: `curl localhost:3000/api/health` zeigt `apify: configured`.

### T3.2 Instagram-Profil auflösen `[done]`
- Actor `apify/instagram-profile-scraper` für `followersCount`, `fullName`, `profilePicUrl`.
- AK: `@sebastiankauffmann` liefert Follower > 0.

### T3.3 Reels-Backfill 90 Tage `[done]`
- Actor `apify/instagram-scraper`, `resultsType: posts`, `onlyPostsNewerThan: 90 days`, `resultsLimit: 150`.
- Mapping auf `SignalRecord` mit `plays` (videoPlayCount), `views`, `likes`, `comments`, `thumbnailUrl`, `url`, `caption`, `durationSeconds`, `format: reel|post`.
- AK: Nach "Add to daily watch" erscheinen die Reels der letzten 90 Tage in Discover.

### T3.4 API-Route `/api/creators` (POST) `[done]`
- Body `{ handle, network }`. Ablauf: Profil auflösen, Backfill, Storage upsert, Antwort mit Zähler.
- Idempotent: gleicher Handle erzeugt keinen zweiten Creator.
- AK: Zweiter POST für denselben Handle antwortet `existing: true`.

### T3.5 Delta-Refresh `/api/refresh` (POST)
- Für alle Creators nur Posts neuer als `lastCheckedAt` minus einen Tag Überlappung holen (`onlyPostsNewerThan`).
- Aktualisiert bestehende Records (Plays/Likes/Comments ändern sich), keine Duplikate.
- Jeder Lauf landet als `Run` in `runs` (Status, Dauer, Creators, neu/aktualisiert, Fehler pro Creator); Profile-Tab zeigt die letzten zehn.
- Ein fehlschlagender Creator bricht den Lauf nicht ab, behält aber seinen Cursor.
- AK: Zweiter Lauf am selben Tag kostet < 10 % des Backfills (Apify-Compute).

### T3.6 Kosten-Guard
- Maximal N Creators pro Refresh, Log der Apify-Compute-Units pro Run in `runs`.
- AK: Profile-Tab zeigt letzte Runs mit Kosten.

---

## Epic 4. Scoring: Outlier

Definition: ADR-0003.

### T4.1 Outlier-Score `[done]`
- `lib/adapters/scoring/outlier.ts`: `outlier = plays / followers` (Fallback views). Zusätzlich `channelRelative = plays / median(plays der letzten 30 Posts des Creators)`.
- Schwellen konfigurierbar in `lib/config.ts` (`OUTLIER_THRESHOLD = 2`).
- AK: Reel mit 5x Followern zeigt "5.0x", Badge ab 2x.

### T4.2 Discover-Filter "Outliers"
- View-Toggle filtert auf `outlier >= threshold`, Stat-Block zählt "2x+ outliers".
- AK: Zahl im Stat-Block == Anzahl Karten im Outlier-View.

### T4.3 Creator-Detail `[done]`
- Klick auf Creator öffnet Seite mit Stat-Leiste (Views in corpus, Average outlier, Strongest outlier, Videos retained) und Tabelle aller Reels.
- AK: Wie `cue_0008.jpg`.

### T4.4 Format Signals aus Captions — erledigt
- Hook-Muster der Outlier-Reels (erste Zeile der Caption). Regelbasiert über `FORMAT_PATTERNS` in `lib/format-signals.ts`, erweiterbar durch einen Listeneintrag; Modell später.
- Je Muster: Anzahl Reels, Durchschnitts-Outlier, Anteil an allen Outliern, drei Beispiel-Reels mit Cover, Wochenlinie. Sortiert nach Durchschnitts-Outlier, "Unclassified" mit Anteil am Ende.
- Nische-fremde Creators (`foreign: true`, umschaltbar in Tracked Channels über `PATCH /api/creators`) bilden einen eigenen Block.
- AK: Mindestens 8 Muster mit Beispiel-Reels und Durchschnitts-Outlier, je Muster ein positives und ein negatives Caption-Beispiel im Test (`tests/format-signals.test.mjs`).

---

## Epic 5. KI-Schicht

### T5.1 Strategy-Provider (Codex SDK, siehe ADR-0004; ursprünglich Claude Agent SDK geplant)
- Bridge bleibt lokal (`bridge/server.mjs`) und ruft das Codex SDK auf (ADR-0004). Der ursprünglich geplante Claude-Pfad entfällt.
- Evidence = Top-Outlier-Reels (Caption, Plays, Outlier) statt Demo-Daten.
- AK: "Generate angle" liefert JSON mit angle/rationale/opening/proofToShow/cautions aus echten Reels.

### T5.2 Ideas: Capture + Develop
- Idea speichern (Storage), "Develop idea" erzeugt Short-Form-Storyboard (Hook, 3 Beats, CTA, Caption-Vorschlag).
- AK: Storyboard wird in `ideas` persistiert und in der Liste angezeigt.

### T5.3 Titles → Hooks-Board
- Für Instagram: Transkript/Idee rein, N Hook-Varianten (erste 3 Sekunden) gruppiert nach Hypothese, gegen Outlier-Korpus geprüft.
- AK: 10 Hooks pro Run, History gespeichert.

### T5.4 Thumbnail Lab → Cover-Lab
- Cover-Prompt-Template (4:5), Faceless/Face-Toggle, Generierung über Codex (GPT Image) oder Gemini Image. Provider-Switch.
- AK: 3 Packages pro Idee, gerenderte Bilder lokal unter `data/covers/`.

---

## Epic 6. Automatisierung

### T6.1 Daily Watch Cron
- launchd (lokal) oder Vercel Cron ruft `/api/refresh` täglich 10:00. Ergebnis in `runs`.
- AK: Profile-Tab zeigt "Next refresh" und letzten Lauf.

### T6.2 Briefing-Generierung
- Täglich nach Refresh: Top-10-Signale der letzten 24h, je mit "Chris angle" (Claude). Persistiert als Briefing-Dokument.
- AK: Briefing-Tab zeigt Datum, Anzahl Quellen, gerankte Liste.

### T6.3 Trend Radar (später)
- Quellen: Instagram-Hashtag-Suche via Apify, optional GitHub Trending. Opportunity-Score = Momentum × Coverage-Gap.
- AK: Mindestens eine Quelle liefert täglich Topics.

### T6.4 Monatlicher Self-Review — erledigt
- Convex-Cron am 1. jedes Monats 03:00 UTC (`convex/crons.ts` → `internal.formatReviews.generate`): Format-Muster der letzten 90 Tage neu berechnen und gegen das Review davor diffen. Ein Dokument je Lauftag in der Tabelle `formatReviews`.
- Je Muster Bewegung (`new`/`up`/`down`/`flat`/`gone`) über den Anteil am Outlier-Korpus, dazu Deltas für Anzahl und Durchschnitts-Outlier. Verschwundene Muster bleiben mit 0 in der Liste.
- Dazu die kleinen Creators (< 50k Follower) mit Outlier-Reel auf einem benannten Muster, neue Muster zuerst.
- Format-Signals-Tab zeigt den letzten Review als "What changed" (`GET /api/format-reviews`); `POST` auf dieselbe Route rechnet ihn sofort neu, der einzige Weg im Datei-Store (ADR-0005).
- AK: Diff-Berechnung gegen zwei Fixture-Zustände getestet (`tests/format-review.test.mjs`).

---

## Epic 7. Profile: eigener Account

### T7.1 Eigene Reels tracken — erledigt
- Eigener Handle als Creator mit Flag `owned: true`, Outlier-Faktor pro eigenem Reel. Setzbar beim Hinzufügen (Checkbox im Add-Dialog, `POST /api/creators`) und in Tracked Channels (Personen-Knopf, `PATCH /api/creators`).
- Owned Creators sind aus Discover, Briefing, Trend Radar, Format Signals, Format-Review und dem Evidenzpaket ausgeschlossen; das Prädikat steht als `isOwned`/`withoutOwned` in `lib/discover-filter.ts`.
- AK: Profile-Tab zeigt eigene Reels sortiert nach Outlier, dazu je Lane Follower, Ø Plays und bester Outlier.
- AK: Ausschluss getestet (`tests/owned-creators.test.mjs`).

---

## Reihenfolge für die Abarbeitung

1. E1 (Design) und E3.1-3.4 (Backfill) parallel → App zeigt echte Reels dunkel gestylt
2. E4.1-4.3 (Outlier) → Discover wird nützlich
3. E2.1 (Convex anlegen), dann Adapter umschalten
4. E3.5, E6.1 (Delta + Cron) → läuft von allein
5. E5.1-5.2 (Ideen) → der eigentliche Nutzen für Reel-Produktion
6. Rest nach Bedarf

## Offene Entscheidungen

- Codex vs. Claude für Text: entschieden in ADR-0004, Codex SDK für Text und Bilder über den lokalen Bridge.
- Apify-Actor-Wahl: `apify/instagram-scraper` (offiziell, stabil). Bei Rate-Limits Wechsel auf `apify/instagram-reel-scraper`.
- Follower-Quelle: Profil-Scraper einmal beim Add, dann wöchentlich aktualisieren.
