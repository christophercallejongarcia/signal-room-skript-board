# CONTEXT.md: Projektsprache Signal Room

Glossar für Signal Room (Instagram-Reels-Intelligence für Chris' Nische). Wer an diesem Repo arbeitet, benutzt diese Begriffe in Code, Issues, Tests und UI-Texten. Je Begriff: eine Definition, eine Zeile zu vermiedenen Synonymen. Entscheidungen dahinter stehen in `docs/adr/`.

## Kernobjekte

**Creator**
Ein beobachteter Instagram-Account mit `handle`, `audience` (Follower) und `network`; im Code der Typ `Creator`, beim Auflösen über Apify heißt dasselbe Feld noch `followers` in `ResolvedProfile`.
Nicht: "Channel", "Account", "Profil" (Profil meint nur den Profile-Tab der App).

**Signal**
Ein einzelner Beitrag eines Creators im Korpus, gespeichert als `SignalRecord` mit Plays, Likes, Comments und Caption.
Nicht: "Video", "Item", "Content-Piece".

**Reel**
Ein Signal mit `format: "reel"`, also ein Kurzvideo; Bild-Beiträge haben `format: "post"`.
Nicht: "Clip", "Short" (Short ist reserviert für YouTube).

**Watchlist**
Die Menge aller Creators, die der tägliche Refresh abfragt; "Add to daily watch" nimmt einen Creator auf, die UI zeigt sie im Tab "Tracked Channels".
Nicht: "Tracked Channels" (nur als UI-Label), "Abo", "Feed".

**Owned Creator**
Ein Creator mit `owned: true`, also Chris' eigener Account; wird wie jeder andere gescort, aber im Profile-Tab separat gezeigt.
Nicht: "Eigenes Profil", "Self", "Me".

## Datenfluss

**Backfill**
Der erste Import beim Aufnehmen in die Watchlist: Beiträge der letzten `BACKFILL_DAYS` (90), je Actor-Lauf (Reels, Posts) höchstens `MAX_RESULTS_PER_CREATOR`.
Nicht: "Initial-Sync", "Full-Scrape", "Import".

**Delta-Refresh**
Der Folgelauf über `/api/refresh`, der nur Beiträge neuer als `lastCheckedAt` holt; Zähler älterer Beiträge bleiben unverändert (Aktualisierung ist geplant, Ticket 05).
Nicht: "Delta-Sync", "Update", "Incremental Scrape".

**Run**
Ein protokollierter Durchlauf von Backfill oder Delta-Refresh (Art, Start, Ende, geprüfte Creators, neue Signale, Fehler), Tabelle `runs`; Kosten pro Run sind geplant (SPEC T3.6).
Nicht: "Job", "Execution", "Sync".

**Cover**
Das Vorschaubild eines Signals. Der Connector liefert die signierte CDN-Adresse als `thumbnailUrl`; der Cover-Cache (`lib/adapters/storage/cover-cache.ts`) lädt sie einmal nach `data/covers/<externalId>.jpg`, und die UI rendert nur `coverUrl` (`/api/covers/<externalId>`), sonst den Platzhalter.
Nicht: "Thumbnail" (nur noch als Feldname `thumbnailUrl` für die Quelle), "Preview", "Poster".

## Scoring

**Outlier**
Der Faktor `plays / audience` eines Signals (Fallback: `views`); 5.0 heißt fünfmal so viele Plays wie Follower.
Nicht: "Relative Reach" (Alt-Feld, nur noch aus Kompatibilität befüllt), "Viral-Score", "Performance".

**Channel-Relative**
Der Faktor `plays / median(plays)` über den gehaltenen Korpus desselben Creators; misst, ob ein Signal über der eigenen Baseline liegt.
Nicht: "Baseline-Ratio", "Creator-Relative", "Median-Score".

**Schwelle**
Der Faktor, ab dem ein Signal als Outlier gilt und Badge, Zähler und Outlier-Filter greifen. In Discover wählbar (1.5x, 2x, 3x, 5x), Standard `DEFAULT_OUTLIER_THRESHOLD` = 2 in `lib/discover-filter.ts`, re-exportiert als `OUTLIER_THRESHOLD` in `lib/config.ts`.
Nicht: "Cutoff", "Limit", "Grenzwert".

## Formate und Inhalte

**Format Signal**
Ein wiederkehrendes Muster über mehrere Outlier-Reels (z.B. "Every X", "[Entity]: [Proposition]"), mit Beispielen und Durchschnitts-Outlier.
Nicht: "Pattern", "Trend", "Template".

**Hook**
Die erste Zeile der Caption bzw. die ersten drei Sekunden eines Reels; Hooks werden im Hooks-Board variiert und gegen den Outlier-Korpus geprüft.
Nicht: "Titel" (Titel ist das YouTube-Pendant), "Opener", "Headline".

## Ergänzende Begriffe

**Idea**
Ein gespeicherter Content-Ansatz (Titel, Ziel, Storyboard) in der Tabelle `ideas`; der Strategy-Provider liefert dafür den Entwurf als `StrategyResponse` (angle, rationale, opening, proofToShow, cautions).
Nicht: "Draft", "Konzept".

**Strategy-Provider**
Die Komponente, die aus Evidenz (Top-Outlier-Reels) eine Idea erzeugt; läuft über den lokalen Bridge mit Codex SDK, siehe ADR-0004.
Nicht: "LLM", "KI-Backend", "Agent".

**Bridge**
Der lokale Prozess `bridge/server.mjs`, der Strategy-Anfragen der Web-App entgegennimmt und ans Codex SDK weiterreicht.
Nicht: "Proxy", "Gateway", "API".
