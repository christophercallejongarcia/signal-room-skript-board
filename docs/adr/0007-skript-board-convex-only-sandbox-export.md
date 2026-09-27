# ADR-0007: Skript-Board mit Convex-only, Zugriffsschutz, Engine-Sandbox und Export per Klick

Status: akzeptiert, 2026-09-27

## Kontext

Das Skript-Board (Route `/board`, Plan in `PLAN.md`) ist ein Canvas mit Quellen, Kontextkanten und Chat. Chris baut dort ab Video 2 Skripte aus YouTube-Outliern, Playbooks und eigenen Notizen. Mehrere Punkte passen nicht zu den bisherigen Entscheidungen:

- ADR-0005 verlangt, dass neue Features auch im Datei-Store laufen. Ein Board mit Nodes, Kanten, Unterhaltungen und Lauf-Journalen lässt sich im Datei-Store nicht ohne Datenverlust betreiben.
- Das Glossar sagt über das Skript: "Der Text wird im Store gehalten und nie in den Vault oder in Git geschrieben." Das Board soll aber `skript.md` und `beats.md` nach `YT-OS/videos/<video>/` schreiben.
- Die Board-Engines (Claude Code, Codex, Command Code) lesen untrusted Transkripte. Ohne Isolation könnte ein eingeschleustes Transkript private Dateien lesen oder Chris' Skills, Sitzungen und Erinnerungen mitschicken.
- Das Cloud-Dev-Deployment teilen sich mehrere Worktrees. Ein Board-Branch, der dort Schema pusht, würde andere Arbeit stören.

## Entscheidung

1. **Convex-only:** Das Board speichert ausschließlich in Convex. Ohne `NEXT_PUBLIC_CONVEX_URL` zeigt `/board` "Board braucht Convex" statt Demo-Daten. Das ist eine bewusste Ausnahme von ADR-0005. Die Board-Tabellen stehen in `convex/boardSchema.ts` und kommen per Spread additiv in `convex/schema.ts`. Das Board nutzt einen eigenen Adapter (`lib/board/store.ts`), der `StorageAdapter` bleibt unverändert.
2. **Zugriffsschutz:** Next läuft für das Board nur auf `127.0.0.1` (`npm run dev:board`). `proxy.ts` prüft für `/board/*` und `/api/board/*` den `Host` (DNS-Rebinding), eine lokale Sitzung (`board_session`, HMAC), CSRF-Header und `Origin` und setzt eine CSP ohne fremde Bilder, Frames und Verbindungen. Die Board-Routen der Bridge verlangen `x-board-bridge-token`, alle Board-Funktionen in Convex einen `token` gegen `BOARD_ACCESS_TOKEN`.
3. **Lokale Entwicklung, Integration mit einem Owner:** Der Board-Branch entwickelt nur gegen eine lokale Convex-Deployment im eigenen Worktree (`CONVEX_DEPLOYMENT` beginnt mit `local:` oder `anonymous:`, geprüft von `scripts/board/env.mjs` vor jedem Convex-Aufruf). Ins gemeinsame Cloud-Deployment kommen die Board-Tabellen erst nach dem Merge nach `main`, und nur der Hauptordner pusht sie. Andere Worktrees rebasen vor ihrem nächsten `convex dev`. Boards aus der lokalen Entwicklung werden nicht migriert.
4. **Engine-Sandbox:** Jede Engine startet über `sandbox-exec` mit einem eigenen Profil (`bridge/engines/*.sb`). `$HOME` und die Temp-Bereiche sind gesperrt, freigegeben sind nur die Dateien aus dem Sandbox-Spike (`.scratch/skript-board/research/05-sandbox-spike.md`). Zusätzlich laufen die Engines ohne Werkzeuge, ohne Sitzungen und ohne Nutzer-Konfiguration. Eine Engine ist nur aktiv, wenn sie in `BOARD_ENGINES_ENABLED` steht und `npm run board:gate` für genau ihre Version und genau ihr Profil bestanden hat.
5. **Export per Klick:** Board-Texte sind keine Skripte der Tabelle `scripts`. Der Glossar-Eintrag "Skript" bleibt gültig. Das Board schreibt `skript.md` und `beats.md` nur nach einem bewussten Export-Klick mit Vorschau, nur in `YTOS_ROOT/videos/<video>/` und nur diese zwei Dateien. Der Export committet nichts.

## Konsequenzen

- Ohne laufende Convex-Deployment ist das Board nicht nutzbar, auch nicht zum Ansehen.
- Neue Engine-Versionen schalten die Engine ab, bis das Gate erneut besteht. Command Code aktualisiert sich womöglich selbst und fällt dann bis zum nächsten Gate weg.
- `sandbox-exec` ist von Apple als veraltet markiert. Fällt es weg, schaltet das Gate die Engines ab, statt sie ungeschützt laufen zu lassen.
- `convex/convex.config.ts` bekommt die Variable `BOARD_ACCESS_TOKEN`. Das ist eine weitere additive Änderung außerhalb der Board-Dateien.
- Export nach YT-OS berührt ein öffentliches Repo. Er schreibt nur Dateien, Commit und Push bleiben bei Chris.
- Die lokale Convex-Backend bindet an alle Schnittstellen (`*:3410`), die Convex-CLI hat dafür keine Option. Die Board-Funktionen verlangen deshalb immer `BOARD_ACCESS_TOKEN`, auch lokal. Next und Bridge lauschen nur auf `127.0.0.1`.
