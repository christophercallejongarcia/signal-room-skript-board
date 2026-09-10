# Pattern-Katalog Deutsch

28 Muster, die deutschen Text als KI-generiert markieren. Jedes Muster hat eine Kennung, damit der Befund zitierbar ist.

Quellen der Vorlage: `petergyang/no-ai-slop`, `blader/humanizer` (basiert auf Wikipedia "Signs of AI writing"), `hardikpandya/stop-slop`. Alle MIT. Die englischen Wortlisten dieser Repos sind auf Deutsch unbrauchbar, weil sie Oberflächenformen listen. Übernommen wurden die Struktur-Muster, die deutschen Entsprechungen sind eigene Arbeit.

Ordnung nach Trefferwahrscheinlichkeit in deutschem Text, nicht nach Herkunft.

---

## Gruppe A: Satzbau-Muster

### SD-01 Binärer Kontrast

Das häufigste deutsche KI-Muster überhaupt.

Formen: "Nicht X. Sondern Y." / "Es geht nicht um X, es geht um Y." / "Die Frage ist nicht X, sondern Y." / "Das ist kein X, das ist ein Y." / "Nicht nur X, sondern auch Y."

Warum es auffällt: Die Konstruktion erzeugt Bedeutung durch Kontrast statt durch Inhalt. Sie funktioniert bei jedem Thema, was sie inhaltsleer macht.

Vorher:
> Es geht nicht um das Modell. Es geht um den Kontext.

Nachher:
> Der Kontext entscheidet, nicht das Modell.

Fix: Y direkt sagen. Das X wegwerfen. Wenn der Kontrast wirklich trägt, ihn als Vergleich schreiben, nicht als Negation.

### SD-02 Negativ-Aufzählung

Form: "Kein X. Kein Y. Ein Z."

Vorher:
> Kein Tool. Keine Software. Ein Betriebssystem.

Nachher:
> Ein Betriebssystem.

Fix: Nur Z sagen. Die Negationen sind Trommelwirbel.

### SD-03 Nachgestellte Negation

Ein abgehackter Negations-Fetzen am Satzende statt eines echten Nebensatzes.

Vorher:
> Die Optionen kommen aus dem gewählten Eintrag, kein Raten.

Nachher:
> Die Optionen kommen aus dem gewählten Eintrag, der Nutzer muss nicht raten.

Fix: Zum vollständigen Nebensatz ausschreiben oder streichen.

### SD-04 Doppelpunkt-Enthüllung

Nominalphrase, Doppelpunkt, dramatische Auflösung. Steht bereits als eigene Regel in Chris' Memory, hier mit Beispielen.

Vorher:
> Der Punkt, der alles ändert: ein zweiter Agent bewertet das Ergebnis.

Nachher:
> Ein zweiter Agent bewertet das Ergebnis. Das ist der Unterschied.

Fix: Als normalen Satz schreiben. Doppelpunkt nur vor echten Aufzählungen, Zitaten und Beschriftungen.

### SD-05 Dreier-Regel

Drei parallele Glieder, wo zwei oder vier gereicht hätten. Das dritte Glied ist meist Füllmaterial.

Vorher:
> Schneller, günstiger und zuverlässiger.

Nachher:
> Halb so teuer bei gleicher Laufzeit.

Fix: Zählen. Wenn ein Glied nichts Eigenes beiträgt, streichen. Zwei Glieder wirken menschlicher als drei.

### SD-06 Falsche Spannweite

"Von X bis Y", wo X und Y keine gemeinsame Skala bilden.

Vorher:
> Von der ersten Idee bis zum fertigen Kundensystem.

Nachher:
> Von der Idee bis zur Auslieferung. (echte Zeitachse)

Fix: Prüfen, ob X und Y wirklich Endpunkte einer Achse sind. Sonst als Aufzählung schreiben.

### SD-07 Dramatische Fragmentierung

Gestapelte Kurzsätze als Rhythmus-Trick. "Punkt." "Das war's." "Mehr nicht." "Ende."

Vorher:
> Das System läuft. Ohne Eingriff. Jeden Tag. Punkt.

Nachher:
> Das System läuft täglich ohne Eingriff.

Fix: Zu vollständigen Sätzen zusammenziehen. Ein einzelner Kurzsatz zur Betonung ist erlaubt, drei hintereinander sind ein Tell.

### SD-08 Rhetorisches Setup

"Was wäre, wenn ich dir sage", "Denk mal drüber nach:", "Plot Twist:", "Und jetzt kommt's:", selbstbeantwortete Frage-Antwort-Paare.

Vorher:
> Was wäre, wenn dein Büro sich selbst sortiert? Genau das macht ein KI-OS.

Nachher:
> Ein KI-OS sortiert eingehende Anfragen selbst.

Fix: Setup streichen, Aussage stehen lassen.

### SD-09 Aphorismus-Formel

"X ist das Y von Z." "X ist das neue Y."

Vorher:
> Kontext ist das neue Prompting.

Fix: Ersatzlos streichen oder durch die konkrete Aussage ersetzen, die dahinter steht.

---

## Gruppe B: Einstiege und Ausstiege

### SD-10 Räusper-Opener

"Hier ist die Sache", "Lass mich ehrlich sein", "Ich sag's mal so", "Die unbequeme Wahrheit ist", "Mal ganz offen".

Fix: Streichen und mit der Aussage beginnen.

### SD-11 Pseudo-Insider-Setup

"Was die meisten übersehen", "Was dir niemand sagt", "Der Teil, den alle überspringen", "Was 99% falsch machen".

Warum es auffällt: Die Formel schmeichelt dem Autor als einzigem Wissenden. Sie sagt über den Inhalt nichts aus.

Vorher:
> Was die meisten übersehen: Verteilung ist der eigentliche Burggraben.

Nachher:
> Verteilung ist der Burggraben.

Fix: Setup streichen. Die Behauptung muss allein tragen.

### SD-12 Zusammenfassungs-Ende

"Fazit:", "Unterm Strich", "Am Ende des Tages", "Letztendlich", "Zusammengefasst", ein Schlussabsatz, der den Text wiederholt.

Fix: Der Leser war gerade dabei. Mit dem letzten konkreten Punkt enden oder mit dem nächsten Schritt.

### SD-13 Pseudo-tiefer Schlusssatz

Der eine "tiefsinnige" Satz am Ende, der die Aussage in eine Metapher oder ein Bonmot verwandelt.

Vorher:
> Am Ende gewinnt nicht der mit dem besten Modell, sondern der mit dem besten Gedächtnis.

Fix: Löschen. Nicht in eine bessere Metapher umschreiben, nicht den Rhythmus retten. Mit dem klarsten konkreten Satz enden, der schon im Text steht.

### SD-14 Formelhafte Übergänge

"Darüber hinaus", "Zudem", "Des Weiteren", "Nicht zuletzt", "Abschließend", "In diesem Zusammenhang", "Vor diesem Hintergrund".

Fix: Streichen. Deutscher Text verträgt Absätze ohne Scharnier. Wenn der Zusammenhang nicht ohne Scharnier trägt, ist die Reihenfolge falsch.

### SD-15 Meta-Kommentar über den eigenen Text

"Im Folgenden zeige ich", "Dazu später mehr", "Der Punkt ist", "Wie eingangs erwähnt", "Das ist wichtiger als es klingt", "Wie du siehst", "Mit anderen Worten" (wenn redundant).

Fix: Löschen. Wenn der Punkt klar ist, braucht er keinen Hinweisschild. Wenn er unklar ist, braucht er Belege, keinen Hinweis.

---

## Gruppe C: Wortwahl und Verben

### SD-16 KI-Vokabular

Vollständige Liste in `wortlisten-de.md`. Kern: nahtlos, robust, ganzheitlich, wegweisend, bahnbrechend, revolutionär, dynamisch, facettenreich, maßgeblich, entfesseln, befähigen, eintauchen in, auf ein neues Level heben.

Fix: Durch das gewöhnliche Wort ersetzen. "Nutzen" statt "befähigen". "Stabil" statt "robust", oder besser die Zahl, die Stabilität belegt.

### SD-17 Kopula-Vermeidung

Umschreibungen statt "ist" und "hat".

Formen: "dient als", "fungiert als", "stellt dar", "bildet die Grundlage für", "verfügt über", "zeichnet sich aus durch", "findet Anwendung in".

Vorher:
> Der Vault dient als zentrale Ablage für alle Projektdaten.

Nachher:
> Im Vault liegen alle Projektdaten.

Fix: "ist" und "hat" sind gute deutsche Verben. Benutzen.

### SD-18 Partizip-Anhängsel

Ein nachgestelltes Partizip, das Tiefe vortäuscht.

Formen: "und unterstreicht damit", "und zeigt so", "und verdeutlicht", "und spiegelt wider", "und trägt bei zu", "womit deutlich wird".

Vorher:
> Das Update bringt eine Suchfunktion und unterstreicht damit den Fokus auf bessere Arbeitsabläufe.

Nachher:
> Das Update bringt eine Suchfunktion. Nutzer finden alte Entwürfe, ohne den Editor zu verlassen.

Fix: Anhängsel streichen. Wenn es eine echte Folge gibt, sie als eigenen Satz mit konkretem Inhalt schreiben.

### SD-19 Bedeutungs-Aufblähung

"markiert einen Wendepunkt", "ist ein Beleg für", "spielt eine zentrale Rolle", "unterstreicht die Bedeutung", "setzt neue Maßstäbe", "festigt seine Position", "ebnet den Weg".

Vorher:
> Der Launch markiert einen Wendepunkt für das Unternehmen.

Nachher:
> Es ist das erste Produkt, für das das Unternehmen Geld verlangt.

Fix: Die Tatsache nennen und den Leser selbst urteilen lassen.

### SD-20 Werbe-Sprech

"eingebettet in", "im Herzen von", "beeindruckend", "atemberaubend", "einzigartig", "erstklassig", "hochmodern", "State of the Art".

Fix: Streichen oder durch eine überprüfbare Angabe ersetzen.

### SD-21 Synonym-Rotation

Dieselbe Sache wird pro Satz anders benannt, damit sich das Wort nicht wiederholt.

Vorher:
> Der Agent prüft den Entwurf. Der Assistent bewertet den Text. Das Tool schlägt Korrekturen vor.

Nachher:
> Der Agent prüft den Entwurf, bewertet ihn und schlägt Korrekturen vor.

Fix: Wenn das Wort richtig ist, es wiederholen. Wiederholung ist im Deutschen kein Stilfehler, sondern Klarheit.

### SD-22 Schwammige Zuschreibung

"Experten sagen", "Studien zeigen", "Branchenberichte deuten darauf hin", "viele argumentieren", "es gilt als", "gemeinhin bekannt".

Fix: Quelle benennen oder Behauptung streichen. Niemals eine Quelle erfinden. Wenn keine da ist, nachfragen.

---

## Gruppe D: Perspektive und Konkretheit

### SD-23 Falsche Handlungsträger

Unbelebte Dinge tun menschliche Dinge.

Formen: "Die Daten zeigen uns", "Der Markt verlangt", "Die Technologie ermöglicht", "Die Entscheidung entstand", "Das System versteht".

Vorher:
> Die Zahlen erzählen eine klare Geschichte.

Nachher:
> Wir haben die Zahlen ausgewertet und einen Trend gefunden.

Fix: Den Menschen benennen, der handelt.

### SD-24 Vage Deklarative

"Die Auswirkungen sind erheblich", "Die Gründe sind struktureller Natur", "Das Potenzial ist enorm".

Fix: Die konkrete Auswirkung nennen. Zahl, Name, Datum, Mechanismus.

### SD-25 Faule Extreme

"jeder", "immer", "nie", "alle", "kein einziger", wo die Aussage gar nicht so absolut gemeint ist.

Fix: Entweder belegen oder auf die tatsächliche Menge herunterschreiben.

### SD-26 Erzähler aus der Distanz

"Man", "die Leute", "Unternehmen tun heute", statt konkreter Personen oder direkter Ansprache.

Vorher:
> Viele Makler kämpfen heute mit ihrer Büroorganisation.

Nachher:
> Du verlierst pro Woche vier Stunden mit Terminabstimmung.

Fix: "Du" schlägt "man". Konkretes schlägt Abstraktes.

---

## Gruppe E: Formatierung

### SD-27 Formatierungs-Slop

Emoji in Überschriften. Fettdruck mitten im Satz zur Betonung. Bullet-Listen, wo zwei Sätze Prosa besser lesbar wären. Überschriften über Zwei-Satz-Abschnitten. Bullets, die aus vollständigen Sätzen bestehen.

Fix: Format folgt dem Inhalt. Eine Liste ist für parallele, scanbare Einträge. Vollständige Sätze als Bullet sind Prosa mit Symbolen.

Achtung LinkedIn: Chris' Voice-Files erlauben ALL CAPS zur Betonung statt Markdown. Das ist bewusst und wird nicht geflaggt. Siehe `false-positives-de.md`.

### SD-28 Gedankenstriche

Der Gedankenstrich als Satzverbinder. Steht bereits an vier Stellen in Chris' Konfiguration, hier der Vollständigkeit halber.

Fix: Punkt. Zwei Sätze. Bei echtem Einschub Klammern.

Deutscher Sonderfall: Der Bindestrich in Komposita ist normales Deutsch, kein Tell. "KI-Betriebssystem", "Makler-OS" und "Anti-Slop-Katalog" bleiben. Die englische Regel gegen Bindestrich-Komposita gilt hier nicht.

---

## Der Portabilitäts-Test

Ein Test, der die halbe Liste ersetzt. Aus `no-ai-slop`.

Nimm einen beliebigen Satz. Frage: Könnte dieser Satz unverändert über eine andere Person, eine andere Firma, ein anderes Produkt oder eine andere Branche stehen?

Wenn ja, ist er Füllmaterial. Ersetze ihn durch eine Tatsache, ein Beispiel, einen Mechanismus, eine Folge oder ein Urteil, das nur auf diesen Gegenstand passt.

Beispiel: "Unser Ansatz verbindet Technologie mit echtem Kundenverständnis." Dieser Satz passt auf jede Firma der Welt. Er sagt nichts.
