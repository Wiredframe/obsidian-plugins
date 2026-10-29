#!/bin/sh
# Copies the plugins and the theme into the vault (VAULT=… for another one) and reloads them in Obsidian.
set -e
cd "$(dirname "$0")"
VAULT="${VAULT:-$HOME/Vault/Wiredframe}"
[ -d "$VAULT/.obsidian" ] || { echo "No vault at $VAULT, set VAULT to the right one." >&2; exit 1; }
running() { command -v obsidian >/dev/null && pgrep -x Obsidian >/dev/null; }

for dir in ${@:-*/}; do
	dir="${dir%/}"
	[ -f "$dir/manifest.json" ] || continue
	if [ -f "$dir/theme.css" ]; then
		name=$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' "$dir/manifest.json")
		target="$VAULT/.obsidian/themes/$name"
		mkdir -p "$target"
		cp "$dir/theme.css" "$dir/manifest.json" "$target/"
		echo "theme $name → $target"
		continue
	fi
	[ -f "$dir/main.js" ] || { echo "$dir: no main.js, build it first (npm run build)" >&2; continue; }
	id=$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$dir/manifest.json")
	target="$VAULT/.obsidian/plugins/$id"
	mkdir -p "$target"
	for f in main.js manifest.json styles.css; do [ -f "$dir/$f" ] && cp "$dir/$f" "$target/"; done
	echo "$id → $target"
	running && obsidian plugin:reload id="$id" >/dev/null 2>&1 || true
done
