# Was NICHT geflaggt wird

Diese Datei ist so wichtig wie der Pattern-Katalog. Ein Anti-Slop-Werkzeug, das zu viel flaggt, macht Text schlechter statt besser, und es verliert das Vertrauen des Nutzers nach dem dritten Fehlalarm.

Die Idee stammt aus `blader/humanizer`, das als einziges der Vorlagen eine Falsch-Positiv-Liste führt. Die deutschen Fälle sind eigene Arbeit und teilweise das genaue Gegenteil der englischen Regeln.

---

## Deutsche Sprachmerkmale, die keine Tells sind

### Modalpartikeln bleiben

doch, halt, eben, ja, mal, schon, wohl, denn, eigentlich, einfach

Das ist der wichtigste Punkt der ganzen Datei. `hardikpandya/stop-slop` verlangt, alle Adverbien zu streichen. Auf Englisch funktioniert das halbwegs, weil die -ly-Endung sie markiert. Auf Deutsch ist es schädlich. Modalpartikeln sind der stärkste Marker für gesprochene, menschliche Sprache. Eine KI setzt sie zu selten, nicht zu oft.

"Das läuft halt nicht." ist menschlicher als "Das läuft nicht."

Niemals streichen, außer sie stapeln sich (drei in einem Satz).

### Bindestrich-Komposita bleiben

KI-Betriebssystem, Makler-OS, Anti-Slop-Katalog, Content-Kette, Voice-Anker

Die englische Regel gegen "go-to-market" gilt im Deutschen nicht. Zusammensetzungen mit Bindestrich sind orthografisch korrekt und oft die einzig lesbare Form.

### Lange Sätze bleiben

Deutsche Fachsprache verträgt Sätze, die auf Englisch zerlegt würden. Ein Satz mit einem Nebensatz und einer Aufzählung ist kein Tell. Erst wenn drei Nebensätze ineinander stecken, wird es ein Lesbarkeitsproblem, und das ist eine andere Kategorie als KI-Sprech.

### Wortwiederholung bleibt

Im Deutschen ist es korrekt und klar, dasselbe Ding immer gleich zu benennen. Die Synonym-Rotation aus SD-21 ist genau deshalb ein Tell. Wiederholung nicht als Stilfehler behandeln.

### Passiv in Fachtexten bleibt

Deutsche technische und juristische Texte nutzen Passiv legitim. Nur flaggen, wenn der Akteur unterschlagen wird und relevant wäre ("Es wurde entschieden" ohne wer).

### Verbklammer und Nebensatz-Endstellung bleiben

Das ist deutsche Grammatik, kein Stil.

### Umlaute und ß bleiben

Selbstverständlich. Chris' Regel Nummer eins. Ein Anti-Slop-Lauf darf niemals ä zu ae machen.

---

## Chris-spezifische Ausnahmen

### ALL CAPS zur Betonung bei LinkedIn

`outreach/voice/feedback_linkedin_emphasis.md` schreibt ALL CAPS statt Markdown-Fettdruck vor, weil LinkedIn kein Markdown rendert. Das ist bewusst und wird nicht als Formatierungs-Slop geflaggt.

### Die Voice-Files schlagen diesen Katalog

Aus `humanizer` übernommen: eine echte Schreibprobe des Autors überstimmt die Stil-Regeln.

Bei Texten für LinkedIn, Kommentare und DMs gilt `outreach/voice/` als Autorität. Wenn eine Regel dort einer Regel hier widerspricht, gewinnt `outreach/voice/`. Nicht diskutieren, nicht beide anwenden.

Bei allen anderen Textsorten gilt dieser Katalog.

### Zitate bleiben unangetastet

Wenn ein Text ein Zitat enthält, das als Zitat gekennzeichnet und einer Person oder Quelle zugeordnet ist, bleibt es wörtlich stehen. KI-Tells in einem echten Zitat gehören zum Zitat. Im Befund erwähnen, nicht ändern.

Das gilt besonders für Chris' Arbeit mit Transkripten, Kurs-Material und geclippten Artikeln.

### Code wird nicht angefasst

Keine Variablennamen, keine Strings, keine Kommentare in Code-Blöcken. Andere Konventionen.

### Fachbegriffe bleiben

Manche Wörter auf der Bannliste haben echte Fachbedeutung. "Framework" für ein benanntes Software-Framework. "Orchestrierung" für echte Agenten-Orchestrierung. "Ökosystem" für ein tatsächliches Software-Ökosystem. Die Liste bannt sie als Füllwort, nicht als Fachbegriff.

Test: Sagt das Wort etwas Überprüfbares? Dann bleibt es.

---

## Merkmale menschlichen Schreibens, die geschützt werden

Aus `humanizer` übernommen und ins Deutsche übertragen. Diese Dinge sehen für ein naives Prüfwerkzeug nach Fehlern aus. Sie sind das Gegenteil.

Ungleichmäßiger Rhythmus. Ein sehr kurzer Satz nach einem langen.

Abschweifungen und Einschübe, die etwas über den Autor verraten.

Zugegebene Unsicherheit. "Ich weiß nicht, ob das skaliert."

Meinungen und Härte. "Das ist Unsinn." Nicht in "das erscheint fragwürdig" abmildern.

Humor, Ironie, Selbstunterbrechung.

Unregelmäßige Absatzlängen. Ein Ein-Satz-Absatz ist erlaubt.

Konkrete, unrunde Zahlen. "Vier Stunden pro Woche" schlägt "erhebliche Zeitersparnis". Niemals eine konkrete Angabe zu einer allgemeinen glattbügeln.

Fachjargon, den die Zielgruppe wirklich spricht.

---

## Die harte Grenze

Beim Umschreiben darf keine Tatsache erfunden werden. Keine Zahl, kein Name, kein Datum, kein Zitat, keine Quelle, die nicht im Ausgangstext oder vom Nutzer kommt.

Wenn ein Satz eine konkrete Angabe bräuchte, um zu funktionieren, dann nachfragen oder die schlichte Variante ohne die Angabe schreiben. Niemals erfinden, damit der Satz besser klingt.

Das ist die häufigste Art, wie ein Anti-Slop-Lauf Schaden anrichtet: Er ersetzt eine vage Behauptung durch eine konkrete, die schön klingt und falsch ist.
