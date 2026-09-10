# Wortlisten Deutsch

Maschinell prüfbare Oberflächenformen. Das Script `scripts/slop-lint.sh` prüft die Listen aus Stufe 1 und 2 automatisch. Stufe 3 braucht Urteil.

Regel für alle Listen: ein Wort auf dieser Liste ist nicht verboten, es ist begründungspflichtig. Wenn der Satz nach dem Streichen des Wortes gleich viel aussagt, war es ein Fingerabdruck.

---

## Stufe 1: Harte Treffer

Diese Wörter sind in deutschem Fachtext fast immer Füllmaterial. Ersetzen oder streichen.

**Adjektive**
nahtlos, robust, ganzheitlich, wegweisend, bahnbrechend, revolutionär, disruptiv, facettenreich, vielschichtig, tiefgreifend, weitreichend, maßgeblich, essenziell, elementar, unerlässlich, beeindruckend, atemberaubend, erstklassig, hochmodern, zukunftsweisend, innovativ (als Füllwort), dynamisch (als Füllwort), umfassend (als Füllwort)

**Verben**
befähigen, entfesseln, freisetzen, revolutionieren, transformieren, optimieren (wenn "verbessern" passt), maximieren, katalysieren, orchestrieren (außer bei echter Orchestrierung), eintauchen in, ausschöpfen, vorantreiben, beflügeln

**Substantive**
Mehrwert, Synergie, Potenzial (als Floskel), Rahmenwerk, Ökosystem (abstrakt), Landschaft (abstrakt, etwa "die Marketing-Landschaft"), Leuchtturm (figurativ), Aushängeschild, Meilenstein (figurativ), Game-Changer, Gamechanger, Quantensprung, Paradigmenwechsel, Zeugnis (als "ein Zeugnis für")

**Anglizismen im deutschen Fließtext**
State of the Art, Best Practice (als Floskel), Deep Dive, Next Level, Must-have, Gamechanger, seamless, robust (englisch eingestreut)

---

## Stufe 2: Phrasen

**Vage Einstiege**
in der heutigen schnelllebigen Welt, in Zeiten von, im Zeitalter der, mehr denn je, in den letzten Jahren, angesichts der zunehmenden, vor dem Hintergrund, in einer Welt, in der

**Abschwächer und Füller**
es sei angemerkt, es ist wichtig zu betonen, es lohnt sich zu erwähnen, gilt es zu beachten, sei an dieser Stelle gesagt, wie bereits erwähnt, es versteht sich von selbst, nicht zu vergessen, an dieser Stelle

**Übergänge**
darüber hinaus, des Weiteren, zudem, ferner, nicht zuletzt, abschließend, in diesem Zusammenhang, vor diesem Hintergrund, im Umkehrschluss, letztlich

**Schluss-Formeln**
Fazit, unterm Strich, am Ende des Tages, letztendlich, zusammengefasst, alles in allem, kurzum, im Endeffekt

**Schmeichel-Opener**
Großartige Frage, Sehr gute Frage, Absolut, Gerne, Klar, Sehr gerne, Das ist ein spannender Punkt, Da hast du völlig recht

**Räusper-Opener**
Hier ist die Sache, Lass mich ehrlich sein, Ich sag's mal so, mal ganz offen, die unbequeme Wahrheit ist, ehrlich gesagt (wenn Floskel)

**Pseudo-Insider**
was die meisten übersehen, was dir niemand sagt, was 99% falsch machen, der Teil, den alle überspringen, das verschweigt dir jeder, der Fehler, den fast alle machen

**Schwammige Zuschreibung**
Experten sagen, Experten sind sich einig, Studien zeigen, Untersuchungen belegen, Branchenberichte deuten darauf hin, viele argumentieren, es gilt als, gemeinhin bekannt, allgemein anerkannt

**Kopula-Vermeidung**
dient als, fungiert als, stellt dar, bildet die Grundlage für, verfügt über, zeichnet sich aus durch, findet Anwendung in, kommt zum Einsatz, stellt sicher, dass

**Bedeutungs-Aufblähung**
markiert einen Wendepunkt, ist ein Beleg für, spielt eine zentrale Rolle, spielt eine entscheidende Rolle, unterstreicht die Bedeutung, setzt neue Maßstäbe, festigt seine Position, ebnet den Weg, hebt auf ein neues Level

**Partizip-Anhängsel**
und unterstreicht damit, und zeigt so, und verdeutlicht, und spiegelt wider, und trägt bei zu, womit deutlich wird, wodurch sichergestellt wird

**Falsche Handlungsträger**
die Daten zeigen uns, die Zahlen erzählen, der Markt verlangt, die Technologie ermöglicht, die Entscheidung entstand, das System versteht, der Algorithmus entscheidet sich

---

## Stufe 3: Kontextabhängig

Nur flaggen, wenn das Wort im konkreten Satz nichts trägt. Kein Automatik-Treffer.

**Abtönende Adverbien**
grundsätzlich, im Wesentlichen, im Grunde, prinzipiell, gewissermaßen, quasi, sozusagen, letztendlich, schlichtweg, durchaus, überaus, äußerst

**Hedges**
könnte, vielleicht, möglicherweise, unter Umständen, tendenziell, in gewisser Weise, relativ, eher

Regel aus Chris' CLAUDE.md: maximal ein Hedge pro Satz, und nur wenn er ehrlich ist. Wenn du es weißt, sag es. Wenn nicht, sag "ich weiß es nicht".

---

## Regex-Bausteine

Für `slop-lint.sh` und für den Hook. Alle case-insensitive, Wortgrenzen beachtet.

```
Gedankenstrich:        [—–]
Doppelpunkt-Enthüllung: [a-zäöüß]{3,}:\s+[a-zäöüß]
Binärer Kontrast:      (nicht nur .{1,40} sondern|es geht nicht um .{1,40}(,| ) es geht|die frage ist nicht)
Dreier-Regel:          \b\w+,\s+\w+\s+und\s+\w+\b
Formelhafter Übergang: ^(darüber hinaus|des weiteren|zudem|ferner|nicht zuletzt|abschließend)
Schluss-Formel:        \b(fazit|unterm strich|am ende des tages|letztendlich|zusammengefasst)\b
```

Der Dreier-Regel-Regex hat eine hohe Falsch-Positiv-Rate und läuft deshalb nur im Warn-Modus, nie im Block-Modus.

---

## Was NICHT auf diese Liste gehört

Siehe `false-positives-de.md`. Besonders wichtig: Modalpartikeln, Bindestrich-Komposita und die Wortstellung im Nebensatz. Die englischen Vorlagen liefern dort Regeln, die deutschen Text aktiv verschlechtern.
