// Copy the built plugin into a vault so it can be tried without a release.
// Point VAULT at another vault to install it somewhere else.
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const vault = process.env.VAULT ?? join(homedir(), "Vault", "Wiredframe");
const target = join(vault, ".obsidian", "plugins", "source-toolbar");

if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`No vault at ${vault}. Set VAULT to the right one.`);
	process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) copyFileSync(file, join(target, file));
console.log(`Installed in ${target}`);
