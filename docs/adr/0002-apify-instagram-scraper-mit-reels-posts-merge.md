# ADR-0002: Apify Instagram-Scraper mit Reels+Posts-Merge

Status: akzeptiert, 2026-08-24

## Kontext

Instagram bietet keine öffentliche API für fremde Accounts. Für Backfill und Delta-Refresh braucht Signal Room eine Quelle für Plays, Likes, Comments, Caption und Thumbnail je Beitrag sowie die Follower-Zahl des Creators. Eigenes Scraping wäre wartungsintensiv und rechtlich wie technisch fragil. Bei Tests zeigte sich: `resultsType: "posts"` liefert bei vielen Accounts nur den Grid-Tab ohne Reels, `resultsType: "reels"` liefert keine Bild-Beiträge.

## Entscheidung

Datenquelle ist Apify, serverseitig über `APIFY_TOKEN`:

- `apify/instagram-profile-scraper` löst den Creator auf (Follower, Name, Avatar) einmal beim Add. Ein wöchentlicher Follower-Refresh ist geplant, nicht umgesetzt.
- `apify/instagram-scraper` holt Beiträge. `collectForCreator` ruft den Actor zweimal (`reels` und `posts`) und merged nach `shortCode`, damit der Korpus vollständig ist.
- `onlyPostsNewerThan` steuert Backfill (`BACKFILL_DAYS`) und Delta-Refresh (`lastCheckedAt`). `MAX_RESULTS_PER_CREATOR` deckelt die Kosten.

## Konsequenzen

- Jeder Lauf kostet zwei Actor-Runs pro Creator. Delta-Refresh muss deutlich unter 10 % des Backfills bleiben (SPEC T3.5), ein Kosten-Guard begrenzt die Creators pro Run (T3.6).
- `plays` kommt aus `videoPlayCount`, `views` aus `videoViewCount`; der Scorer nimmt `plays` und fällt auf `views` zurück. Bild-Posts haben weder Plays noch Views, ihr Outlier ist deshalb 0. Outlier-Aussagen gelten nur für Reels.
- Bei Rate-Limits ist `apify/instagram-reel-scraper` der Ausweichkandidat. Das Mapping auf `SignalRecord` bleibt dann gleich.
- Apify-Datenformate können sich ändern; `mapPost` ist der einzige Ort, der Actor-Felder kennt.
