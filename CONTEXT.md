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

**Creator-Detailseite**
Die eigene Route `/creator/<creator.id>` (`app/creator/[id]/page.tsx`, gerendert von `components/creator-detail.tsx`), erreichbar über den Creator-Namen in Tracked Channels und den Handle auf einer Discover-Karte; den Link baut `creatorPath` in `lib/creator-detail.ts`. Zeigt die Stat-Leiste (Views im Korpus, Durchschnitts-Outlier, stärkster Outlier, behaltene Reels aus `creatorStats`) und die nach Datum, Plays oder Outlier sortierbare Tabelle aller behaltenen Reels (`sortCreatorReels`). Der Zurück-Link führt auf `/?tab=channels`; die Shell liest den `tab`-Parameter beim Mount.
Nicht: "Creator-Profil" (Profil meint den Profile-Tab), "Channel-Seite".

**Gemerktes Signal**
Ein Signal mit `savedAt`, das Chris beim Durchsehen zum Wiederfinden markiert hat. Gesetzt und gelöscht über den Bookmark-Knopf auf einer Discover-Karte (`PATCH /api/signals`, Body geparst von `parseSignalMark` in `lib/signal-mark.ts`, gespeichert über `StorageAdapter.markSignal`, in Convex die Mutation `signals.mark`). Das Prädikat `isSaved` steht in `lib/discover-filter.ts`; der View-Toggle "Saved" zeigt über `filterDiscover` genau diese Signale, die übrigen Filter (Netzwerk, Zeitfenster, Channel, Sortierung) wirken darin weiter, die Schwelle nicht. Stat-Block und Filter-Zähler lesen dasselbe Prädikat (`countSaved`). Ein Delta-Refresh fasst `savedAt` nie an, weil beide Stores nur gelieferte Felder überschreiben. Bei Demo-Fixtures lebt die Markierung nur im Tab.
Nicht: "Favorit", "Bookmark" (nur als Icon), "Watch later".

**Owned Creator**
Ein Creator mit `owned: true`, also Chris' eigener Account; wird wie jeder andere gesammelt und gescort, erscheint aber nur im Profile-Tab. Das Prädikat dafür steht in `lib/discover-filter.ts`: `isOwned` liest die Markierung, `withoutOwned` siebt eine Signalliste damit. Discover, Briefing, Trend Radar und das Evidenzpaket filtern über `withoutOwned`, Format Signals und Format-Review prüfen `isOwned` je Reel in ihrer eigenen Schleife. Gesetzt beim Hinzufügen über die Checkbox im Add-Dialog oder später über den Personen-Knopf in Tracked Channels (`PATCH /api/creators`, Body geparst von `parseCreatorMark` in `lib/creator-mark.ts`).
Nicht: "Eigenes Profil", "Self", "Me".

## Datenfluss

**Backfill**
Der erste Import beim Aufnehmen in die Watchlist: Beiträge der letzten `BACKFILL_DAYS` (90), je Actor-Lauf (Reels, Posts) höchstens `MAX_RESULTS_PER_CREATOR`.
Nicht: "Initial-Sync", "Full-Scrape", "Import".

**Daily Sweep**
Der Delta-Refresh ohne Knopfdruck: Convex-Cron in `convex/crons.ts`, täglich 10:00 Europe/Berlin. Weil Convex-Crons nur UTC kennen, sind zwei Jobs registriert (08:00 und 09:00 UTC, `refreshCronSlots` in `lib/refresh-schedule.ts`); die Action `internal.refresh.run` (`convex/refresh.ts`) prüft mit `isRefreshHour`, ob gerade 10:00 Berlin ist, und nur der passende Slot arbeitet. Sie fährt denselben `runRefresh` wie `POST /api/refresh` über einen Storage aus `ctx.runQuery`/`ctx.runMutation` und schreibt denselben Run in `runs`, dazu das Briefing des Tages ohne Angles. Apify-Token liegt als Convex-Env (`APIFY_TOKEN`), ebenso wirken `REFRESH_CREATOR_LIMIT`, `TRANSCRIPT_LIMIT_PER_RUN` und `APIFY_USD_PER_COMPUTE_UNIT` dort. In der Cloud werden keine Cover gecacht (kein Datenträger); der nächste lokale Refresh holt sie nach. Tracked Channels zeigt in "Next refresh" den nächsten Zeitpunkt (`nextRefreshAt`) und den letzten geloggten Run. Testlauf: `npx convex run refresh:run '{"force":true,"creatorLimit":1,"transcriptLimit":0}'`.

**Delta-Refresh**
Der Folgelauf über `/api/refresh`, der pro Creator das Fenster seit `lastCheckedAt` minus `OVERLAP_DAYS` (1) holt (`lib/refresh-window.ts`); bekannte Signale bekommen frische Plays/Likes/Kommentare, Felder ohne neuen Wert (z. B. `coverUrl`) bleiben. `lastCheckedAt` rückt nur vor, wenn beide Actor-Streams erfolgreich waren und das Speichern durch ist.
Nicht: "Delta-Sync", "Update", "Incremental Scrape".

**Hashtag-Sweep**
Der tägliche, eigene Run-Typ für die konfigurierte Instagram-Hashtag-Liste. `collectHashtagPosts` zieht ausschließlich `resultsType: "posts"` über den Apify-Instagram-Scraper, filtert deutsche Captions, ordnet per Schlüsselwörtern ein Thema zu und schreibt deduplizierte `HashtagPost`-Zeilen. `runHashtagSweep` speichert nur innerhalb von `INSTAGRAM_HASHTAG_COST_LIMIT_USD`; fehlende oder zu hohe Kosten werden als fehlgeschlagener `Run` protokolliert. X gehört nicht zu diesem Datenfluss.
Nicht: "Social-Sweep", "X-Sweep", "Creator-Refresh".

**Trend Radar**
Die UI für den Hashtag-Korpus. `buildTrendRadar` vergleicht Posts und Plays der letzten sieben Tage mit den sieben Tagen davor. Momentum ist die gemittelte, symmetrische Bewegung beider Werte; Coverage zählt getrackte, nicht eigene Instagram-Creators, deren Signals dasselbe regelbasierte Thema tragen. Opportunity ist positives Momentum mal Coverage-Gap. Jede Zahl hat im Tab die beiden Vergleichswerte und einen Beleg-Text.
Nicht: "Format Signal", "Velocity", "Trend aus X".

**Run**
Ein protokollierter Durchlauf von Backfill (`lib/collect.ts` `runBackfill`, aus `POST /api/creators`), Delta-Refresh (`runRefresh`) oder manuellem Transkript-Lauf (`runTranscript`, aus `POST /api/signals/transcribe`). Der Transkript-Lauf prüft genau ein Reel, trägt dessen `transcriptSignalId`, `transcripts`-Zähler und die Apify-Nutzung (`usage`) am eigenen Run. Alle Runs speichern Art, Status (`ok`/`partial`/`failed`), Start, Ende, Dauer, geprüfte und übersprungene Creators, neue und aktualisierte Signale sowie Fehler pro Creator. Tabelle `runs` (Convex) bzw. `runs` in `data/store.json`; `GET /api/runs` liefert die letzten zehn plus die Monatssumme für den Profile-Tab. `partial` heißt: mindestens ein Creator ist fehlgeschlagen oder das Creator-Limit hat den Lauf beendet.
Nicht: "Job", "Execution", "Sync".

**Kosten-Guard**
Zwei Bremsen gegen unbemerkt teure Apify-Läufe. Erstens die Nutzung am Run: `usage` summiert `stats.computeUnits` und `usageTotalUsd` der Actor-Läufe (`lib/run-cost.ts`, gelesen aus dem Run-Objekt: der Client startet den Actor über `POST /acts/{id}/runs?waitForFinish=60`, pollt den Run bis zum Terminal-Status und liest dann das Dataset, weil die `run-sync`-Endpunkte nur den OUTPUT-Record liefern); fehlt der Dollar-Betrag, wird er aus den Compute-Units mal `APIFY_USD_PER_COMPUTE_UNIT` (0,40) geschätzt. Meldet ein Actor-Lauf gar nichts, zählt er in `unreported`, und ein Run ohne eine einzige Zahl zeigt im Profile-Tab "unknown" statt einer erfundenen Null. Zweitens `REFRESH_CREATOR_LIMIT` (25): mehr Creators fasst ein Delta-Refresh nicht an, zuerst die nie geprüften, dann die mit dem ältesten `lastCheckedAt`; die übrigen behalten ihren Cursor, der Run endet `partial`, und der nächste Lauf nimmt sie zuerst. Der Profile-Tab zeigt Kosten je Run und die Summe des laufenden Monats.
Nicht: "Budget", "Quota", "Rate-Limit".

**Transkript**
Was in einem Reel gesagt wird, gespeichert als `transcript` am Signal, dazu `transcriptStatus` (`ready`, `silent`, `missing`, `pending` oder `failed`). `pending` wird vor dem Actor-Lauf mit Versuchszähler und Zeitstempel gesetzt; ein Actor-Fehler setzt die gesendeten Reels auf `failed` und speichert eine begrenzte `transcriptError`. `ready`, `silent` und `missing` sind für die Automatik endgültig; `pending` und `failed` werden dort ebenfalls nicht erneut angefasst. Ein `pending` gilt nach `TRANSCRIPT_PENDING_TIMEOUT_MINUTES` (Standard 10) als abgelaufen und darf vom manuellen Lauf übernommen werden. Der Delta-Refresh holt es einmalig für Reels ab der kombinierten Score-Schwelle (`TRANSCRIPT_SCORE_THRESHOLD`, Standard 20; `pickTranscriptBatch` in `lib/transcripts.ts` liest den `outlierScorer` für Outlier, Channel-Relative und Velocity), ohne Status und mit `url`; stärkste Scores zuerst, höchstens `TRANSCRIPT_LIMIT_PER_RUN` (20) je Lauf. Reels ohne Creator bleiben außen vor. Beide Variablen wirken auch in der Convex-Umgebung. Der Actor ist `apple_yang/instagram-transcripts-scraper` (`lib/adapters/sources/apify-transcripts.ts`, ein Actor-Lauf mit `bulkUrls`). Ein Reel, das der Actor ohne Text beantwortet, wird `silent`; eines, das er auslässt, während er andere beantwortet, wird `missing` (gelöscht oder privat); beide sind endgültig, kein Reel wird zweimal bezahlt. Der Parser übernimmt gelieferte Zeitmarken als `transcriptSegments`. Die einmalige Bereinigung setzt alte `silent`/`missing`-Einträge ohne Transkript wieder auf offen (`signals:resetLegacyTranscriptStatuses` in Convex, beim Laden im Datei-Store). Die Nutzung des Actor-Laufs zählt in `usage` desselben Runs, die Zahlen stehen als `transcripts` (`added`, `silent`, `missing`, `failed`) am Run; ein Actor-Fehler ist ein Run-Fehler unter `transcripts` und macht den Run `partial`, nie `failed`. Im Cron begrenzt `transcriptLimit` (0 überspringt den Actor) einen Testlauf. Der Backfill holt keine Transkripte, das tut der nächste Refresh.

**Arbeitsfassung**
Die gespeicherte Fassung aus `transcript` plus allen akzeptierten `transcriptCorrections`. Sie wird als reine Funktion neu berechnet und nur materialisiert, wenn mindestens eine Korrektur akzeptiert ist. Stiländerungen und Umformulierungen gehören nicht in die Arbeitsfassung; ein neuer Actor-Lauf löscht sie zusammen mit den Korrekturen.

**Korrektur**
Ein Vorschlag für einen wörtlich im Original vorkommenden Erkennungsfehler mit `original`, `replacement`, `reason`, `source` (`bridge` oder `dictionary`), `status` (`proposed`, `accepted` oder `rejected`) und Zeitstempel. Jede Fundstelle wird ersetzt, auch bei mehrfacher Verwendung; die Anzahl steht im Grund. `POST /api/signals/transcript` lässt den lokalen Bridge-Endpunkt Erkennungsfehler vorschlagen, `PATCH /api/signals/transcript` nimmt einzelne Vorschläge an, bearbeitet oder verwirft sie. Bridge-Text bleibt untrusted source text und wird vor Speicherung begrenzt und geprüft.
Nicht: "Untertitel", "Captions" (Caption ist der Beitragstext), "Speech-to-Text".

**Wörterbuch**
Die persönliche Liste aus bekannten Erkennungsfehlern (`wrong -> right`) mit Zeitpunkt. Beim nächsten "Korrekturen vorschlagen" werden wörtliche Treffer zuerst als akzeptierte Korrekturen mit Quelle `dictionary` auf diesem Reel angelegt; die Ablehnung ändert nur dieses Reel. Der Bridge wird die Liste als untrusted Kontext mitgegeben, ein widersprechender Bridge-Vorschlag wird verworfen. Ein Eintrag kann in der Korrekturliste gemerkt oder wieder entfernt werden; einen eigenen Editor gibt es nicht.
Nicht: "Glossar", "Auto-Korrektur".

**Reel-Ansicht**
Das gemeinsame Detailpanel, das sich aus Discover-Karte, Briefing-Zeile und Creator-Detailzeile öffnet. Es zeigt Cover, Kennzahlen, Caption, Transkriptstatus, Zeitpunkt, Versuche und bei `ready` das Originaltranskript mit Zeitmarken. Wenn Korrekturen vorliegen, schaltet der Umschalter zwischen Original und Arbeitsfassung, die Fundstellen sind markiert und die Korrekturliste bietet `Annehmen`, `Bearbeiten` und `Verwerfen`. `Korrekturen vorschlagen` startet den Bridge-Lauf mit Lade- und Fehlerzustand. `Transkribieren` startet den manuellen Lauf für genau dieses Reel; `Erneut versuchen` steht für `silent`, `missing` und `failed` bereit, während `pending` die Aktion sperrt.
Nicht: "Transcript-Modal", "Video-Detail", "Untertitelansicht".

**Hook-Quelle**
Woraus der Hook eines Signals gelesen wird, entschieden an einer Stelle: `hookOf` in `lib/hook-source.ts` nimmt zuerst die Arbeitsfassung, wenn sie vorhanden ist, sonst das Originaltranskript. Der gesprochene Einstieg (`spokenHook`: erster Satz des Transkripts, ein Punkt nach einer Ziffer zählt nicht als Satzende, höchstens `SPOKEN_HOOK_MAX` 120 Zeichen) steht vor der ersten Caption-Zeile (`hookLine`) und dem Titel. Format Signals und Format-Review klassifizieren über `classifyHook(hookOf(reel))`; der Titel eines Evidenz-Eintrags ist `hookOf(reel)`.
Nicht: "Caption-Zeile" (nur der Rückfall), "Opener".

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
Ein wiederkehrendes Hook-Muster über mehrere Outlier-Reels (z.B. "Die besten X", "Nie wieder X"), erkannt regelbasiert aus dem Hook (siehe Hook-Quelle: gesprochener Einstieg, sonst erste Caption-Zeile). Die Musterliste steht in `lib/format-signals.ts` als `FORMAT_PATTERNS` und ist durch einen weiteren Eintrag erweiterbar; `buildFormatSignals` liefert je Muster Anzahl, Durchschnitts-Outlier, Anteil an allen Outliern, bis zu `FORMAT_EXAMPLE_LIMIT` (3) Beispiel-Reels und die Wochenlinie über `FORMAT_WINDOW_DAYS` (90). Reels ohne erkanntes Muster stehen als "Unclassified" am Ende, mit ihrem Anteil.
Nicht: "Pattern", "Trend", "Template".

**Format-Review**
Der monatliche Diff der Format Signals: `buildFormatReview` (`lib/format-review.ts`) rechnet die Muster der letzten `FORMAT_WINDOW_DAYS` (90) neu und stellt sie dem Review des Vormonats gegenüber. Je Muster Bewegung (`new`, `up`, `down`, `flat`, `gone`), Anteil, Anzahl und Durchschnitts-Outlier, jeweils mit Delta; dazu die kleinen Creators unter `FORMAT_REVIEW_SMALL_AUDIENCE` (50k), deren Outlier-Reel ein benanntes Muster trägt. Geschrieben vom Convex-Cron am 1. jedes Monats (`convex/crons.ts`) in die Tabelle `formatReviews`, gelesen über `GET /api/format-reviews`, angezeigt im Format-Signals-Tab als "What changed".
Nicht: "Report", "Monatsbericht", "Audit".

**Nische-fremder Creator**
Ein Creator mit `foreign: true`, also aus einer anderen Nische; wird normal beobachtet, aber seine Format Signals erscheinen im eigenen Block "Foreign niche", damit importierte Muster die eigenen Kennzahlen nicht verwässern. Umgeschaltet über den Globus-Knopf in Tracked Channels, gespeichert über `PATCH /api/creators` (Body geparst von `parseCreatorMark` in `lib/creator-mark.ts`).

Davon getrennt ist `market: "de" | "en"` (fehlend = `"de"`): gleiche Nische, anderer Sprachmarkt. Englische Creator behalten ihre Format Signals im Block "English market", geben beim globalen Transkript-Budget deutschen Reels den Vortritt und tragen in Tracked Channels ein EN-Badge. `foreign` bleibt für nischen-fremd reserviert, `market` für die Sprache; ein Creator kann beides tragen, dann gewinnt `foreign`. Gesetzt beim Anlegen über den Market-Select im Add-Dialog bzw. `POST /api/creators`.
Nicht: "Fremdnische", "External", "Competitor".

**Hook**
Die erste Zeile der Caption bzw. die ersten drei Sekunden eines Reels (mit Transkript der gesprochene Einstieg, siehe Hook-Quelle); Hooks werden im Hooks-Board variiert und gegen den Outlier-Korpus geprüft.
Nicht: "Titel" (Titel ist das YouTube-Pendant), "Opener", "Headline".

**Hooks-Board**
Der Tab, der aus Quellmaterial Hook-Varianten schreibt (ersetzt den früheren Titles-Tab). Eingabe ist ein Transkript, eine Idee oder ein Einzeiler bis `HOOK_INPUT_MAX` (20.000 Zeichen), dazu eine optionale Richtung und die Anzahl aus `HOOK_COUNTS` (5, 10, 15); längere Eingaben lehnt `parseHookRequest` (`lib/hooks-board.ts`) mit der gezählten Zeichenzahl ab. Der Lauf geht über `POST /api/hooks` an den Bridge-Endpunkt `/v1/hooks` gegen `hooksOutputSchema`, mit demselben Evidenzpaket wie ein Develop-Lauf.
Nicht: "Titles", "Title board", "Headline-Generator".

**Hypothese**
Wogegen eine Hook-Variante testet: `curiosity` (Neugier-Lücke), `list` (Liste), `contrast` (Kontrast), `promise` (Versprechen) oder `story` (Story). Die Liste steht als `HOOK_HYPOTHESES` in `lib/hooks-board.ts` und ist die Gruppierung des Boards; `groupHooks` hält die Reihenfolge und lässt leere Gruppen weg.
Nicht: "Kategorie", "Bucket", "Winkel" (Angle meint den Strategy-Entwurf).

**Hook-Lauf**
Ein protokollierter Lauf des Hooks-Boards in der Tabelle `hookRuns`: Zeitpunkt, Zeichenzahl und Auszug der Eingabe, angeforderte Anzahl, Art (`transcript` ab `HOOK_TRANSCRIPT_MIN`, sonst `one-liner`), das gruppierte Board und die Größe des Evidenzpakets. Jeder Start schreibt eine eigene Zeile mit eigener id, parallel gestartete Läufe überschreiben sich also nie; die History-Rail zeigt die letzten `HOOK_RUN_HISTORY` (20) und lädt einen Lauf wieder auf.
Nicht: "Run" (Run meint den Sammel-Durchlauf), "Session", "Board-Historie".

**Beleg**
Das Outlier-Reel, das unter einer Hook-Variante steht: dessen eigener Hook, Creator-Handle und Outlier-Faktor. Der Titel eines Evidenz-Eintrags ist der Hook des Reels (siehe Hook-Quelle: gesprochener Einstieg, sonst erste Caption-Zeile). Belege kommen ausschließlich aus dem Evidenzpaket; nennt die Antwort einen Titel, den das Paket nicht führt, fällt er weg, und eine Variante ohne brauchbare Nennung bekommt über `similarEvidence` die wortähnlichsten Outlier-Hooks.
Nicht: "Quelle", "Referenz", "Zitat".

**Briefing**
Das Tagesdokument, das jeder Delta-Refresh hinterlässt: die zehn stärksten Reels der letzten `BRIEFING_WINDOW_HOURS` (24) aus der Nische, je mit Creator, Cover, Kennzahlen und einem "Chris angle". Gespeichert in der Tabelle `briefings`, ein Dokument je Tag unter `briefing-<YYYY-MM-DD>`, ein zweiter Refresh überschreibt es. `buildBriefing` (`lib/briefing.ts`) baut es rein über dem Korpus, `runBriefing` (`lib/briefing-run.ts`) ist der Lauf mit Bridge und Speichern. Der Briefing-Tab liest das neueste, ältere Tage über den Day-Picker; ohne gespeichertes Dokument rechnet er dasselbe über den Demo-Fixtures.
Nicht: "Digest", "Daily", "Report", "Newsletter".

**Briefing-Score**
Wonach ein Briefing sortiert: Outlier × Frische (`briefingScore`). Die Frische fällt linear von 1 zum Erscheinungszeitpunkt auf `BRIEFING_FRESHNESS_FLOOR` (0.5) am Fensterrand, damit der Outlier die Entscheidung trägt und die Frische nur nahe Gleichstände auflöst. Ein Reel am Fensterrand braucht genau den doppelten Outlier, um gegen ein eben erschienenes zu gewinnen.
Nicht: "Momentum", "Velocity" (Velocity ist Plays pro Stunde beim Scorer), "Ranking".

**Chris angle**
Der eine Satz unter einem Briefing-Reel: wie Chris dieses Thema für sein Publikum drehen würde. Kommt vom Bridge über `/v1/briefing`, eine Liste in der Reihenfolge der Items, und wird von `applyAngles` positionsweise angehängt. Der Angle ist Beiwerk: fällt der Bridge aus, steht das Briefing ohne ihn (`angles: false`). Beim "Create idea" wird er das Ziel der Idee.
Nicht: "Take", "Spin", "Kommentar"; "Angle" allein meint den Strategy-Entwurf (`StrategyResponse.angle`).

**Slate**
Das Produktions-Slate des Tages: `SLATE_SIZE` (10) Startpunkte, die der Bridge aus den Signalen der letzten `BRIEFING_WINDOW_HOURS` (24) liest. Gespeichert in der Tabelle `slates`, ein Dokument je Tag unter `slate-<YYYY-MM-DD>`; anders als das Briefing wird es von einem zweiten Refresh am selben Tag nicht überschrieben, sondern gefunden und so gelassen (`runSlate` in `lib/slate-run.ts`), damit neu erzeugte Startpunkte und daraus entstandene Ideas stehen bleiben. `POST /api/slates` mit `{ force: true }` baut das Tagesdokument neu. Das Paket sind dieselben Reels wie beim Briefing (`slateSources` in `lib/slate.ts` über `selectBriefingSignals`, höchstens `SLATE_SOURCE_LIMIT` 12, nur Reels mit Titel und Handle), der Bridge antwortet auf `/v1/slate` gegen `slateOutputSchema(count, sourceCount)`. Anders als der Angle ist das Slate das Dokument selbst: fällt der Bridge aus, entsteht keins. Der Convex-Cron schreibt kein Slate (kein Bridge in der Cloud); der lokale Refresh und der Knopf im Briefing-Tab tun es. Angezeigt als Abschnitt "Production slate" unter der Briefing-Liste, ältere Tage über den Day-Picker.
Nicht: "Vorschlagsliste", "Backlog", "Queue", "Briefing" (das Briefing sind die Reels, das Slate die Startpunkte daraus).

**Startpunkt**
Ein Eintrag auf dem Slate (`SlateStart`): `pitch` (ein bis zwei Sätze, was das Reel zeigen oder behaupten würde), `topic` (das Themen-Etikett, zwei bis vier Worte) und das Quell-Signal (`sourceSignalId`, `sourceCreator`, `sourceTitle`, `sourceUrl`, Outlier, Plays). Der Bridge nennt das Quell-Signal als Position im Paket (`source`, 1-basiert), nie als Titel, damit zwei Reels mit gleichem Titel auseinander bleiben; `parseSlateAnswer` lehnt eine Antwort mit falscher Anzahl oder einer Position außerhalb des Pakets ganz ab. Ein einzelner Startpunkt wird über `POST /api/slates/regenerate` neu erzeugt (`regenerateStart`: Paket aus dem Fenster des Slates, die übrigen Pitches gehen als `taken` mit, damit der neue keiner davon ist; `replaceStart` setzt ihn an dieselbe Position mit `regeneratedAt`, die anderen bleiben unverändert). Der Klick "Create idea" (`POST /api/slates/ideas`, `ideaFromStart`) macht aus ihm eine Idea mit `sourceSignalId`, `sourceCreator`, `sourceUrl` und dem Pitch als Titel; der Startpunkt trägt danach die `ideaId` und wird nicht zweimal zur Idea.
Nicht: "Vorschlag", "Prompt", "Hook" (ein Hook ist die erste Zeile, ein Startpunkt der ganze Ansatz), "Idea" (das wird er erst per Klick).

**Richtung**
Der Freitext für den nächsten Durchlauf ("mehr Werkzeug, weniger Meinung"), gespeichert als `direction` am Slate über `PATCH /api/slates` (Body geparst von `parseSlateDirection`, höchstens `SLATE_DIRECTION_MAX` 500 Zeichen, leer löscht sie). Sie wirkt in jedem Lauf danach: beim Neu-Erzeugen eines Startpunkts, beim Neubau des Tages und im Slate des nächsten Tages, weil `runSlate` die Richtung vom neuesten gespeicherten Slate übernimmt. `directionApplied` am Slate sagt, welche Richtung der letzte Lauf bekommen hat; die Statuszeile zeigt sie.
Nicht: "Prompt", "Instruktion", "Feedback", "Direction" (nur als Feldname und englisches UI-Label).

## Ergänzende Begriffe

**TranscriptAnalysis**
Die gespeicherte Inhaltsanalyse eines fertigen Reel-Transkripts. Sie referenziert Signal, Textfassung, Text-Hash, Analyseversion und Lauf. PAS oder BBB sowie Hook, Spannung, offene Schleifen, Beweise, Beispiele, Übergänge, Rhythmus und CTA werden nur mit wörtlichen Fundstellen und Zeichenpositionen gespeichert. BBB bedeutet Behaupten, Begründen, Beispiel.
Nicht: "Format Signal", "Caption-Analyse", "Zusammenfassung".

**Textfassung**
Der genaue Text, den eine TranscriptAnalysis geprüft hat. Eine vorhandene Arbeitsfassung hat Vorrang vor dem unveränderten Original. Ändert sich die bevorzugte Fassung oder ihr Hash, bleibt das frühere Ergebnis lesbar und wird als veraltet angezeigt. Zeitmarken erscheinen nur, wenn eine Fundstelle eindeutig auf ein Segment des Originals zurückgeführt werden kann.
Nicht: "Version" ohne Bezug zum Text, "bereinigtes Original".

**Analyse-Claim**
Die atomare, zeitlich begrenzte Reservierung eines vorgemerkten Analysejobs durch den lokalen Worker. Ein manueller Lauf beansprucht die ausgewählte Analyse-ID; ein Batch beansprucht den ältesten verfügbaren Job. Ein abgelaufener Claim darf bis zum Versuchslimit übernommen werden. Claim-ID und Text-Hash verhindern, dass ein verspätetes Ergebnis eine neuere Fassung ersetzt.
Nicht: "Transkript-Claim", "Lock".

**Teilabdeckung**
Eine gespeicherte Analyse, bei der das Zeichenlimit nicht alle Textteile erreicht hat. Geprüfte und fehlende Chunks bleiben sichtbar; `complete: false` verhindert, dass sie als vollständige Volltextanalyse zählt.
Nicht: "fertige Vollanalyse", "stille Kürzung".

**Skript**
Ein eigenes Produktionsobjekt in der Tabelle `scripts`, verbunden mit einer Idea, einem optionalen Quell-Reel und weiteren Belegen. Das Skript beginnt in `hook-selection`, trägt Hook-Optionen und Abschnitte und bleibt vom Storyboard getrennt. Der Hauptbereich ist der `Scripts`-Tab, einzelne Skripte liegen unter `/script/<id>`. Der Text wird im Store gehalten und nie in den Vault oder in Git geschrieben. Ein freigegebenes Skript ist bis zum bewussten Wiederöffnen unveränderlich.
Nicht: "Storyboard", "Outline", "Shotlist", "Konzept".

**Skriptstatus**
Die vier festen Zustände eines Skripts: `hook-selection`, `draft`, `review` und `approved`. `hook-selection -> draft` geschieht nur durch einen erfolgreichen Draft-Lauf. Von Hand gehen nur `draft -> review`, `review -> draft`, `review -> approved` und beim Wiederöffnen `approved -> draft`; das Wiederöffnen erhöht die Revision. Verbotene Züge werfen denselben `ForbiddenMoveError` wie bei Ideas und kommen aus Convex als `kind: "forbidden-move"` zurück.
Nicht: "Produktionsstufe", "State", "Kanban-Spalte".

**Develop-Lauf**
Der Lauf aus `POST /api/ideas/develop` ist der Hook-Lauf eines Skripts. Er wählt bis zu zehn Outlier-Reels aus demselben Fenster wie das Evidenzpaket, nimmt das Quell-Reel einer Idea zusätzlich auf, wenn es außerhalb des Fensters liegt, und bevorzugt die geprüfte Transkript-Arbeitsfassung vor dem Original. Der lokale Bridge-Endpunkt `/v1/script-hooks` liefert drei bis fünf unterschiedliche Hook-Optionen mit Hook, Angle, frei formulierter Hypothese, Framework, Belegen und Themenpassung sowie eine PAS-, BBB- oder Keins-Empfehlung. Ein Lauf hält die Idea über `developRunId` und das Skript über `runId`; ein Fehler gibt beide Ansprüche frei. Ein zweiter Klick während eines laufenden Laufs ist ein Konflikt. Ein späterer Klick öffnet das vorhandene Skript. Im leeren Store kommen drei feste Demo-Optionen zurück, ohne Bridge-Aufruf.
Nicht: "Storyboard-Lauf", "Forecast-Lauf", "zweiter Versuch überschreibt den ersten".

**Hook-Option**
Eine mögliche gesprochene Eröffnung eines Skripts mit `id`, `hook`, `angle`, frei formulierter Hypothese, Framework, Belegen und Themenpassung. `edited` markiert, dass Chris Hook oder Angle bearbeitet hat. Hook-Optionen werden vor dem ersten Draft gewählt und bleiben am Skript gespeichert.
Nicht: "Hook-Board-Hypothese", "Titel", "Opener".

**Abschnitt**
Ein geordnetes Element der Skriptquelle mit `kind` (`hook`, `beat`, `transition` oder `cta`), `label` und `text`. Ein vollständiges Skript hat genau einen Hook und eine CTA sowie zwei bis fünf Beats; Übergänge sind optional. Die Leseansicht wird später aus diesen Abschnitten gerendert und ist keine zweite Textquelle.
Nicht: "Freitext", "Storyboard-Beat", "Shot".

**Leseansicht**
Die zusammenhängende, trotzdem abschnittsgebundene Darstellung eines Skripts im Editor. `renderScriptReadingView` leitet jedes Lesestück mit seinem `sectionIndex` aus der Abschnittsliste ab; eine Bearbeitung schreibt direkt in diesen Abschnitt zurück und übersetzt keinen zusammengefügten Freitext zurück. Die Ansicht ist bei `approved` gesperrt und wird erst nach `approved -> draft` wieder bearbeitbar.
Nicht: "Preview", "Textansicht", "Freitext-Editor".

**Draft-Lauf**
Der vollständige Skriptlauf aus `POST /api/scripts/<id>/draft`. Er nimmt die gewählte Hook-Option und das Framework, sendet das begrenzte Quell- und Evidenzpaket an `/v1/script-draft` und schreibt genau einen Hook, zwei bis fünf Beats, optionale Übergänge und eine CTA. Der Hook muss wörtlich der Auswahl entsprechen. Vor dem Speichern lehnt `parseScriptDraftAnswer` jeden Satz ab acht Wörtern ab, der nach Kleinschreibung und Leerraum-Normalisierung in einem mitgegebenen Transkript oder einer Caption vorkommt. Ein Fehler gibt `runId` frei und lässt das Skript unverändert. Ein neuer Lauf ersetzt alle Abschnitte und erhöht die Revision.
Nicht: "Develop-Lauf" (der erzeugt Hook-Optionen), "Rewrite", "Autokopie".

**Lektorat**
Der prüfende Lauf im Skript-Editor (`POST /api/scripts/<id>/lint`). Die Bridge führt zuerst `slop-lint.sh` als Regex-Stufe aus und gibt den installierten Pattern-Katalog an die Modell-Stufe; die Abschnitte bleiben dabei untrusted source text. Die Antwort enthält nur begrenzte Vorschläge mit `sectionId`, `original`, `replacement` und `reason`. `parseScriptLintResponse` lässt nur wörtliche Fundstellen im genannten Abschnitt durch, und Chris übernimmt jeden Vorschlag einzeln. Eine Übernahme schreibt in die Abschnittsliste und erhöht die Revision; der Lektorat-Lauf selbst ändert keinen Text. Während des Laufs sperrt `runId` das Skript, ein Fehler gibt den Claim frei.
Nicht: "Autokorrektur", "Rewrite", "Stilpolitur".

**Idea**
Ein gespeicherter Content-Ansatz in der Tabelle `ideas`: Arbeitstitel, optionales Ziel, optionales Quell-Signal (`sourceSignalId`, `sourceCreator`), Status (eine Produktionsstufe oder `dropped`), ein mögliches Storyboard und ein separates Skript. Der Ideas-Tab ist die Inbox für Erfassen, Develop, manuelle Stufenzüge und Drop; die Schreibarbeit liegt im Skript. Capture geht aus dem Ideas-Formular und aus einer Karte in Discover oder Briefing.
Nicht: "Draft", "Konzept".

**Produktionsstufe**
Wo eine Idea in der Pipeline steht. Sechs Stufen in fester Reihenfolge (`IDEA_STAGES` in `lib/ideas.ts`): `captured` (erfasst), `developing` (in Entwicklung, der Develop-Lauf setzt sie), `packaging` (im Packaging), `scripting` (im Skript), `producing` (in Produktion), `published` (veröffentlicht); daneben `dropped` als Abbruch. Die erlaubten Übergänge stehen nur in `canTransition`: eine Stufe weiter, nie zurück, nie überspringen; jede Stufe vor `published` kann `dropped` werden; `developing -> developing` ist ein zweiter Develop-Lauf; `published` und `dropped` sind final. Von Hand schiebt der Pfeil-Knopf in der Ideen-Liste eine Idea auf die nächste Stufe (`PATCH /api/ideas`, Body geparst von `parseIdeaMove`, gespeichert über `StorageAdapter.moveIdea`, in Convex die Mutation `ideas.move`); ein verbotener Übergang ist ein `ForbiddenMoveError` (in Convex als `ConvexError` mit `kind: "forbidden-move"`, damit der Grund auch auf einem Prod-Deployment ankommt), kommt als 409 mit dem Grund zurück und steht in der Fehlerbox; ein nicht erreichbarer Store ist 500. Die Meta-Zeile einer Idea zeigt, seit wann sie auf ihrer Stufe steht. Die Zählerleiste über der Liste (`countByStage`) zeigt je Stufe die Anzahl und filtert die Liste beim Klick. Die vier Status vor der Pipeline (`developed`, `produced`) bildet `legacyStage` ab (`developed -> developing`, `produced -> producing`); Convex hat das einmalig über `ideas.migrateStages` getan, der Datei-Store tut es beim Laden.
Nicht: "Phase", "Workflow-Step", "Kanban-Spalte", "State" (nur als CSS-Klasse).

**Storyboard**
Der Short-Form-Plan an einer Idea, erzeugt ausschließlich über `POST /api/scripts/<id>/storyboard` aus einem aktuell freigegebenen Skript. Er trägt `scriptId`, `scriptRevision`, den wörtlichen Skript-Hook, genau drei verdichtete `beats`, eine gesprochene `cta`, `caption` und `takeaway`. `commentCta` und `leadMagnetCta` sind davon getrennte Felder und bleiben bis zu den späteren Phasen leer. Caption-Zeilen, CTA und Beat-Details dürfen sich weder gegenseitig noch den Hook wiederholen; `parseScriptStoryboardAnswer` lehnt den ganzen Lauf vor dem Speichern ab. `/v1/storyboard` akzeptiert dafür das Skript mit seinen Abschnitten als zweite Eingabeform.
Nicht: "Skript", "Outline", "Shotlist".

**Legacy-Storyboard**
Ein erhaltenes Storyboard ohne `scriptId`, das vor dem Skriptstudio direkt aus einer Idea und dem Evidenzpaket entstand. Die Ideas-Inbox zeigt dafür das Badge `Legacy`. Es bleibt unverändert, bis Chris im zugehörigen freigegebenen Skript gezielt `Storyboard neu erzeugen` startet; dann wird es durch ein Storyboard mit `scriptId` und `scriptRevision` ersetzt. Weicht diese Revision später von `approvedRevision` ab, zeigt die Idea `Storyboard älter als das Skript`.
Nicht: "veraltetes Skript", "Entwurf", "automatisch migriertes Storyboard".

**Prognose**
Was eine Idea vor der Produktion wahrscheinlich bringt, gespeichert als `forecast` neben ihrem Storyboard (`Forecast` in `lib/contracts.ts`). Der Storyboard-Bridge schätzt keine Zahl: Er nennt im Feld `forecast.comparable` die Titel der Reels aus dem Skriptpaket, die er für vergleichbar hält, und `deriveForecast` (`lib/forecast.ts`) rechnet Spanne und Potenzial aus genau diesen Reels. Titel, die das Paket nicht führt, fallen weg wie ein Beleg. Die vier Teile bleiben Reichweiten-Spanne, Potenzial (`low`, `medium`, `high`), größtes Risiko und Spannung.
Nicht: "Forecast" (nur als Feldname und als englisches UI-Label), "Schätzung", "Vorhersage", "Score".

**Strategy-Provider**
Die Komponente, die aus einem Evidenzpaket eine Idea erzeugt; läuft über den lokalen Bridge mit Codex SDK, siehe ADR-0004. Antwortet auf Deutsch.
Nicht: "LLM", "KI-Backend", "Agent".

**Evidenzpaket**
Die Eingabe des Strategy-Providers: die stärksten Outlier-Reels des Fensters aus dem gespeicherten Korpus (`lib/strategy-evidence.ts`), je Eintrag Titel, Creator-Handle, Caption-Auszug, Plays und Outlier. Fenster und Anzahl stehen in `lib/config.ts` (`STRATEGY_EVIDENCE_WINDOW_DAYS` 30, `STRATEGY_EVIDENCE_LIMIT` 10), die Schwelle ist `OUTLIER_THRESHOLD`. Demo-Fixtures kommen nie hinein.
Nicht: "Kontext", "Prompt-Daten", "Sample".

**Bridge**
Der lokale Prozess `bridge/server.mjs`, der Strategy-Anfragen der Web-App entgegennimmt und ans Codex SDK weiterreicht.
Nicht: "Proxy", "Gateway", "API".

**Pattern**
Eine gespeicherte, operational prüfbare Strukturhypothese aus vollständigen Reel-Transkripten. Ein Pattern-Vergleich lässt den lokalen Bridge dieselbe Definition je aktueller, vollständiger Inhaltsanalyse ausdrücklich als `present` oder `absent` prüfen; fehlende, unvollständige oder veraltete Analysen bleiben `unknown`. Ein Kandidat braucht die konfigurierte Basis von fünf vorhandenen Reels aus drei Creators, fünf abwesenden Reels und eine positive Outlier-Median-Differenz innerhalb derselben Vergleichszelle. Das ist ein beobachteter Zusammenhang ohne Kausalitätsversprechen.
Nicht: "Format Signal" (regelbasierte Hook-Form), "Framework" (PAS/BBB/none), "Erfolgsrezept".

**Pattern-Vergleichslauf**
Der gespeicherte, idempotente Stand einer Pattern-Definition gegen eine konkrete Datenbasis. Definition, Lauf und begrenzte Reel-Belege liegen getrennt. Der Lauf speichert Markt, Nischenklasse, Topic, Veröffentlichungsaltersgruppe, Owned-Gruppe, 90-Tage-Fenster, Stichproben, Mediane, Differenz, unbekannte und ausgeschlossene Daten. Fehlende Gegenbelege werden nur nach bewusster Reel-Auswahl über die bestehende manuelle Transkriptaktion ergänzt.
Nicht: "A/B-Test", "Signifikanztest", "automatischer Backfill".

## Skript-Board

**Board**
Ein Canvas unter `/board/<id>` mit Quellen, Kontextkanten und Chat, gespeichert nur in Convex (Tabelle `boards`, ADR-0007). Ein Board hat einen Titel, eine optionale Video-Zuordnung (`videoSlug`), eine Brand Voice und eine monotone `revision`, die jede angewendete Änderung um eins erhöht. Schreiben darf immer nur der Tab mit der Schreib-Lease.
Nicht: "Skript" (das ist die Tabelle `scripts`), "Projekt", "Workspace".

**Board-Node**
Ein Element auf dem Board mit Typ `youtubeNode`, `textNode`, `groupNode` oder `chatNode`, eigener ID im Schema `<typ>-<adjektiv>-<nomen>-<5 Zeichen>`, Position und Größe. Kinder einer Gruppe tragen `parentId`, Gruppen haben selbst kein `parentId`. Text-Inhalte liegen getrennt in `boardTextBlocks` (Editor) und `boardTextMarkdown` (Kontext und Export).
Nicht: "Karte", "Widget", "Block" (Block ist ein Absatz im Editor).

**Kontextkante**
Eine gerichtete Verbindung von einem YouTube-, Text- oder Gruppen-Node zu einem Chat-Node, immer vom Handle `connector` zum Handle `chat-connector`. Nur was per Kontextkante am Chat hängt, geht als Quelle in dessen Läufe; eine Kante zu einer Gruppe bringt alle Kinder mit.
Nicht: "Link", "Beziehung", "Kante zwischen Quellen".

**Unterhaltung**
Ein Gesprächsverlauf an einem Chat-Node (Tabelle `boardConversations`, Nachrichten in `boardMessages`). Ein Chat-Node kann mehrere Unterhaltungen haben; eine neue entsteht mit ihrer ersten Nachricht. Je Unterhaltung läuft höchstens ein Lauf gleichzeitig.
Nicht: "Thread", "Session", "Chat" (Chat ist der Node).

**Engine**
Das lokale Modell-Programm, das einen Chat-Lauf beantwortet: Claude Code (Standard), Codex oder Command Code. Jede Engine läuft über die Abos, nur von der Bridge gestartet, in einer äußeren `sandbox-exec`-Sandbox und ohne Werkzeuge. Aktiv ist sie nur, wenn sie in `BOARD_ENGINES_ENABLED` steht und das Gate für ihre installierte Version bestanden hat.
Nicht: "Provider", "Agent", "Strategy-Provider" (der bleibt Codex SDK für die Signal-Room-Läufe).

**Board-Export**
Das Schreiben von `skript.md` und optional `beats.md` aus je einem Text-Node nach `YTOS_ROOT/videos/<video>/`, nur nach Vorschau und ausdrücklicher Bestätigung. Die Vorschau friert Inhalt und Ziel-Hashes ein; ein Journal mit Sicherungen macht einen abgebrochenen Export rückgängig, ohne von Hand geänderte Dateien anzufassen. Der Export committet nichts.
Nicht: "Sync", "Speichern", "Veröffentlichen".

**Herkunft**
Die Liste der Transkript-Versionen und Text-Quellen, aus denen ein Board-Text entstanden ist (`provenance`). Ein Chat-Lauf speichert sie als `contextManifest`, "Als Text-Node" überträgt sie weiter, transitiv über mehrere Stufen. Der Export liest sie für `quellen` im Frontmatter und für die Prüfung auf wörtlich übernommene Transkript-Sätze.
Nicht: "Quellenangabe" (das ist nur die Anzeige), "Metadaten".
