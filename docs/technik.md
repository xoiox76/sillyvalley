# Silly Valley

Ein isometrisches Aufbauspiel, dessen Mitarbeiter echte KI-Agenten sind. Du gründest eine Firma für deine
Idee, stellst Agenten nach Rolle, Fähigkeiten, Modell und Kosten ein und führst sie durch das Büro. Was im
Büro passiert, ist kein Theater: Jede Figur zeigt den Zustand eines echten Prozesses, jedes Ergebnis ist eine
echte Datei, jeder Euro beruht auf gemessenem Verbrauch.


## Git-Repo verbinden

Eine Firma lässt sich unter Laptop › Einstellungen mit einem Repo verbinden, über einen vorhandenen Ordner oder eine Adresse. Beim Gründen wird ein Git-Ordner automatisch verbunden. Jeder Auftrag bekommt dann einen eigenen Branch `auftrag/…` und einen Arbeitsordner unter `zweige/` im Arbeitsbereich; der Checkout bleibt unberührt. Agenten bekommen kein Git und keinen Zugang. Abnehmen committet lokal unter dem Namen des Agenten, Ablehnen löscht den Branch. Hochladen und Pull Request löst nur der Mensch aus, nie mit force. Hooks sind dabei abgeschaltet, und eine veränderte Datei `.git` im Arbeitsordner sperrt Git für diesen Auftrag. Der Pull Request braucht die GitHub-CLI `gh`.

## Als Mac-App starten

`desktop/build.sh` baut `Silly Valley.app` auf den Schreibtisch: ein eigenes Fenster, das den lokalen Server startet und beim Beenden wieder stoppt. Läuft schon ein Server, etwa aus dem Terminal, nutzt die App ihn und lässt ihn laufen. Die App merkt sich Projektordner und die Pfade zu `node` und `claude`. Ändern sie sich, baue sie neu. Das Protokoll steht in `~/Library/Logs/Silly Valley.log`.

## Starten

Voraussetzungen: Node 24 oder neuer und eine angemeldete Claude-CLI. Ohne CLI
bietet das Spiel keine Simulation an, sondern sagt, was fehlt.

```bash
npm install
```

```bash
npm run dev
```

Danach läuft das Spiel auf http://localhost:4600. Port 4601 liefert die Ergebnisse der Agenten aus (siehe
[Sicherheit](#grenzen-und-sicherheit)). Firmen, Arbeitsbereiche und das Verbrauchsbuch liegen in `data/`.

Mit einem gesetzten `ANTHROPIC_API_KEY` läuft die Arbeit über diesen Schlüssel statt über das Abo. Das Spiel
zeigt immer an, welcher Weg aktiv ist.

## Der erste Meilenstein

| Schritt | Was wirklich passiert |
|---|---|
| Unternehmen anlegen | Ein Ordner mit `team/`, `wissen/`, `dateien/`, `auftraege/`, `ergebnisse/` entsteht |
| Agenten einstellen | Ein echter Lauf als Vorstellungsgespräch. Scheitert er, wird niemand eingestellt |
| Begrenzten Auftrag starten | Ein Prozess startet mit Limit, Werkzeug-Sperren und Zeitlimit |
| Zustand im Büro sehen | Figur, Blase, Bildschirm und Pinnwand folgen den Ereignissen dieses Prozesses |
| Ergebnis öffnen | Die echte Datei des Agenten, als Dokument oder bedienbarer Prototyp |
| Verbrauch nachvollziehen | Tokens × Listenpreis, Anbieterwert, Kurs und Rohprotokoll je Lauf |

Baupunkte gibt es nur für abgenommene Ergebnisse, nie für Verbrauch. Sie bezahlen den Ausbau des Büros und
sind bewusst keine zweite Form von Geld.

## Der zweite Meilenstein: mehrere Agenten an einem Auftrag

Ein Auftrag läuft durch die Stufen Planen, Arbeiten und Prüfen, jede mit eigenem Agenten. Planen und Prüfen
können entfallen; die Abnahme bleibt immer beim Menschen.

| Regel | Warum |
|---|---|
| Stufen geben nur Dateien weiter, jeder Agent bleibt in seiner Session | Begrenzt den Verbrauch, macht die Übergabe nachprüfbar |
| Die Prüfung hat nur Lesewerkzeuge und ein festes Antwortschema | Sie kann das Geprüfte nicht ändern, ihr Urteil ist auswertbar |
| Niemand prüft das eigene Ergebnis | Sonst wäre die Prüfung wertlos |
| Nicht bestanden führt zurück an die Arbeit und kostet eine Korrekturrunde | Sind die Runden aufgebraucht, entscheidet der Mensch |
| Das ganze Restlimit bleibt reserviert, auch zwischen zwei Stufen | Sonst ließe sich das Budget in der Lücke doppelt verplanen |
| Eine frühe Stufe nutzt höchstens die Hälfte des Restlimits | Für die späteren Stufen bleibt immer etwas übrig |
| Ist ein Agent beschäftigt, wartet die Stufe und startet danach von selbst | Warteschlange statt Fehlermeldung |
| Nach einem Neustart läuft kein Auftrag von selbst weiter | Neuer Verbrauch braucht den Menschen |

Das Urteil wird nicht blind geglaubt: Bestanden gilt nur, wenn die Prüfung jedes Kriterium einzeln als erfüllt
bewertet hat. Der Prüfbericht liegt als Datei im Ergebnisordner.

## Der dritte Meilenstein: Besprechungen

Bis zu vier Agenten treffen sich im Glasraum und besprechen ein Thema in begrenzten Runden. Am Ende steht ein
Vorschlag, und der Mensch entscheidet.

| Regel | Warum |
|---|---|
| Ohne Besprechungsraum (80 Baupunkte) keine Besprechung, hinein geht es nur durch die Tür | Der Raum ist eine echte Entscheidung beim Einrichten |
| Alle sprechen nacheinander und sehen das bisher Gesagte, die Moderation zuletzt | Die Beiträge bauen wirklich aufeinander auf |
| Beiträge sind Läufe mit Lesewerkzeugen und festem Antwortschema | Niemand ändert Dateien, die Sprechblasen stammen aus den echten Antworten |
| Das Limit verteilt sich gleichmäßig auf die offenen Beiträge | Niemand redet das Budget leer, bevor alle dran waren |
| Die Moderation beendet früher, wenn das Team einig ist; die letzte Runde erzwingt einen Vorschlag | Einigkeit spart Geld, Uneinigkeit wird offen benannt |

Das Protokoll entsteht als Datei unter `besprechungen/` allein aus den Beiträgen. Ein Beschluss des Menschen landet in
`wissen/beschluesse.md`, und spätere Aufträge werden darauf hingewiesen. Aus nächsten Schritten wird mit einem Klick ein
vorausgefüllter Auftrag. Baupunkte gibt es für Besprechungen nicht, denn sie liefern kein abgenommenes Ergebnis.

Ein Stopp gilt auch dann, wenn der laufende Schritt im selben Moment fertig wird: Danach entsteht kein neuer Verbrauch.

## Der vierte Meilenstein: Manager und Abteilungen

Der Mensch führt, gibt aber Teile der Führung ab, ohne die Kontrolle abzugeben.

**Abteilungen** sind Bereiche auf dem Boden (30 Baupunkte, zwei Ecken klicken). Wessen Schreibtischplatz darin liegt,
gehört dazu: Umorganisieren heißt Möbel rücken. Jede Abteilung hat ein eigenes Budget, das dem allgemeinen fehlt,
und eine eigene Wissensablage unter `wissen/<name>/`, auf die ihre Aufträge hingewiesen werden.

**Projekte** (früher Vorhaben) übertragen ein Ziel mit Budget an einen Manager, einen Agenten aus dem Team. Er liest den Arbeitsbereich und
liefert über ein festes Antwortschema Aufträge mit Ziel, Abnahmekriterien, Team und Limit.

| Regel | Warum |
|---|---|
| Das Antwortschema lässt als Namen nur das Team des Managers zu | Er kann technisch niemanden außerhalb seiner Abteilung einplanen |
| Der Server prüft jeden Vorschlag: Team, Limit, Summe gegen das Restbudget | Vorschläge werden geprüft, nicht geglaubt; unzulässige bleiben sichtbar mit Grund |
| Die Freigabe-Stufe legt fest, bis zu welchem Limit der Manager selbst startet | Was den Menschen braucht, entscheidet der Spieler, nicht der Prompt |
| Jede Ausgabe hat genau eine Quelle: Projekt, Abteilung oder allgemeines Budget | Ein Projekt hält sein Restbudget, bis der Mensch es abschließt |
| Einstellen, Abnahme und alles nach außen bleiben beim Menschen | Der Manager kann nur lesen und planen |

**Verträge:** Fehlt dem Team eine Rolle, schlägt der Manager eine Einstellung vor (Name, Rolle, Modell, Fähigkeiten aus
dem Katalog, nichts anderes lässt das Schema zu). Daraus wird ein Arbeitsvertrag mit Gehalt als Listenpreis je Million
Tokens, Einstellungsgespräch, Arbeitsplatz und Budgetquelle. Unabhängig von der Freigabe-Stufe wird niemand eingestellt,
bevor die Geschäftsführung, also der Spieler, den Vertrag unterzeichnet. Erst die Unterschrift löst das echte
Vorstellungsgespräch aus.

Die Akte eines Projekts liegt unter `auftraege/vorhaben-*.md`. Der Manager sieht in jeder weiteren Planungsrunde den
Stand seiner Aufträge und baut darauf auf; sieht er das Ziel als erreicht, sagt er das, und der Mensch schließt ab.

Freie Figuren vertreiben sich die Zeit: Handy, Plausch mit einer anderen freien Kollegin, Kaffeemaschine, falls eine steht.
Das ist Kulisse und endet, sobald ein echter Lauf beginnt.

## Subagents aus dem Projekt

Hat eine Firma ein eingebundenes Projekt, listet der Bereich Team dessen Subagents aus `.claude/agents/*.md`. Beim
Einstellen wird die Anweisung aus der Datei wörtlich zum Profil, dazu gehört wie immer das echte Vorstellungsgespräch und
ein freier Schreibtisch. Das Projekt bleibt unverändert und die Quelle: Die Liste wird frisch gelesen, doch ein schon
eingestellter Mitarbeiter behält seine Fassung.

Die Rechte folgen der Datei, nie darüber hinaus: Ohne Write und Edit in `tools` bleibt der Mitarbeiter lesend. Werkzeuge
außerhalb des Spiels bleiben gesperrt. Weil `CLAUDE.md` nicht automatisch geladen wird, verweist das Profil darauf.

### Befehle mit Freigabe

Die Agenten laufen weiter ohne Bash. Wer laut Datei Befehle darf, kann in seiner Antwort einen beantragen. Ausgeführt wird
er vom Server, und erst, wenn der Mensch genau diesen Wortlaut freigibt. Jeder Antrag braucht einen eigenen Klick, eine
Dauerfreigabe gibt es nicht. Solange nicht entschieden ist, entsteht kein neuer Lauf und kein Verbrauch.

| Regel | Warum |
|---|---|
| Der Server speichert den Wortlaut, eine Freigabe gilt genau einmal | Niemand kann den Befehl nach dem Klick ändern |
| Ausgabe oder Ablehnung gehen an den Agenten zurück, gekennzeichnet als Daten | Er arbeitet weiter, und Text aus der Ausgabe wird nicht zum Auftrag |
| Umgebungsvariablen nur über eine Whitelist, höchstens 10 Minuten, Stopp jederzeit | Schlüssel aus der Umgebung des Spiels wandern nicht mit |
| Warnhinweise für Löschen, Git, Veröffentlichen, Netz, Installieren, Zugangsdaten | Eine Hilfe beim Hinsehen, keine Prüfung |
| Jeder Schritt steht in `befehle.jsonl`, nur ergänzt, nie umgeschrieben | Auch abgelehnte Anträge bleiben nachvollziehbar |
| Ein gestoppter Auftrag oder Neustart lässt offene Anträge verfallen | Eine alte Freigabe kann nichts Unerwartetes auslösen |

**Das ist keine Absicherung.** Ein freigegebener Befehl läuft mit den Rechten des Benutzers und kann auch außerhalb
des Projekts wirken. Die Freigabe ist die einzige Grenze. Prüfstufen, Besprechungen und Manager können keine Befehle beantragen.

## Stellen, Fähigkeiten und Teams

Einstellen heißt: eine Stelle ausschreiben. Sie nennt Titel, konkrete Aufgabe, Anforderungen, Modell und Gehalt. Fähigkeiten
kommen aus dem Katalog, aus einer eigenen Beschreibung oder aus einer Markdown-Datei (höchstens 20.000 Zeichen, denn sie
wird bei jedem Lauf mitgelesen). Bewerber erfindet das Spiel nicht: Wer eingestellt wird, führt das echte Vorstellungsgespräch.

Stelle und Fähigkeiten lassen sich auch später ändern. Weil die CLI den Systemprompt beim ersten Lauf einer Session
festhält, reicht das Spiel Änderungen genau einmal im nächsten Lauf nach und merkt sich erst nach einem Erfolg, dass
sie angekommen sind. Eine mitgeteilte Fähigkeit bleibt im Gedächtnis des Agenten und lässt sich nicht zurücknehmen.

Die Geschäftsführung kann **Rollen** definieren, bevor jemand eingestellt ist: Name, Aufgabe, Anforderungen, Fähigkeiten
und ein vorgeschlagenes Modell. Eine Rolle kostet nichts. Wer aus ihr eingestellt wird, übernimmt Stelle und Fähigkeiten.
Ändert sich die Rolle, erfahren es alle mit dieser Rolle im nächsten Lauf. Eine entfernte Fähigkeit bleibt bei ihnen, neue
Leute bekommen sie nicht mehr. Manager schlagen bei Verträgen zuerst diese Rollen vor.

**Teams** sind benannte Gruppen mit einer Teamleitung. Die Firma gibt einem Team ein Projekt, die Leitung verteilt die Arbeit
nach Rollen und Fähigkeiten: Das Antwortschema enthält keine Namen außerhalb des Teams, und ohne Freigabe startet nichts,
solange die Freigabe-Stufe es nicht anders sagt. Wer per Vertrag für ein Teamprojekt kommt, gehört danach zum Team. Daneben
gibt es den Einzelauftrag, bei dem der Mensch selbst besetzt.

**Kündigen** steht im Feld eines Mitarbeiters und fragt einmal nach. Der Schreibtisch wird frei, die Person verlässt ihre Teams
und die Teamleitung, ihre Session wird nicht fortgesetzt. Verlauf, Kosten und Ergebnisse bleiben. Solange ein Lauf, ein offener
Auftrag, ein geleitetes Projekt, eine offene Besprechung oder ein Befehl an ihr hängt, geht es nicht. Eine neue Einstellung unter
demselben Namen ist eine neue Person ohne das alte Gedächtnis.

Im Feld eines Mitarbeiters steht, woran er gerade arbeitet. Alles Erledigte steht in seiner Akte am Laptop. Die Frage „Was als
Nächstes?" ist ein echter Lauf in seiner Session: Die Antwort baut auf dem auf, was er schon geliefert hat.

Beim Beschreiben einer Aufgabe zeigt das Fenster je Mitarbeiter Kontextfenster, Belegung und Kosten. Kontextfenster und
Ausgabegrenze meldet die CLI selbst (alle vier Modelle 1 Million Tokens Kontext; Ausgabe 128.000, bei Fable 5.1 64.000).
Die Belegung stammt aus der letzten Modellantwort. Geschätzt ist nur, was noch kein Modell gezählt hat, und die
Kostenangabe ist eine Untergrenze: Die Länge der Antwort kennt vorher niemand. Abgerechnet wird, was gemessen ist.

## Die Tafel

Im Büro hängt eine Tafel, und im Bereich Projekte steht sie noch einmal groß. Schlägt ein Agent Aufgaben vor, hängt er echte Zettel daran: Er schreibt sie in seine Antwort, der Server liest sie aus, und die Figur geht zur Tafel und hängt sie an. Offene Vorschläge aus Projekten hängen dort ebenfalls, in Rosa. Ein Zettel startet nichts.

Eigene Zettel schreibst du mit „+ Zettel" direkt an der Tafel, sie sind blau. Du vergibst einen Zettel als Auftrag an eine Person, gibst ihn als Projekt an ein Team oder wirfst ihn weg. Wer die Arbeit bekommt, holt sich den Zettel an der Tafel ab. Im Feld eines Mitarbeiters gibt es zwei Anweisungen: „Hol dir eine Aufgabe von der Tafel" öffnet den passendsten Zettel als Auftrag für diese Person, das Limit setzt du. „Häng deine Vorschläge an die Tafel" ist ein echter Lauf, nach dem die Zettel dort hängen.

Ziehst du einen Zettel auf eine Person, in der Leiste unter der Tafel oder auf die Figur im Büro, holt sie ihn ab und beginnt sofort. Das Limit folgt ihrem Modell. Rosa Vorschläge gibst du weiter einzeln frei.

## Hilfe unter Kollegen

Kommt ein Agent nicht weiter, kann er einen Kollegen fragen. Der Kollege antwortet in einem echten Lauf, der nur lesen darf und höchstens 0,15 € kostet. Im Auftrag zahlt das Auftragslimit, und ein Auftrag fragt höchstens dreimal. Die Stufe wartet und läuft mit der Antwort weiter. Solange das läuft, sitzen beide im Besprechungsraum. Ist keiner frei, geht der Fragende zum Platz des Kollegen. Frage und Antwort stehen im Gespräch beider.

## Weitergeben und Kennenlernen

Wer einen Auftrag bekommt, prüft ihn zuerst. Passt er offensichtlich nicht und kennt die Person jemand klar Besseren, gibt sie ihn weiter: Die Figur bringt den Zettel hin, und die Arbeit beginnt dort. Der Server prüft das. Niemand bekommt einen Auftrag zurück, wer prüft, kann nicht bearbeiten, und mehr als zweimal wandert ein Auftrag nicht. Geht es nicht, bearbeitet die Person ihn selbst. Der erste Lauf kostet echtes Budget aus dem Auftragslimit.

Neue Mitarbeiter gehen nach dem Vorstellungsgespräch zu jedem Kollegen und erfahren, was er kann, und umgekehrt. Das kommt aus Stelle und Fähigkeiten und kostet keinen Lauf. Danach steht es in ihren Anweisungen, und nur wen jemand kennt, kann er fragen oder ihm etwas weitergeben. Kommt vorher Arbeit, endet die Runde, das Wissen bleibt.

## Silicon Valley

Das Spiel liegt auf einer grossen Karte mit sechs Städten in ihrer echten Lage zueinander: Menlo Park, Palo Alto und Mountain View an der Bay, darunter Cupertino, Sunnyvale und San José. Highway 101 und El Camino Real verbinden sie, oben im Bild die Bay, unten die Hügel. Mit der Bahn springt man zwischen den Städten. Ein Feld der Stadt ist so gross wie ein Feld im Büro. Der Boden entsteht stückweise, wo man hinschaut (`client/world/town.ts`).

Um das Tal herum liegt eine Welt von rund 109.000 mal 109.000 Feldern mit Küsten, Flüssen, Gebirgen, Wäldern, Wüsten, Feldern und rund 129.000 Orten. Sie entsteht beim Hinsehen aus der Lage auf der Karte (`shared/town.ts`): Dieselbe Stelle sieht auf jedem Rechner gleich aus, und ein Grundstück ist schon durch seine Kennung bestimmt. Gespeichert wird nur, was die Firma besitzt und baut. `M` öffnet die Übersichtskarte, ebenso weiteres Herauszoomen: Vom Büro geht es in die Stadt und von dort auf die Karte. Ein Klick auf einen Ort reist dorthin, ganz hineinzoomen führt zurück in die Stadt.

## Sprachen

Standard ist Englisch, in den Einstellungen und auf der Startseite lässt sich Deutsch wählen. Die Wahl liegt in `data/sprache.json`. Die Texte stehen auf Deutsch im Code, `client/i18n/en.ts` ist das Wörterbuch, `{}` steht darin für einen eingesetzten Wert. `node scripts/i18n-keys.ts` listet alle Texte, ein Test meldet, wenn einer im Wörterbuch fehlt. Agenten bekommen die Sprache als Regel mitgeteilt und schreiben Ergebnisse darin, ihre Arbeitsanweisungen selbst bleiben Deutsch.

## Kontingent und Abos

Wer lokal angemeldet ist, arbeitet mit dem eigenen Abo: Anthropic über die Claude-CLI, OpenAI über die Codex-CLI. API-Schlüssel sind die Option, in den Einstellungen auf dem Laptop. Bei der Codex-CLI sind Shell und Zusatzfunktionen abgeschaltet, Dateien gehen nur über `server/providers/files-mcp.ts`. Meldet ein Anthropic-Abo sein Kontingent als leer, gehen seine Mitarbeiter heim und kommen zur Rücksetzzeit wieder; wartende Arbeit läuft dann von selbst weiter.

## Das Büro in der Stadt

Die Haustür liegt in der Wand zur Strasse, ein Weg führt zum Gehweg. Ein Klick auf die Tür lässt die Figur hinlaufen, dann steht sie in der Stadt. Zurück führt ein Klick auf die Tür des eigenen Hauses. Rund ums Büro liegt die echte Stadt, ausgerichtet auf das Grundstück der Firma. Das eigene Grundstück ist so scharf wie das Büro; Nachbarhäuser davor werden nach dem Büro gezeichnet und verdecken es, wo sie wirklich davor stehen.

## Mehrere Standorte

Die Tür jedes Hauses, das der Firma gehört oder das sie gemietet hat, führt hinein, ohne dass sie umzieht. Das Haus wird dann ein weiterer Standort mit eigenen Möbeln, Abteilungen und Arbeitsplätzen. Wer dort eingestellt wird, sitzt auch dort. Budget, Verbrauch, Teams, Tafel und Akten gelten für die ganze Firma. Technisch hat jeder Standort einen eigenen Bereich an Etagen: 0 bis 99 der Firmensitz, ab 100 der nächste. Anbauen geht vorerst nur am Firmensitz.

## Tastenkürzel

Dieselbe Liste steht im Spiel auf dem Laptop unter **Tastenkürzel**.

| Wo | Taste | Wirkung |
|---|---|---|
| Büro, Stadt | Pfeiltasten, `W A S D` | laufen |
| Büro, Stadt | `+`, `-`, Mausrad | zoomen |
| Büro, Stadt | `0` | Ansicht zurücksetzen |
| Stadt | `M` | Karte öffnen und schliessen |
| Büro | `Bild auf`, `Bild ab` | Etage wechseln |
| Büro | `Enter` | am Chefplatz sitzend den Laptop öffnen |
| Bau-Modus | Klick, `Enter` | abstellen |
| Bau-Modus | `R`, Rechtsklick | drehen |
| Bau-Modus | `I` | ins Inventar |
| Bau-Modus | `Entf`, Rücktaste | löschen, ein zweiter Druck bestätigt |
| Überall | `Esc` | abbrechen, Fenster schliessen; im Browser des Laptops zurück |
| Mac-App | `Cmd+R`, `Cmd+F`, `Cmd+M`, `Cmd+H` | neu laden, Vollbild, ins Dock, ausblenden |
| Mac-App | `Cmd+W`, `Cmd+Q` | beenden |

## Gegenstände umstellen

Alles im Raum lässt sich verschieben, auch was beim Einzug schon dastand. Im Bereich Bauen wählt man einen Gegenstand per
Klick, den Rest erledigt die Tastatur:

| Taste | Wirkung |
|---|---|
| Klick oder `Enter` | abstellen |
| `R` | drehen (ein Rechtsklick dreht auch direkt) |
| `I` | ins Inventar |
| `Entf` | löschen, ein zweiter Druck bestätigt |
| `Esc` | abbrechen |

Aus dem Inventar neu platzieren kostet nichts, Löschen erstattet nichts. Der Schreibtisch einer Person und der Raum einer
offenen Besprechung lassen sich verschieben, aber nicht entfernen. Was schon im Raum stand, lässt sich nicht drehen und
nicht nachkaufen. Beim Umzug kommt es ins Inventar, ebenso alles, was im neuen Raum keinen Platz findet. Die Richtung hat
Folgen: Beim Schreibtisch sitzt die Figur anders, beim Besprechungsraum wandert die Tür.

## Du im Spiel

Du läufst als Geschäftsführung selbst durch Büro und Stadt, per Klick oder mit Pfeiltasten und WASD. Klickst du jemanden an, gehst du hin. Name und Aussehen stellst du im Team-Tab ein. Unter Bauen gibt es einmal kostenlos den Chefschreibtisch mit Pineapple-Laptop. Ein Klick darauf, und du setzt dich hin. Sitzt du dort, öffnet ein weiterer Klick auf den Laptop, `Enter` oder der Knopf links PineappleOS. **Nachrichten** sammelt, was auf dich wartet: Befehle, Verträge, Freigaben, Abnahmen und Bewerbungen aus dem Projektordner. **Einstellungen** auf dem Laptop verbinden weitere Anbieter über ihre API: OpenAI, Google Gemini, Mistral, OpenRouter, Ollama, LM Studio oder einen eigenen OpenAI-kompatiblen Endpunkt. Agenten dieser Anbieter bekommen nur Dateiwerkzeuge im Arbeitsbereich, die der Server selbst ausführt (`server/providers/compatible.ts`). Schlüssel liegen in `data/verbindungen.json`, nur für den Benutzer lesbar. Der Laptop läuft unter PineappleOS: Schreibtisch mit Programmen, Dock, Fenster. Der **Browser** zeigt Ergebnisse abgeschirmt direkt auf dem Laptop, auch aus der Post und aus Dateien. **Post** ist dein Postfach: Fertige Arbeit kommt dort als Mail an, mit Anhang zum Prüfen und der Freigabe. **Roadmap** zeigt alle Aufgaben nach Jetzt, Als Nächstes, Später und Erledigt, mit Verantwortlichen und Kosten. **Dateien** ist der Dateimanager, dort lässt sich eine HTML-Datei auch starten. **Sprint** erscheint, sobald ein Scrum Master eingestellt ist: Planning als echter Lauf, deine Entscheidung, Board aus dem echten Stand, Retrospektive als echte Besprechung. **Rollen** ist ein Markdown-Programm (mit Zettelfarbe je Rolle; ohne Angabe gilt eine Voreinstellung): Du schreibst eine Rolle aus der Vorlage oder lädst eine MD-Datei, das Spiel liest Name, Vorlage, Modell, Aufgabe, Anforderungen und Fähigkeiten daraus. **Akten** zeigt je Person Kosten, Ergebnisse, mitgebrachte und dazugelernte Fähigkeiten und die Teamzuordnung. Die Figur ist nur dein Bild: Sie belegt keinen Platz, kostet nichts und ändert nichts daran, was die Agenten dürfen.

## Ansicht

Mausrad oder Trackpad zoomen, ebenso `+` und `-`, `0` setzt zurück. Im Büro verschiebt Ziehen die Ansicht, in der Stadt folgt sie der Figur.

## Anbauen und Stockwerke

Am eigenen Neubau wächst das Haus im Bereich Bauen, soweit das Grundstück es hergibt: klein bis 13 × 10 Felder und 2 Etagen, mittel bis 16 × 12 und 3, groß bis 19 × 14 und 4. Gemietete Läden und das Elternhaus bleiben, wie sie sind.

Für das erste Stockwerk wählst du den Platz für Treppe oder Fahrstuhl selbst. Der Aufgang steht auf jeder Etage an derselben Stelle, das Feld davor bleibt frei, und die Drehung wählt dessen Seite. Weitere Aufgänge verkürzen die Wege, die Figuren nehmen den nächsten. Der letzte Aufgang bleibt stehen. Etagen wechselst du mit `Bild auf`, `Bild ab`, den Knöpfen links oder einem Klick auf den Aufgang.

**Abteilungen** lassen sich jederzeit neu abstecken: im Bereich Bauen oder im Feld der Abteilung. Wer dann im Bereich sitzt, gehört dazu. Budget und Wissen bleiben. Auflösen geht, solange dort nichts läuft.

## Die Stadt

Am Haus jeder Firma steht ein Schild mit ihrem Namen und dem Zusatz Corp., sofern der Name keine Rechtsform trägt. So sieht man auch
die anderen Firmen des Spielstands. Teilen sich mehrere ein Haus, stehen alle auf dem Schild.

Silly Valley ist eine amerikanische Kleinstadt mit fünf Straßen, Wohnhäusern, kleinen Geschäften, leerstehenden Läden und
freien Grundstücken. Die Firma beginnt im Elternhaus, im Kinderzimmer oder in der Garage. Mit „Nach draußen" verlässt
der Spieler das Büro und läuft als eigene Figur per Klick oder Pfeiltasten durch die Stadt.

| Ort | Was man dort tut | Baupunkte |
|---|---|---|
| Elternhaus | Zwischen Kinderzimmer und Garage wechseln, immer möglich | 0 |
| Eckladen (9 × 7), Altes Postamt (11 × 9), Altes Kino (13 × 10) | Anmieten, dann einziehen | 60, 150, 260 |
| Fünf freie Grundstücke | Kaufen, bauen, einziehen. Neubau 10 × 8, 13 × 9 oder 15 × 11 | 60 + 100, 100 + 180, 180 + 300 |

Was man tun kann, erscheint erst, wenn die Figur davor steht. Bezahlt wird in Baupunkten, nie aus dem KI-Budget.
Die Agenten arbeiten weiter, während der Spieler unterwegs ist; über dem eigenen Gebäude steht ihr echter Stand. Mitten in
laufender Arbeit zieht niemand um, gekauft und gemietet werden darf trotzdem. Möbel kommen mit, Besitz und Mietverträge
bleiben erhalten, auch wenn die Firma woanders sitzt.

## Bestehendes Projekt einbinden

Bei der Gründung kann eine Firma einen vorhandenen Ordner bekommen (Code, Dokumente). Das Team darf dort lesen und
ändern; für Agenten und Oberfläche erscheint er als `projekt/`. Technisch ist er ein zweiter erlaubter Ordner
(`--add-dir`) neben dem Arbeitsbereich, `--restricted` gilt weiter: Alles außerhalb beider Orte wird abgewiesen,
der Echtbeweis belegt das. Spielstand, Verbrauchsbuch und Ergebnisse bleiben außerhalb des Projekts. Das ganze
Zuhause, die ganze Platte und der Datenordner von Silly Valley sind als Projekt ausgeschlossen. Agenten führen keine
Befehle aus, also auch kein Git; ob eine Änderung ins Repository kommt, entscheidet der Mensch wie bisher.

## Zum Ausprobieren

```bash
SILLYVALLEY_BAUPUNKTE=unendlich npm run dev
```

Mit diesem Schalter kostet Bauen nichts: Möbel, Abteilungen und Umzug sind frei, die Anzeige zeigt ∞. Die
Startkonfiguration der Vorschau (`.claude/launch.json`) setzt ihn. Am KI-Budget ändert er nichts.

## Prüfen

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` läuft ohne echte Agenten und nutzt die Attrappe `test/fake-agent.mjs`. Sie ist nur für Tests gedacht;
das Spiel kennzeichnet sie unübersehbar, wenn sie aktiv ist.

```bash
npm run test:live
```

Der Echtbeweis läuft mit echten Agenten, kostet rund 8 Cent API-Gegenwert und gleicht das Verbrauchsbuch
gegen die Transkripte ab, die die CLI selbst führt und die Silly Valley nie schreibt. Er beweist auch, dass Agenten
einander in Besprechungen wirklich hören, dass ein Beschluss spätere Arbeit erreicht, und dass ein Manager nur
im Team und im Budget plant und ohne Freigabe-Stufe nichts startet.

## Aufbau

```
shared/          Datenmodell, Katalog mit Preisen, Grundriss-Regeln (Server und Client)
server/
  engine.ts      Spielregeln, Läufe, Budget-Sperren, Wiederherstellung
  providers/     Anbieter-Schnittstelle und Claude-CLI-Adapter
  http.ts        API und abgeschotteter Ergebnis-Server
client/
  world/         Pixel-Rasterung, Möbel, Figuren, Räume, Spielwelt
  ui/            Oberfläche als Vorlagen, DOM-Abgleich
test/            Regeltests, HTTP-Sicherheit, Echtbeweis
```

Ein weiterer Anbieter ist eine weitere Datei neben `server/providers/anthropic.ts`. Das Spiel kennt nur die
Ereignisse aus `server/providers/types.ts`.

## Was beim Bauen gemessen wurde

Diese Eigenheiten der CLI sind nicht dokumentiert und bestimmen die Abrechnung. Sie sind im Code kommentiert
und durch Tests abgesichert; bei einem CLI-Update prüft `npm run test:live` sie erneut.

- **`total_cost_usd` und `modelUsage` summieren über die ganze Session**, `usage` gilt pro Lauf. Der Preis eines
  fortgesetzten Laufs ist deshalb die Differenz zum vorherigen Stand.
- **`--max-budget-usd` prüft gegen die Session-Summe**, nicht gegen den Lauf. Übergeben wird deshalb
  `bisheriger Stand + Auftragslimit`.
- **Die CLI prüft ihr Limit nur zwischen zwei Schritten.** Darum stoppt zusätzlich ein Wächter im Server den
  Prozess mitten im Schritt, sobald der mitgezählte Verbrauch das Limit erreicht.
- **Gestoppte Läufe melden keine Kosten** und tauchen auch später nicht in der Session-Summe auf. Sie werden aus
  mitgezählten Tokens gebucht; die Ausgabe der letzten Nachricht ist anhand des empfangenen Textes geschätzt und
  im Verbrauchsbuch als berechnet gekennzeichnet.
- **`--json-schema` liefert das Ergebnis in `structured_output`**, auch zusammen mit reinen Lesewerkzeugen. Die CLI
  ergänzt dafür selbst das Werkzeug `StructuredOutput`.

## Grenzen und Sicherheit

Agenten laufen mit `--restricted`, `--strict-mcp-config` und einer festen Werkzeugliste:

- Dateien nur im Arbeitsbereich der Firma und im eingebundenen Projekt, kein Bash, keine verbundenen Konten des Benutzers
- Befehle nur über einen Antrag, den der Mensch einzeln freigibt (siehe oben)
- Prüfstufen, Besprechungen und die Planung eines Managers nur mit Lesewerkzeugen
- Web nur, wenn ein Auftrag es ausdrücklich erlaubt
- Umgebungsvariablen über eine Whitelist, damit keine Geheimnisse mitwandern

Der Server nimmt nur lokale, gleichursprüngliche JSON-Anfragen an. Ergebnisse von Agenten laufen auf einem eigenen
Port und damit einem eigenen Ursprung: Ein Prototyp darf Skripte und `localStorage` nutzen, erreicht aber weder
die Spiel-API noch das Netz.

## Veröffentlichung

Vor einer Veröffentlichung als Produkt ist das zu klären:

- **Abo-Login:** Anthropic erlaubt Drittprodukten ohne Genehmigung keinen claude.ai-Login und keine Abo-Kontingente.
   Lokal für den Eigenbedarf funktioniert der
   Login; ein Produkt braucht API-Schlüssel der Spieler oder eine Genehmigung.

Der Fahrplan steht in [docs/fahrplan.md](docs/fahrplan.md).
