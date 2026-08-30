# ADR-0004: Codex SDK für Text und Bilder über den lokalen Bridge

Status: akzeptiert, 2026-08-24. Ersetzt die offene Entscheidung "Claude Agent SDK für Text" in `docs/SPEC.md` (T5.1).

## Kontext

Die KI-Schicht erzeugt Ideas (Angle, Rationale, Opening), Hook-Varianten, Storyboards und später Cover-Bilder. Die Spec sah das Claude Agent SDK für Text und Codex nur für Bilder vor. Das hätte zwei Provider, zwei Auth-Pfade und zwei Prompt-Stile bedeutet. Chris hat ein Codex-Abo; das Codex SDK (`@openai/codex-sdk`) nutzt den lokalen Login-Kontext und braucht keinen API-Key. Der Starter bringt bereits einen lokalen Bridge (`bridge/server.mjs`) mit Schema-Validierung und Origin-Allowlist mit.

## Entscheidung

Ein Provider für Text und Bilder: Codex SDK, aufgerufen ausschließlich vom lokalen Bridge. Die Web-App spricht nur `NEXT_PUBLIC_STRATEGY_BRIDGE_URL` an, nie einen Modell-Endpunkt. Auth läuft über die Codex-Subscription des eingeloggten Nutzers, kein API-Key in `.env`.

Die Evidenz für Strategy-Anfragen sind echte Top-Outlier-Reels aus dem Korpus (Ticket 07), nicht Demo-Fixtures. Antworten sind Deutsch und benutzen die Begriffe aus `CONTEXT.md`.

## Konsequenzen

- Die App funktioniert nur mit laufendem Bridge und eingeloggtem Codex. Eine Statusanzeige (erreichbar / nicht erreichbar / nicht eingeloggt) ist geplant, Ticket 07.
- Kein Server-Deployment der KI-Schicht; der Bridge bleibt auf localhost. Vercel-Cron kann keine Ideas erzeugen, nur Refreshes anstoßen.
- Ein Provider-Wechsel (Claude, Gemini für Bilder) wäre nur im Bridge nötig, ist aber nicht geplant und hat keinen Schalter im Code.
- Der Bridge-Vertrag ist die einzige Kopplung. Er hat Text-Routen für `POST /v1/strategy` (`strategyOutputSchema`, `validateStrategyRequest`) und `POST /v1/storyboard` (`storyboardOutputSchema`, `validateStoryboardRequest`) sowie `POST /v1/covers` (`coverOutputSchema`, `validateCoverRequest`). Der Cover-Lauf erzeugt drei strukturierte Package-Beschreibungen und rendert sie einzeln über die aktivierte GPT-Image-Funktion in einer isolierten temporären Workspace-Umgebung. Die Web-App erhält nur validierte Bytes und speichert sie in `data/covers/ideas/`; der lokale Bridge bleibt die einzige Stelle mit Codex-Zugriff.
- Den Storyboard-Lauf stösst die Server-Route `POST /api/ideas/develop` an, nicht der Browser, damit der Anspruch auf die Idea (`developRunId`) und der Bridge-Aufruf in einer Transaktion zusammenliegen. Seit Ticket 21 verlangt `storyboardOutputSchema` zusätzlich `forecast` (vergleichbare Paket-Titel, Risiko, Spannung); die Spanne rechnet die App in `lib/forecast.ts` aus den genannten Reels, und eine Antwort ohne brauchbares Prognose-Feld lässt das Storyboard trotzdem entstehen. Die Regel aus der Entscheidung bleibt: der einzige Modell-Aufruf steckt im Bridge, und die App kennt nur `STRATEGY_BRIDGE_URL` (`lib/config.ts`).
