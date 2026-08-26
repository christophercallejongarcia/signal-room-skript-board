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
Der Folgelauf über `/api/refresh`, der pro Creator das Fenster seit `lastCheckedAt` minus `OVERLAP_DAYS` (1) holt (`lib/refresh-window.ts`); bekannte Signale bekommen frische Plays/Likes/Kommentare, Felder ohne neuen Wert (z. B. `coverUrl`) bleiben. `lastCheckedAt` rückt nur vor, wenn beide Actor-Streams erfolgreich waren und das Speichern durch ist.
Nicht: "Delta-Sync", "Update", "Incremental Scrape".

**Run**
Ein protokollierter Durchlauf von Backfill (`lib/collect.ts` `runBackfill`, aus `POST /api/creators`) oder Delta-Refresh (`runRefresh`): Art, Status (`ok`/`partial`/`failed`), Start, Ende, Dauer, geprüfte Creators, neue und aktualisierte Signale, Fehler pro Creator. Tabelle `runs` (Convex) bzw. `runs` in `data/store.json`; `GET /api/runs` liefert die letzten zehn für den Profile-Tab. Kosten pro Run sind geplant (SPEC T3.6).
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
Ein wiederkehrendes Hook-Muster über mehrere Outlier-Reels (z.B. "Die besten X", "Nie wieder X"), erkannt regelbasiert aus der ersten Caption-Zeile. Die Musterliste steht in `lib/format-signals.ts` als `FORMAT_PATTERNS` und ist durch einen weiteren Eintrag erweiterbar; `buildFormatSignals` liefert je Muster Anzahl, Durchschnitts-Outlier, Anteil an allen Outliern, bis zu `FORMAT_EXAMPLE_LIMIT` (3) Beispiel-Reels und die Wochenlinie über `FORMAT_WINDOW_DAYS` (90). Reels ohne erkanntes Muster stehen als "Unclassified" am Ende, mit ihrem Anteil.
Nicht: "Pattern", "Trend", "Template".

**Format-Review**
Der monatliche Diff der Format Signals: `buildFormatReview` (`lib/format-review.ts`) rechnet die Muster der letzten `FORMAT_WINDOW_DAYS` (90) neu und stellt sie dem Review des Vormonats gegenüber. Je Muster Bewegung (`new`, `up`, `down`, `flat`, `gone`), Anteil, Anzahl und Durchschnitts-Outlier, jeweils mit Delta; dazu die kleinen Creators unter `FORMAT_REVIEW_SMALL_AUDIENCE` (50k), deren Outlier-Reel ein benanntes Muster trägt. Geschrieben vom Convex-Cron am 1. jedes Monats (`convex/crons.ts`) in die Tabelle `formatReviews`, gelesen über `GET /api/format-reviews`, angezeigt im Format-Signals-Tab als "What changed".
Nicht: "Report", "Monatsbericht", "Audit".

**Nische-fremder Creator**
Ein Creator mit `foreign: true`, also aus einer anderen Nische; wird normal beobachtet, aber seine Format Signals erscheinen im eigenen Block "Foreign niche", damit importierte Muster die eigenen Kennzahlen nicht verwässern. Umgeschaltet über den Globus-Knopf in Tracked Channels, gespeichert über `PATCH /api/creators`.
Nicht: "Fremdnische", "External", "Competitor".

**Hook**
Die erste Zeile der Caption bzw. die ersten drei Sekunden eines Reels; Hooks werden im Hooks-Board variiert und gegen den Outlier-Korpus geprüft.
Nicht: "Titel" (Titel ist das YouTube-Pendant), "Opener", "Headline".

## Ergänzende Begriffe

**Idea**
Ein gespeicherter Content-Ansatz in der Tabelle `ideas`: Arbeitstitel, optionales Ziel, optionales Quell-Signal (`sourceSignalId`, `sourceCreator`), Status und Storyboard. Der Status ist `captured`, `developed`, `produced` oder `dropped`; die erlaubten Übergänge stehen in `lib/ideas.ts`. Capture geht aus dem Ideas-Formular und aus einer Karte in Discover oder Briefing. Der Strategy-Provider liefert daneben den Angle-Entwurf als `StrategyResponse` (angle, rationale, opening, proofToShow, cautions).
Nicht: "Draft", "Konzept".

**Storyboard**
Der Short-Form-Plan an einer Idea: `hook` (erste drei Sekunden), genau drei `beats` mit Label und Detail, `cta`, `caption` (Zeilenumbrüche bleiben erhalten) und `takeaway`. Entsteht im Develop-Lauf über `POST /api/ideas/develop`, der Bridge antwortet auf `/v1/storyboard` gegen `storyboardOutputSchema`. Ein Develop-Lauf hält die Idea über `developRunId`; startet ein zweiter Lauf, wird das Ergebnis des ersten verworfen.
Nicht: "Skript", "Outline", "Shotlist".

**Strategy-Provider**
Die Komponente, die aus einem Evidenzpaket eine Idea erzeugt; läuft über den lokalen Bridge mit Codex SDK, siehe ADR-0004. Antwortet auf Deutsch.
Nicht: "LLM", "KI-Backend", "Agent".

**Evidenzpaket**
Die Eingabe des Strategy-Providers: die stärksten Outlier-Reels des Fensters aus dem gespeicherten Korpus (`lib/strategy-evidence.ts`), je Eintrag Titel, Creator-Handle, Caption-Auszug, Plays und Outlier. Fenster und Anzahl stehen in `lib/config.ts` (`STRATEGY_EVIDENCE_WINDOW_DAYS` 30, `STRATEGY_EVIDENCE_LIMIT` 10), die Schwelle ist `OUTLIER_THRESHOLD`. Demo-Fixtures kommen nie hinein.
Nicht: "Kontext", "Prompt-Daten", "Sample".

**Bridge**
Der lokale Prozess `bridge/server.mjs`, der Strategy-Anfragen der Web-App entgegennimmt und ans Codex SDK weiterreicht.
Nicht: "Proxy", "Gateway", "API".
