#!/bin/sh
# Kopiert die Plugins in den Vault (VAULT=… für einen anderen) und lädt sie in Obsidian neu.
set -e
cd "$(dirname "$0")"
VAULT="${VAULT:-$HOME/Vault/Wiredframe}"
[ -d "$VAULT/.obsidian" ] || { echo "Kein Vault unter $VAULT" >&2; exit 1; }
for dir in ${@:-*/}; do
	dir="${dir%/}"
	[ -f "$dir/manifest.json" ] || continue
	id=$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$dir/manifest.json")
	target="$VAULT/.obsidian/plugins/$id"
	mkdir -p "$target"
	for f in main.js manifest.json styles.css; do [ -f "$dir/$f" ] && cp "$dir/$f" "$target/"; done
	echo "$id → $target"
	command -v obsidian >/dev/null && pgrep -x Obsidian >/dev/null && obsidian plugin:reload id="$id" >/dev/null 2>&1 || true
done
