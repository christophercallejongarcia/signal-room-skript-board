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
Ein protokollierter Durchlauf von Backfill (`lib/collect.ts` `runBackfill`, aus `POST /api/creators`) oder Delta-Refresh (`runRefresh`): Art, Status (`ok`/`partial`/`failed`), Start, Ende, Dauer, geprüfte und übersprungene Creators, neue und aktualisierte Signale, Fehler pro Creator und die Apify-Nutzung (`usage`). Tabelle `runs` (Convex) bzw. `runs` in `data/store.json`; `GET /api/runs` liefert die letzten zehn plus die Monatssumme für den Profile-Tab. `partial` heißt: mindestens ein Creator ist fehlgeschlagen oder das Creator-Limit hat den Lauf beendet.
Nicht: "Job", "Execution", "Sync".

**Kosten-Guard**
Zwei Bremsen gegen unbemerkt teure Apify-Läufe. Erstens die Nutzung am Run: `usage` summiert `stats.computeUnits` und `usageTotalUsd` der Actor-Läufe (`lib/run-cost.ts`, gelesen aus dem Run-Objekt: der Client startet den Actor über `POST /acts/{id}/runs?waitForFinish=60`, pollt den Run bis zum Terminal-Status und liest dann das Dataset, weil die `run-sync`-Endpunkte nur den OUTPUT-Record liefern); fehlt der Dollar-Betrag, wird er aus den Compute-Units mal `APIFY_USD_PER_COMPUTE_UNIT` (0,40) geschätzt. Meldet ein Actor-Lauf gar nichts, zählt er in `unreported`, und ein Run ohne eine einzige Zahl zeigt im Profile-Tab "unknown" statt einer erfundenen Null. Zweitens `REFRESH_CREATOR_LIMIT` (25): mehr Creators fasst ein Delta-Refresh nicht an, zuerst die nie geprüften, dann die mit dem ältesten `lastCheckedAt`; die übrigen behalten ihren Cursor, der Run endet `partial`, und der nächste Lauf nimmt sie zuerst. Der Profile-Tab zeigt Kosten je Run und die Summe des laufenden Monats.
Nicht: "Budget", "Quota", "Rate-Limit".

**Transkript**
Was in einem Reel gesagt wird, gespeichert als `transcript` am Signal, dazu `transcriptStatus` (`ready`, `silent`, `missing`, `pending` oder `failed`). `pending` wird vor dem Actor-Lauf mit Versuchszähler und Zeitstempel gesetzt; ein Actor-Fehler setzt die gesendeten Reels auf `failed` und speichert eine begrenzte `transcriptError`. `ready`, `silent` und `missing` sind für die Automatik endgültig; `pending` und `failed` werden dort ebenfalls nicht erneut angefasst. Ein `pending` gilt nach `TRANSCRIPT_PENDING_TIMEOUT_MINUTES` (Standard 10) als abgelaufen und darf vom manuellen Lauf übernommen werden. Der Delta-Refresh holt es einmalig für Reels ab der kombinierten Score-Schwelle (`TRANSCRIPT_SCORE_THRESHOLD`, Standard 20; `pickTranscriptBatch` in `lib/transcripts.ts` liest den `outlierScorer` für Outlier, Channel-Relative und Velocity), ohne Status und mit `url`; stärkste Scores zuerst, höchstens `TRANSCRIPT_LIMIT_PER_RUN` (20) je Lauf. Reels ohne Creator bleiben außen vor. Beide Variablen wirken auch in der Convex-Umgebung. Der Actor ist `apple_yang/instagram-transcripts-scraper` (`lib/adapters/sources/apify-transcripts.ts`, ein Actor-Lauf mit `bulkUrls`). Ein Reel, das der Actor ohne Text beantwortet, wird `silent`; eines, das er auslässt, während er andere beantwortet, wird `missing` (gelöscht oder privat); beide sind endgültig, kein Reel wird zweimal bezahlt. Der Parser übernimmt gelieferte Zeitmarken als `transcriptSegments`. Die einmalige Bereinigung setzt alte `silent`/`missing`-Einträge ohne Transkript wieder auf offen (`signals:resetLegacyTranscriptStatuses` in Convex, beim Laden im Datei-Store). Die Nutzung des Actor-Laufs zählt in `usage` desselben Runs, die Zahlen stehen als `transcripts` (`added`, `silent`, `missing`, `failed`) am Run; ein Actor-Fehler ist ein Run-Fehler unter `transcripts` und macht den Run `partial`, nie `failed`. Im Cron begrenzt `transcriptLimit` (0 überspringt den Actor) einen Testlauf. Der Backfill holt keine Transkripte, das tut der nächste Refresh.
Nicht: "Untertitel", "Captions" (Caption ist der Beitragstext), "Speech-to-Text".

**Hook-Quelle**
Woraus der Hook eines Signals gelesen wird, entschieden an einer Stelle: `hookOf` in `lib/hook-source.ts` nimmt den gesprochenen Einstieg (`spokenHook`: erster Satz des Transkripts, ein Punkt nach einer Ziffer zählt nicht als Satzende, höchstens `SPOKEN_HOOK_MAX` 120 Zeichen), sonst die erste Caption-Zeile (`hookLine`), sonst den Titel. Format Signals und Format-Review klassifizieren über `classifyHook(hookOf(reel))`; der Titel eines Evidenz-Eintrags ist `hookOf(reel)`.
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

**Idea**
Ein gespeicherter Content-Ansatz in der Tabelle `ideas`: Arbeitstitel, optionales Ziel, optionales Quell-Signal (`sourceSignalId`, `sourceCreator`), Status (eine Produktionsstufe oder `dropped`) und Storyboard. Capture geht aus dem Ideas-Formular und aus einer Karte in Discover oder Briefing. Der Strategy-Provider liefert daneben den Angle-Entwurf als `StrategyResponse` (angle, rationale, opening, proofToShow, cautions).
Nicht: "Draft", "Konzept".

**Produktionsstufe**
Wo eine Idea in der Pipeline steht. Sechs Stufen in fester Reihenfolge (`IDEA_STAGES` in `lib/ideas.ts`): `captured` (erfasst), `developing` (in Entwicklung, der Develop-Lauf setzt sie), `packaging` (im Packaging), `scripting` (im Skript), `producing` (in Produktion), `published` (veröffentlicht); daneben `dropped` als Abbruch. Die erlaubten Übergänge stehen nur in `canTransition`: eine Stufe weiter, nie zurück, nie überspringen; jede Stufe vor `published` kann `dropped` werden; `developing -> developing` ist ein zweiter Develop-Lauf; `published` und `dropped` sind final. Von Hand schiebt der Pfeil-Knopf in der Ideen-Liste eine Idea auf die nächste Stufe (`PATCH /api/ideas`, Body geparst von `parseIdeaMove`, gespeichert über `StorageAdapter.moveIdea`, in Convex die Mutation `ideas.move`); ein verbotener Übergang ist ein `ForbiddenMoveError` (in Convex als `ConvexError` mit `kind: "forbidden-move"`, damit der Grund auch auf einem Prod-Deployment ankommt), kommt als 409 mit dem Grund zurück und steht in der Fehlerbox; ein nicht erreichbarer Store ist 500. Die Meta-Zeile einer Idea zeigt, seit wann sie auf ihrer Stufe steht. Die Zählerleiste über der Liste (`countByStage`) zeigt je Stufe die Anzahl und filtert die Liste beim Klick. Die vier Status vor der Pipeline (`developed`, `produced`) bildet `legacyStage` ab (`developed -> developing`, `produced -> producing`); Convex hat das einmalig über `ideas.migrateStages` getan, der Datei-Store tut es beim Laden.
Nicht: "Phase", "Workflow-Step", "Kanban-Spalte", "State" (nur als CSS-Klasse).

**Storyboard**
Der Short-Form-Plan an einer Idea: `hook` (erste drei Sekunden), genau drei `beats` mit Label und Detail, `cta`, `caption` (Zeilenumbrüche bleiben erhalten) und `takeaway`. Entsteht im Develop-Lauf über `POST /api/ideas/develop`, der Bridge antwortet auf `/v1/storyboard` gegen `storyboardOutputSchema`. Ein Develop-Lauf hält die Idea über `developRunId`; startet ein zweiter Lauf, wird das Ergebnis des ersten verworfen.
Nicht: "Skript", "Outline", "Shotlist".

**Prognose**
Was eine Idea vor der Produktion wahrscheinlich bringt, gespeichert als `forecast` an der Idea (`Forecast` in `lib/contracts.ts`) und geschrieben vom Develop-Lauf neben dem Storyboard. Vier Teile: Reichweiten-Spanne (`range`, Plays des schwächsten und stärksten vergleichbaren Reels), Potenzial (`potential`: `low`, `medium`, `high` nach dem Median-Outlier der Vergleichsreels, Grenzen `FORECAST_MEDIUM_OUTLIER` 3 und `FORECAST_HIGH_OUTLIER` 5), größtes Risiko (`risk`) und Spannung (`tension`, die Frage, die das Reel auflöst). Der Bridge schätzt keine Zahl: er nennt im Feld `forecast.comparable` die Titel der Reels aus dem Evidenzpaket, die er für vergleichbar hält, und `deriveForecast` (`lib/forecast.ts`) rechnet Spanne und Potenzial aus genau diesen Reels; Titel, die das Paket nicht führt, fallen weg wie ein Beleg (gemeinsame Funktion `citedEvidence` in `lib/strategy-evidence.ts`), die Anzahl der Treffer steht als `comparableCount` an der Prognose. Unter `FORECAST_MIN_COMPARABLE` (2) Vergleichsreels sind `range` und `potential` null, und die UI zeigt "No forecast", Risiko und Spannung bleiben stehen. Eine Bridge-Antwort ohne brauchbares `forecast`-Feld erzeugt das Storyboard trotzdem, die Idea trägt dann keine Prognose und die UI sagt auch das ("No forecast: the bridge answered without one"). Ideen-Liste zeigt die Spanne als Zeile unter dem Titel, das aufgeklappte Storyboard dazu Risiko und Spannung.
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
