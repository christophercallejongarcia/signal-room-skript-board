# ADR-0003: Outlier-Definition

Status: akzeptiert, 2026-08-24

## Kontext

Die Kernfrage der App ist: Welche Reels laufen deutlich besser, als die Größe des Accounts erwarten lässt? Absolute Plays bevorzugen große Accounts, Engagement-Raten belohnen Nischen-Posts mit wenig Reichweite. Der Demo-Scorer des Starters kombinierte vier Faktoren zu einer Punktzahl, die niemand erklären konnte. Gewünscht ist ein einzelner Faktor wie "5.2x", der ohne Erklärung lesbar ist.

## Entscheidung

Zwei erklärbare Kennzahlen, beide in `lib/adapters/scoring/outlier.ts` (Wortlaut der Begriffe in `CONTEXT.md`):

- Outlier = `plays / audience` (Fallback `views`). 5.0 bedeutet fünfmal so viele Plays wie Follower. Das ist die Primärsortierung in Discover.
- Channel-Relative = `plays / median(plays)` über den gehaltenen Korpus desselben Creators. Zeigt, ob ein Reel über der eigenen Baseline liegt.

Die Schwelle `OUTLIER_THRESHOLD = 2` steht in `lib/config.ts`. Ab 2.0 gilt ein Signal als Outlier, bekommt das Badge und zählt im Stat-Block "2x+ outliers". Der zusätzliche `score` dient nur als Tiebreaker.

## Konsequenzen

- Jede Zahl in der UI ist mit einem Satz erklärbar. `describeOutlier` liefert diesen Satz.
- Follower-Zahl ist Pflicht; ohne `audience > 0` ist der Outlier 0. Follower werden bisher nur beim Add gesetzt; ohne den geplanten wöchentlichen Refresh driftet der Faktor bei wachsenden Accounts.
- Der Median hängt vom gehaltenen Korpus ab (90 Tage, max. 150 Beiträge). Kleiner Korpus, schwacher Median.
- Der Demo-Scorer bleibt für den YouTube-Pfad und die Demo-Daten erhalten, wird aber nicht weiterentwickelt.
