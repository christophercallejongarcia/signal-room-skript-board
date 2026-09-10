# Herkunft und Lizenzen

Dieser Skill leitet Struktur-Muster aus drei quelloffenen Regelsammlungen ab. Alle drei stehen unter der MIT-Lizenz. Die deutschen Muster, die Wortlisten, die Falsch-Positiv-Regeln und das Lint-Script sind eigene Arbeit.

## Verwendete Quellen

**petergyang/no-ai-slop** — MIT, Copyright (c) 2026 Peter Yang
Übernommen: 18 Struktur-Muster, der Portabilitäts-Test, das Prinzip der minimalen wirksamen Änderung, die Trennung in Prüf- und Umschreib-Modus, die Idee der Selbstprüfung nach dem Rewrite (eval.md).

**blader/humanizer** — MIT, Copyright (c) 2025 Siqi Chen
Basiert selbst auf der Wikipedia-Seite "Signs of AI writing" (WikiProject AI Cleanup).
Übernommen: mehrere Content-Muster (Bedeutungs-Aufblähung, Partizip-Anhängsel, Kopula-Vermeidung, falsche Spannweiten, Synonym-Rotation), die Falsch-Positiv-Liste als Konzept, die Liste geschützter menschlicher Schreibmerkmale, die Regel dass eine echte Schreibprobe des Autors die Stil-Regeln überstimmt, die Anti-Fabrikations-Regel.

**hardikpandya/stop-slop** — MIT, Copyright (c) 2025 Hardik Pandya
Übernommen: falsche Handlungsträger als eigene Kategorie, Erzähler aus der Distanz, faule Extreme, vage Deklarative.
NICHT übernommen: das pauschale Adverb-Verbot und das Verbot von Wh-Satzanfängen. Beide sind auf Deutsch schädlich, siehe `references/false-positives-de.md`.

## Bewusst nicht verwendet

**kierstenicy452/anti-ai-writing** — nicht verwendet.

Das Repo ist ein Klon des legitimen `avectats7/anti-ai-writing` von Tato Polanco, versehen mit einem Windows-Payload. Geprüft am 2026-08-09: Das ZIP unter `references/anti_ai_writing_3.3.zip` enthält `binc.exe`, `lua51.dll`, obfuskierten Lua-Bytecode und eine `Application.cmd`. Die README weist an, die Windows-Sicherheitswarnung wegzuklicken und bei Problemen den Virenscanner zu deaktivieren. Die mitgelieferte `llms.txt` nennt noch den echten Autor, was den Diebstahl belegt. Ein einziger Commit von einem Account ohne Historie.

Der Ruleset im Original-Repo `avectats7/anti-ai-writing` ist unbedenklich. Auf Wunsch von Chris wurde auf beides verzichtet.

## MIT-Lizenztext

Die drei Quellen stehen unter der MIT-Lizenz. Sie erlaubt Nutzung, Änderung und Weitergabe unter Beibehaltung des Copyright-Vermerks. Die Vermerke stehen oben.

Dieser Skill wird nicht weitergegeben, er läuft lokal in Chris' Setup.
