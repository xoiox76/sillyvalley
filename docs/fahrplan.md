# Fahrplan

Der Maßstab bleibt für jeden Schritt derselbe: Was das Spiel zeigt, muss ein echter Agenten-Zustand sein. Testdaten
stützen die Entwicklung, aber kein Meilenstein gilt als erreicht, solange er nur simuliert funktioniert.

## Meilenstein 1: die Verbindung beweisen (fertig)

Unternehmen anlegen, echten Agenten einstellen, begrenzten Auftrag starten, echten Zustand im Büro sehen, reales
Ergebnis öffnen, Verbrauch nachvollziehen. Dazu Abnahme mit Korrekturrunden, Ansprechen mit Gedächtnis, Baupunkte,
Möbel und der Umzug ins erste Büro.

## Meilenstein 2: mehrere Agenten an einem Auftrag (fertig)

Das Fenster „Auftrag planen" belegt die Stufen Planen, Arbeiten und Prüfen mit Mitarbeitern. Stufen geben nur Dateien
weiter. Die Prüfung liest nur und urteilt je Kriterium; nicht bestanden führt zurück an die Arbeit. Im Büro trägt die
Figur das Ergebnis zum nächsten Platz, die Pinnwand und die Stufenanzeige folgen dem echten Stand.

Bewusst noch nicht dabei: mehrere Arbeitsstufen, parallele Stufen und frei sortierbare Abläufe. Drei feste Plätze halten
die Regeln einfach. Erweitern lohnt sich erst, wenn das Spielen zeigt, dass sie zu eng sind.

## Meilenstein 3: Besprechungen (fertig)

Bis zu vier Agenten treffen sich im Glasraum und besprechen ein Thema in begrenzten Runden. Jeder sieht das bisher Gesagte,
die Moderation fasst zusammen und macht am Ende einen Vorschlag. Das Protokoll ist eine echte Datei. Ein Beschluss des
Menschen wird Firmenwissen, und aus nächsten Schritten werden vorausgefüllte Aufträge.

Bewusst nicht dabei: Dateiänderungen in einer Besprechung. Wer danach etwas ändern soll, bekommt dafür einen Auftrag.

## Meilenstein 4: Manager und Abteilungen (fertig)

Der Mensch führt, gibt aber Teile der Führung ab.

- **Abteilungen** sind Bereiche auf dem Boden mit eigenem Budget, Team und Wissensablage. Wessen Schreibtisch darin steht,
  gehört dazu. Alles bleibt in einer Unternehmenssession.
- **Projekte (früher Vorhaben):** Ein Manager zerlegt ein Ziel in Aufträge. Das Antwortschema lässt nur sein Team zu, der Server prüft Limits
  gegen das Budget des Projekts.
- **Freigabe-Stufe:** Bis zu welchem Limit der Manager selbst startet, legt der Spieler fest. Einstellen, Abnahme und alles
  nach außen bleiben beim Menschen.

- **Verträge:** Ein Manager schlägt Einstellungen vor; eingestellt wird erst, wenn die Geschäftsführung den Vertrag
  (Name, Rolle, Fähigkeiten, Modell, Gehalt als Listenpreis, Arbeitsplatz, Budgetquelle) unterzeichnet.

Bewusst nicht dabei: Manager, die selbst abnehmen oder einstellen, und Manager, die andere Manager beauftragen. Beides
würde die Kontrolle des Menschen verwässern, bevor sie sich im Spiel bewährt hat.

## Zwischenschritt: bestehendes Projekt einbinden (fertig)

Eine Firma bekommt bei der Gründung optional einen vorhandenen Ordner. Er bleibt, wo er ist, und wird als zweiter
erlaubter Ort (`--add-dir`) neben dem Arbeitsbereich freigegeben; `--restricted` gilt weiter. Für Agenten und
Oberfläche heißt er `projekt/`. Spielstand und Verbrauchsbuch liegen außerhalb des Projekts.

Bewusst noch nicht dabei: ein Projekt nachträglich an eine bestehende Firma binden oder wechseln, und mehrere Projekte
je Firma. Beides geht später über denselben Mechanismus.

## Zwischenschritt: Stellen und Teams (fertig)

Ausschreibung statt Einstellungsfenster, eigene Fähigkeiten als Text oder Markdown-Datei, benannte Teams, Kontext und
Kosten beim Beschreiben einer Aufgabe. Bewusst nicht dabei: Bewerbungen mehrerer Kandidaten, denn die wären entweder
erfunden oder kosteten für jede Absage echtes Budget. Ebenfalls nicht: Kündigen und Fähigkeiten entfernen.

## Zwischenschritt: die Stadt (fertig)

Das Büro liegt jetzt in einer begehbaren Kleinstadt. Der Aufstieg vom Elternhaus führt über gemietete Läden oder gekaufte
Grundstücke mit eigenem Neubau. Plan und Regeln stehen in `shared/town.ts`, die Ansicht in `client/world/town.ts`.

Bewusst noch nicht dabei: laufende Miete, Kündigen und Verkaufen, Passanten und Autos, mehrere gleichzeitig genutzte
Standorte. Der Server prüft die Regeln, aber nicht, wo die Figur steht: Das Laufen gehört zum Spiel, ist aber keine
Sicherheitsgrenze.

## Zwischenschritt: Subagents und Befehle (fertig)

Subagents aus `.claude/agents/` eines eingebundenen Projekts lassen sich als Mitarbeiter übernehmen. Befehle beantragen sie,
der Mensch gibt jeden einzeln frei. Das ist zugleich der erste Baustein von Meilenstein 5: eine Freigabe pro Aktion mit
einem Eintrag im Protokoll. Bewusst nicht dabei: Sandbox und Dauerfreigaben, Befehle für Prüfstufen und Manager.

## Zwischenschritt: Rollen, Teamprojekte, Inventar (fertig)

Die Geschäftsführung definiert Rollen mit Fähigkeiten, stellt daraus ein und gibt Teams Projekte, die ihre Leitung verteilt.
Alle Gegenstände sind verschiebbar; Inventar und Bau-Modus laufen über Tastenkürzel. Firmen tragen ein Schild in der Stadt.

## Zwischenschritt: die Tafel (fertig)

Agenten hängen Vorschläge als Zettel an eine Tafel im Büro. Der Mensch vergibt sie als Auftrag oder Projekt, die Figur holt sie ab.

## Zwischenschritt: Anbau und Stockwerke (fertig)

Das eigene Haus wächst in die Breite, Tiefe und Höhe, begrenzt durch das Grundstück. Aufgänge setzt der Spieler selbst.

## Zwischenschritt: Zusammenarbeit (fertig)

Zettel per Ziehen vergeben, Hilfe unter Kollegen im Besprechungsraum, Aufträge weitergeben, Kennenlernrunde für Neue.

## Zwischenschritt: Du im Spiel (fertig)

Eigene Figur mit Name und Aussehen, läuft im Büro und in der Stadt. Chefschreibtisch mit Pineapple-Laptop. Damit ist der Prototyp vollständig.

## Zwischenschritt: Laptop, Zettel, Fahrstuhl (fertig)

Nachrichten, Akten und das Rollenprogramm liegen auf dem Pineapple-Laptop. Rollen sind Markdown mit Vorlage und Zettelfarbe.
Zettel lassen sich ändern, ablehnen und für später zurücklegen. Der Fahrstuhl fährt sichtbar: Knopf, Warten, Tür, Kabine, Tür.

## Zwischenschritt: Scrum und PineappleOS (fertig)

Ein Scrum Master schaltet Sprints frei. Ein Sprint ist ein Budgetrahmen für ausgewählte Zettel, keine Kalenderzeit. Das Planning
ist ein echter Lauf und schlägt nur vor, der Mensch legt Ziel, Rahmen und Zettel fest und vergibt die Aufträge. Das Board wird aus dem
Stand von Zetteln und Aufträgen berechnet. Die Retrospektive ist eine echte Besprechung, ihr Beschluss steht im Firmenwissen.
PineappleOS hat Schreibtisch, Dock und Fenster; das Programm Dateien zeigt alles und startet HTML-Ergebnisse abgeschirmt.

Fertige Aufträge kommen als Mail in die Post, geprüft und freigegeben wird dort. Die Roadmap berechnet sich aus dem echten Stand und lässt sich nach Personen filtern.

Bewusst nicht dabei: Daily, denn jede Runde kostete echtes Budget ohne Ergebnis. Schätzungen in Story Points, solange Kosten echt gemessen
werden. Ein Scrum Master, der selbst Aufträge vergibt. Mehrere gleichzeitig offene Fenster in PineappleOS.

## Zwischenschritt: weitere Anbieter (gebaut, mit echtem Anbieter noch ungeprüft)

Einstellungen auf dem Laptop verbinden OpenAI und andere Anbieter mit OpenAI-kompatibler API. Der Agent bekommt nur Dateiwerkzeuge, die der
Server prüft und ausführt; das Limit rechnet der Server aus den gemeldeten Tokens und den Listenpreisen. Für OpenAI stehen offizielle Preise im Katalog,
sonst trägt der Mensch sie ein. Bewusst nicht dabei: Agenten-CLIs, die über Shell-Befehle arbeiten, denn sie würden die Einzelfreigabe umgehen.
Ebenfalls noch nicht: Websuche für diese Anbieter und ein Anthropic-API-Schlüssel statt des Abos.

## Zwischenschritt: Repo im Spiel (fertig)

Branch und Arbeitsordner je Auftrag, Diff in der Post, Commit nach Abnahme, Hochladen und Pull Request nach Klick. Das ist der erste Konnektor mit Außenwirkung:
Der Mensch löst jede Aktion einzeln aus. Bewusst nicht dabei: automatisches Zusammenführen, Status der Pull Requests im Spiel, und Tests, die der Agent selbst startet.

## Meilenstein 5: Außenwirkungen

Agenten dürfen vorbereiten, Menschen entscheiden. Konnektoren (Mail, Veröffentlichung, Zahlungen) kommen einzeln dazu,
jeweils mit einer Freigabe pro Aktion und einem Eintrag im Protokoll.

## Meilenstein 6: Firmensitz und weitere Anbieter

- **Vom Neubau zum Firmensitz:** Mehrere Räume, Wände und Türen im Bau-Modus, Foyer, Lounge, Werkstatt.

## Offene Entscheidungen

- **Zielbild der Veröffentlichung:** Das Spiel läuft lokal, ohne Server. Spielstände und Schlüssel in `data/` bleiben auf dem eigenen Rechner.
  Für ein Produkt fehlen noch die sichere Eingabe des Schlüssels und eine Kostenwarnung beim ersten Start.
- **Firmen in einer Stadt:** Jede Firma führt ihre Grundstücke für sich. Die Schilder zeigen alle Firmen, doch ein Laden lässt
  sich noch von zwei Firmen zugleich mieten. Soll eine Stadt für alle gelten, muss der Server das prüfen.
- **Budget auf dem Abo:** Das KI-Budget begrenzt aktuell den API-Gegenwert. Das ist ehrlich gekennzeichnet, fühlt sich aber
  anders an als echte Abrechnung. Eine Alternative wäre, im Abo-Betrieb das Kontingent selbst zum Budget zu machen.

## Gestaltungsvorlage

Vier Vorlagen legen die Richtung fest. Sie liegen nicht im Repository, deshalb hier die Merkmale:

- **Büro ausbauen:** Elf mal neun Felder, Wasser ringsum, rechts der Katalog mit Baupunkten, grüne und rote Bauvorschau.
- **Auftrag planen:** Ziel, Abnahme als Checkliste, Ablauf, Team, Auftragslimit, Korrekturrunden, Hinweis auf echte Kosten.
- **Besprechung:** Glasraum mit Leuchtrand, Rundenliste, erfasster Verbrauch gegen Limit, Protokoll und Stopp.
- **Firmensitz:** Mehrere Abteilungen um eine Lounge in einer Unternehmenssession. Über den Köpfen Blasen für Arbeit
  (Zahnrad), Gespräch (Punkte), Bedarf an den Menschen (Hand) und Fertig (Haken).

Durchgängig: dunkles Navy, Mint und Amber, Pixelschrift, vier Bereiche unten (Bauen, Team, Projekte, Finanzen).
