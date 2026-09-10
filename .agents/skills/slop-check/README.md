# Lektorat-Regeln für Signal Room

Versionierte Laufzeitkopie des lokalen `slop-check`-Regelpakets, Stand 10. September 2026. Enthält das Regex-Script und die drei Regeldateien, die `buildScriptLintPrompt` benötigt. Herkunft: `ATTRIBUTION.md`.

Die Bridge lädt diese Dateien direkt aus dem Repository. Ein frischer Checkout und GitHub CI benötigen keine persönliche Skill-Installation. Das Script liest den zu prüfenden Text über stdin und benötigt Bash, awk, grep und sed. Es führt keine Netzwerkaufrufe aus.

Aktualisierungen dieser Kopie werden mit dem Code versioniert und durch `tests/bridge-script-lint.test.mjs` geprüft. `SLOP_CHECK_SKILL_PATH` bleibt ein expliziter Override für eine andere Installation.
