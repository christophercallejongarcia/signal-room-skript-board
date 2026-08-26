# ADR-0006: Dieses Repo ist ein privates Produkt, kein Clean-Room-Starter

Status: akzeptiert, 2026-08-26. Ersetzt das Clean-Room-Versprechen in `README.md`, `AGENTS.md` und `docs/SECURITY.md`. Löst Ticket 17 der Signal-Room-Instagram-Spec.

## Kontext

Das öffentliche Repo `github.com/earlyaidopters/signal-room-starter` steht bei Commit `37deeb0` und ist ein echter Clean-Room-Starter: synthetische Demo-Daten, Contracts, Bridge, Doku, Diagramme. Kein Convex, kein Connector, keine echten Handles.

Der lokale `main` ist inzwischen zwölf Commits voraus und enthält etwas anderes: Convex-Backend, Apify-Instagram-Connector, Cover-Cache, Delta-Refresh mit Run-Log, Strategy-Provider über den Codex-Bridge und die Ideas-Tabelle. Dazu `docs/SPEC.md` mit echten Referenz-Accounts und `CONTEXT.md`, das durchgehend auf eine bestimmte Nische geschrieben ist. ADR-0004 setzt eine persönliche Codex-Subscription voraus, die Positionierung des Strategy-Providers steht in `.env.local`, das Convex-Deployment gehört einer Person.

Das Repo hat die Grenze also durch den Bau überschritten, nicht durch ein Versehen. Die Doku behauptete weiter das Gegenteil.

Geprüft wurde vorher, ob etwas ausgetreten ist: nein. Die Live-Screenshots mit echten Gesichtern liegen nur in zwei lokalen WIP-Checkpoints, die auf keinem Remote erreichbar sind. `.scratch/`, `data/store.json`, `data/covers`, `.env.local` und `reviews/` sind gitignored, die Watchlist und der Korpus waren nie in Git. Die Handles in `lib/demo-data.ts` sind erfunden.

## Entscheidung

Dieses Repo ist ab hier ein privates Produkt. Das Clean-Room-Versprechen entfällt.

Das öffentliche Repo bleibt bei `37deeb0` stehen. Es hält sein Versprechen weiter, weil nichts aus den zwölf Commits dorthin geht. Wer den Starter will, bekommt genau das, was dort steht.

Die Release-Checkliste in `docs/SECURITY.md` gilt nicht mehr, weil dieses Repo nicht veröffentlicht wird. Sie bleibt als Text stehen, für den Fall, dass später doch ein Teil ausgekoppelt wird, ist aber als nicht zutreffend markiert.

## Konsequenzen

- `origin` zeigt weiter auf das öffentliche Repo. Ein `git push` würde das ganze Produkt veröffentlichen. Bis ein privates Remote eingerichtet ist, ist die Push-URL von `origin` bewusst auf einen ungültigen Wert gesetzt, damit ein Push laut fehlschlägt statt still durchzugehen.
- Echte Handles, echte Screenshots und die eigene Positionierung dürfen ab jetzt im Repo liegen. Was weiter draußen bleibt: Tokens, Cookies, Session-Material und alles aus `.env.local`. Diese Regeln stehen unverändert in `AGENTS.md`.
- Ein Auskoppeln generischer Teile in den öffentlichen Starter ist weiter möglich, aber dann bewusst als Cherry-Pick und mit der Release-Checkliste, nicht als Nebenwirkung eines Pushes.
