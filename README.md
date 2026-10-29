# Obsidian-Plugins

Eigene, bewusst minimalistische Plugins für den Vault `~/Vault/Wiredframe`. Ziel: keine fremden Community-Plugins, so wenige Core-Plugins wie möglich, jede Zeile nachvollziehbar.

| Ordner | ID | Was es tut |
|---|---|---|
| `navigator` | `wf-navigator` | Ordner und Dateiliste nebeneinander wie in Mail oder Notizen, alle Dateitypen, Vorschau, Tastatur, Filter, Ordnersymbole. Ersetzt den Datei-Explorer (Core-Plugin aus). |
| `erinnerungen` | `wf-erinnerungen` | `- [ ] Aufgabe (@31 July 2026 14:00)` meldet sich zur Fälligkeit, Statusleiste zeigt Überfälliges, nach `(@` Datumsvorschläge. Format des alten Reminder-Plugins. |
| `source-toolbar` | `source-toolbar` | Formatierungsleiste über dem Editor (TypeScript, `npm run build`). |
| `open-in-chrome` | `open-in-chrome` | Cmd + Option + Klick öffnet externe Links in Chrome. |

Navigator, Erinnerungen und Open in Chrome sind reines JavaScript ohne Build-Schritt.

## Installieren

```sh
./install.sh              # alle
./install.sh navigator    # eines
VAULT=~/anderer-vault ./install.sh
```

Das Skript kopiert `main.js`, `manifest.json` und `styles.css` nach `.obsidian/plugins/<id>/` und lädt das Plugin per `obsidian`-CLI neu, falls Obsidian läuft. Einstellungen (`data.json`) bleiben im Vault.

## Abgelöst

Am 2026-10-29 ersetzt bzw. entfernt: Iconic, Reminder, Homepage, Default New Tab Page, Smart Composer, Mononote, TimeStamper, Opener. Die alten Ordner liegen unter `~/Archiv/Obsidian-Umbau-2026-10-29/`.
