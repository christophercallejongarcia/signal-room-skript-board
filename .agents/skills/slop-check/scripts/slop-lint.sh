#!/usr/bin/env bash
# slop-lint.sh — deterministische Stufe des slop-check-Skills.
#
# Findet die maschinell erkennbaren KI-Tells in deutschem Text.
# Struktur-Muster ohne feste Oberflaechenform findet dieses Script NICHT,
# dafuer ist die Modell-Stufe im SKILL.md zustaendig.
#
# Aufruf:
#   slop-lint.sh datei.md
#   cat datei.md | slop-lint.sh
#   slop-lint.sh --block datei.md    # nur harte Treffer, Exit 2 bei Fund (fuer Hooks)
#   slop-lint.sh --quiet datei.md    # nur die Zusammenfassung
#
# Exit-Codes: 0 sauber, 1 Treffer gefunden, 2 harter Treffer im --block-Modus.
#
# Code-Bloecke (``` ... ```) und Frontmatter werden uebersprungen.

set -uo pipefail
export LC_ALL=en_US.UTF-8

BLOCK=0
QUIET=0
FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --block) BLOCK=1; shift ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) FILE="$1"; shift ;;
  esac
done

if [ -n "$FILE" ]; then
  [ -r "$FILE" ] || { echo "slop-lint: Datei nicht lesbar: $FILE" >&2; exit 3; }
  RAW=$(cat -- "$FILE")
  # Fremdmaterial nicht pruefen. Swipe-Files und Referenzsammlungen enthalten
  # zitierte Posts anderer Leute. Deren Tells gehoeren zum Zitat.
  if printf '%s\n' "$RAW" | head -12 | grep -qiE '^(type: *(swipe-file|reference)|status: *reference)'; then
    printf 'slop-lint: uebersprungen (Fremdmaterial laut Frontmatter): %s\n' "$FILE"
    exit 0
  fi
else
  RAW=$(cat)
fi

# Code-Fences und YAML-Frontmatter ausblenden, Zeilennummern erhalten.
TEXT=$(printf '%s\n' "$RAW" | awk '
  BEGIN { fence=0; fm=0 }
  NR==1 && $0=="---" { fm=1; print ""; next }
  fm==1 && $0=="---" { fm=0; print ""; next }
  fm==1 { print ""; next }
  /^[[:space:]]*```/ { fence=!fence; print ""; next }
  fence==1 { print ""; next }
  { print }
')

# Zweite Fassung ohne Listen, Ueberschriften, Zitate und "Label:"-Zeilen.
# Nur fuer Muster, bei denen ein Doppelpunkt als Beschriftung legitim ist.
PROSE=$(printf '%s\n' "$TEXT" | awk '
  /^[[:space:]]*([-*+>]|[0-9]+\.)[[:space:]]/ { print ""; next }
  /^[[:space:]]*#/ { print ""; next }
  /^[[:space:]]*[A-Za-zÄÖÜäöüß0-9_\/-]+[[:space:]]*:/ { print ""; next }
  { print }
')

HARD=0
SOFT=0
REPORT=""

# scan <ID> <Schwere> <Beschriftung> <erweiterter Regex> [quelle: TEXT|PROSE]
scan() {
  local id="$1" sev="$2" label="$3" re="$4" src="${5:-TEXT}"
  local body hits
  if [ "$src" = "PROSE" ]; then body="$PROSE"; else body="$TEXT"; fi
  hits=$(printf '%s\n' "$body" | grep -n -i -E -- "$re" 2>/dev/null)
  [ -z "$hits" ] && return 0
  local n
  n=$(printf '%s\n' "$hits" | grep -c '')
  if [ "$sev" = "HART" ]; then HARD=$((HARD+n)); else SOFT=$((SOFT+n)); fi
  while IFS= read -r line; do
    local num txt
    num="${line%%:*}"
    txt="${line#*:}"
    txt=$(printf '%s' "$txt" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | cut -c1-100)
    REPORT="${REPORT}${id}  ${sev}  Zeile ${num}  ${label}
    ${txt}
"
  done <<< "$hits"
}

# ── HARTE TREFFER ────────────────────────────────────────────────────────────
# Em-Dash immer. En-Dash nur, wenn er NICHT zwischen Ziffern steht,
# denn "0:06-0:25" und "2019-2021" sind korrekte Bis-Striche, kein Tell.
scan "SD-28" "HART" "Gedankenstrich" '—|(^|[^0-9])–|–($|[^0-9])'

scan "SD-16" "HART" "KI-Vokabular" '\b(nahtlos|robust(e[nmrs]?)?|ganzheitlich|wegweisend|bahnbrechend|revolutionär|disruptiv|facettenreich|tiefgreifend|maßgeblich|essenziell|unerlässlich|atemberaubend|hochmodern|zukunftsweisend|befähig|entfessel|freisetz|revolutionier|katalysier|eintauchen in|ausschöpfen|beflügel|Mehrwert|Synergie|Rahmenwerk|Quantensprung|Paradigmenwechsel|Game-?[Cc]hanger|State of the Art|Next Level|Deep Dive)'

scan "SD-17" "HART" "Kopula-Vermeidung" '\b(dient als|fungiert als|stellt .{0,20}dar\b|bildet die Grundlage|verfügt über|zeichnet sich aus durch|findet Anwendung|kommt zum Einsatz)'

scan "SD-19" "HART" "Bedeutungs-Aufblähung" '(markiert einen Wendepunkt|ist ein Beleg für|spielt eine (zentrale|entscheidende|wichtige) Rolle|unterstreicht die Bedeutung|setzt neue Maßstäbe|festigt .{0,15}Position|ebnet .{0,25}den Weg|auf ein neues Level)'

scan "SD-18" "HART" "Partizip-Anhängsel" '(und unterstreicht damit|und zeigt so|und verdeutlicht|und spiegelt .{0,15}wider|und trägt .{0,15}bei zu|womit deutlich wird|wodurch sichergestellt)'

scan "SD-22" "HART" "Schwammige Zuschreibung" '(Experten (sagen|sind sich einig|argumentieren)|Studien zeigen|Untersuchungen belegen|Branchenberichte|viele argumentieren|gemeinhin bekannt|es gilt als)'

scan "SD-11" "HART" "Pseudo-Insider-Setup" '(was die meisten übersehen|was dir niemand sagt|was 99 ?% falsch|der Teil, den alle|das verschweigt dir|den fast alle machen)'

scan "SD-10" "HART" "Räusper-Opener" '(hier ist die Sache|lass mich ehrlich sein|ich sag.s mal so|mal ganz offen|die unbequeme Wahrheit)'

scan "SD-12" "HART" "Schluss-Formel" '\b(unterm Strich|am Ende des Tages|letztendlich|zusammengefasst|alles in allem|im Endeffekt)\b'

scan "SD-14" "HART" "Formelhafter Übergang" '(^|\. )(Darüber hinaus|Des Weiteren|Zudem|Ferner|Nicht zuletzt|Abschließend|In diesem Zusammenhang|Vor diesem Hintergrund)\b'

scan "SD-20" "HART" "Vager Einstieg" '(in der heutigen .{0,20}Welt|im Zeitalter der|mehr denn je|in einer Welt, in der|angesichts der zunehmenden)'

scan "SD-15" "HART" "Füll-Floskel" '(es sei angemerkt|es ist wichtig zu betonen|es lohnt sich zu erwähnen|gilt es zu beachten|es versteht sich von selbst|wie bereits erwähnt|an dieser Stelle sei)'

scan "SD-23" "HART" "Falscher Handlungsträger" '(die (Daten|Zahlen) (zeigen uns|erzählen|sprechen)|der Markt verlangt|die Technologie ermöglicht|die Entscheidung entstand)'

scan "UML" "HART" "Ersatzschreibung statt Umlaut" '\b(fuer|ueber|koenn|muess|waehrend|moeglich|groess|strasse|naechst|zurueck|tatsaechlich|verfuegbar|schliesslich)'

# ── WEICHE TREFFER (Urteil noetig) ───────────────────────────────────────────
scan "SD-01" "WEICH" "Binärer Kontrast" '(nicht nur .{1,50} sondern|es geht nicht um .{1,40}, (es geht|sondern)|die Frage ist nicht|das ist kein .{1,30}, das ist)'

scan "SD-02" "WEICH" "Negativ-Aufzählung" '\bKein[e]? [A-ZÄÖÜ][a-zäöüß]+\. ?Kein'

# Nur mitten im Satz nach mindestens drei Woertern, nie bei Beschriftungen.
scan "SD-04" "WEICH" "Doppelpunkt-Enthüllung" '[A-Za-zÄÖÜäöüß]+ +[A-Za-zÄÖÜäöüß,]+ +[A-Za-zÄÖÜäöüß,]+[^:]*[a-zäöüß]{3,}: +[a-zäöüß]' "PROSE"

scan "SD-08" "WEICH" "Rhetorisches Setup" '(was wäre, wenn|denk mal drüber nach|plot twist|und jetzt kommt)'

scan "SD-05" "WEICH" "Mögliche Dreier-Regel" '\b[a-zäöüß]{4,}, [a-zäöüß]{4,} und [a-zäöüß]{4,}\b'

scan "SD-25" "WEICH" "Faules Extrem" '\b(jeder einzelne|ausnahmslos alle|niemals wieder|immer und überall)\b'

scan "SD-27" "WEICH" "Emoji in Überschrift" '^#{1,6} .*[😀-🙏🚀-🛿☀-➿]'

# ── AUSGABE ──────────────────────────────────────────────────────────────────
if [ "$QUIET" -eq 0 ] && [ -n "$REPORT" ]; then
  printf '%s' "$REPORT"
  printf -- '---\n'
fi

printf 'slop-lint: %d harte, %d weiche Treffer' "$HARD" "$SOFT"
[ -n "$FILE" ] && printf ' in %s' "$FILE"
printf '\n'

if [ "$BLOCK" -eq 1 ]; then
  [ "$HARD" -gt 0 ] && exit 2
  exit 0
fi

[ $((HARD+SOFT)) -gt 0 ] && exit 1
exit 0
