# Obsidian plugins and theme

A handful of deliberately tiny Obsidian plugins and one theme, written to replace community plugins with code that fits on a few screens and can be read in one sitting. No settings tabs, no indexes, no network access, no build step for most of them. The user interface is in German.

| Folder | ID | What it does |
|---|---|---|
| `navigator` | `wf-navigator` | Folders and a file list side by side, like Apple Mail or Notes. Shows every file type (PDFs, images, Office files) with a preview line or thumbnail, keyboard navigation, a filter field, a toggle for notes only or all files, folder icons via the context menu. Follows the active tab into its folder and highlights the file. "Zuletzt bearbeitet" at the top lists the 50 most recently modified notes. Meant to replace the core file explorer. |
| `erinnerungen` | `wf-erinnerungen` | Reminders: `- [ ] Task (@31 July 2026 14:00)` notifies you when due, the status bar shows what is overdue, typing `(@` suggests dates. Uses the format of the Reminder community plugin. |
| `source-toolbar` | `source-toolbar` | A formatting toolbar above the editor (TypeScript, see its own README). |
| `open-in-chrome` | `open-in-chrome` | Cmd + Option + click opens an external link in Google Chrome instead of the default browser. |
| `theme` | Wiredframe | Notes styled like a German tax form: section bars for H2, entry fields, table grids, tick boxes. Colours and fonts come from the default theme and your settings, so it follows your accent colour and light or dark mode. |

Navigator, Erinnerungen and Open in Chrome are plain JavaScript. Source Toolbar needs `npm install && npm run build` once.

## Install

```sh
./install.sh                 # everything
./install.sh navigator theme # just these
VAULT=~/path/to/vault ./install.sh
```

The script copies `main.js`, `manifest.json` and `styles.css` to `.obsidian/plugins/<id>/` and the theme to `.obsidian/themes/<name>/`. If Obsidian is running and the `obsidian` CLI is available, plugins are reloaded right away. A plugin installed for the first time has to be enabled once under Settings › Community plugins. Settings (`data.json`) stay in the vault.

## License

MIT
