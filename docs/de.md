# Google Mein Gerät finden

## Überblick

Diese Integration bringt die Geräte deines Google-Kontos **Mein Gerät finden** (Find Hub) in
Gladys: Android-Handys und -Tablets sowie die Bluetooth-Tracker des Find-Hub-Netzwerks (Chipolo,
Pebblebee, Moto Tag, Kopfhörer…).

Für jedes Gerät erhält Gladys:

- **Position**: den Ortsnamen oder die Koordinaten der letzten Position;
- **Zu Hause**: 1, wenn das Gerät im Radius um das Zuhause ist, sonst 0;
- **Entfernung von zu Hause** (km) und **Positionsgenauigkeit** (m);
- **Klingeln**: ein Schalter, der das Gerät in voller Lautstärke klingeln lässt, auch im
  Lautlos-Modus.

Außerdem gibt es:

- drei **Szenen-Auslöser**: _Ein Gerät hat eine neue Position_, _Ein Gerät kommt nach Hause_,
  _Ein Gerät verlässt das Zuhause_ (mit Gerätename, Koordinaten, Entfernung und Google-Maps-Link als
  Variablen);
- drei **Szenen-Aktionen**: _Ein Gerät orten_ (liefert die Position), _Ein Gerät klingeln lassen_,
  _Klingeln eines Geräts stoppen_;
- ein **Dashboard-Widget**, das deine Geräte mit den Tasten Orten und Klingeln auflistet.

Die Positionen sind von Google Ende-zu-Ende-verschlüsselt: Die Integration entschlüsselt sie in
deinem Gladys, mit deinen eigenen Schlüsseln. Sie gehen nirgendwo anders hin.

## Voraussetzungen

Google bietet **keine öffentliche API** für „Mein Gerät finden“. Diese Integration nutzt dieselbe
private API wie die App „Mein Gerät finden“, so wie sie das Open-Source-Projekt
[GoogleFindMyTools](https://github.com/leonboe1/GoogleFindMyTools) beschreibt. Google kann sie
jederzeit ändern.

Die Anmeldung braucht ein echtes Chrome-Fenster und erfolgt daher **einmalig auf einem
Computer**:

1. Installiere Python 3 und Google Chrome auf einem Computer.
2. Lade GoogleFindMyTools herunter und führe in seinem Ordner `pip install -r requirements.txt`
   und `python main.py` aus.
3. Melde dich im sich öffnenden Chrome-Fenster bei deinem Google-Konto an.
4. Wenn die Geräteliste erscheint, **wähle ein Gerät zum Orten**: Das Tool fragt nach der PIN
   (oder dem Muster) der Displaysperre eines deiner Android-Geräte. Damit wird der Schlüssel deiner
   Positionen (`owner_key`) freigeschaltet. Ohne diesen Schritt können die Positionen nicht
   entschlüsselt werden.
5. Das Tool schreibt die Datei `Auth/secrets.json`. Öffne sie mit einem Texteditor und kopiere
   ihren **gesamten** Inhalt.

Dein Gladys-Haus braucht einen Standort (Einstellungen → Häuser) für Anwesenheit und Entfernung.

## Konfiguration

1. Installiere die Integration in Gladys und öffne den Reiter **Konfiguration**.
2. Füge den Inhalt von `secrets.json` in **Inhalt von secrets.json** ein und speichere.
3. Optional: Wähle das **Zuhause**, den **Radius um das Zuhause** (standardmäßig 150 m) und die
   Häufigkeit **Orten alle** (standardmäßig 15 Minuten, `0` = nur auf Abruf). Jede Anfrage weckt
   die Geräte: Sehr kurze Intervalle kosten Akku.
4. Klicke auf **Verbindung testen**: Es zeigt das Konto, die Anzahl der Geräte und den Zustand des
   Push-Kanals.
5. Gehe zum Reiter **Geräte** und füge die gewünschten Geräte hinzu.

`secrets.json` gibt Zugriff auf die Geräte deines Google-Kontos: Halte sie geheim. Sie wird in
einem Geheimfeld von Gladys gespeichert (in der Oberfläche verborgen) und nie in die Logs geschrieben. Verwende
eine eigene `secrets.json` für Gladys: Läuft dieselbe Datei woanders (Home Assistant…), streiten
sich beide um denselben Push-Kanal.

## Fehlerbehebung

- **„secrets.json ist unvollständig“**: Starte GoogleFindMyTools erneut, bis es deine Geräte
  auflistet, und füge dann die neue Datei ein.
- **„Die Positionen können nicht entschlüsselt werden: secrets.json enthält keinen owner_key“**:
  Orte in GoogleFindMyTools ein Gerät (Schritt 4 oben) und füge dann die aktualisierte Datei ein.
- **„Google hat das Konto-Token abgelehnt (BadAuthentication)“**: Das Token wurde widerrufen
  (Passwortänderung, Sicherheitsprüfung des Kontos). Lösche `Auth/secrets.json`, starte
  GoogleFindMyTools erneut und füge die neue Datei ein.
- **Ein Gerät antwortet nie**: Es muss eingeschaltet und online sein, mit aktiviertem „Mein Gerät
  finden“. Ein Tracker wird nur geortet, wenn ein Android-Handy in der Nähe ist.
- **Abzeichen „Push-Kanal getrennt“**: Gladys erreicht `mtalk.google.com` auf Port 5228 (TCP)
  nicht. Öffne diesen ausgehenden Port in deiner Firewall.
- **Weder Anwesenheit noch Entfernung**: Gib deinem Gladys-Haus einen Standort oder wähle es unter
  **Zuhause**.
