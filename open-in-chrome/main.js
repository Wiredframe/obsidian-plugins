const { Plugin, Notice } = require("obsidian");
const { spawn } = require("child_process");

const BROWSER = "Google Chrome";
const MAX_AGE = 1500; // ms zwischen Klick und dem Oeffnen-Versuch

module.exports = class OpenInChromePlugin extends Plugin {
	onload() {
		this.armedAt = 0;

		// Modifier beim Klick nur merken, nicht eingreifen. Obsidian oeffnet den
		// Link erst danach ueber window.open bzw. den Electron-Hauptprozess.
		const remember = (evt) => {
			if (evt.metaKey && evt.altKey) this.armedAt = evt.timeStamp;
		};
		document.addEventListener("mousedown", remember, true);
		this.register(() => document.removeEventListener("mousedown", remember, true));

		// Netz 1: window.open abfangen, bevor der Hauptprozess ueberhaupt gefragt wird.
		const originalOpen = window.open;
		window.open = (url, ...rest) => {
			if (this.armed() && typeof url === "string" && /^https?:\/\//i.test(url)) {
				this.armedAt = 0;
				this.open(url);
				return null;
			}
			return originalOpen.call(window, url, ...rest);
		};
		this.register(() => { window.open = originalOpen; });

		// Netz 2: Obsidian fragt den Renderer per open-url um Erlaubnis, bevor es
		// shell.openExternal aufruft. preventDefault stoppt den Standardbrowser.
		const veto = (evt) => {
			const url = evt.detail && evt.detail.url;
			if (!this.armed() || !/^https?:\/\//i.test(url || "")) return;
			evt.preventDefault();
			this.armedAt = 0;
			this.open(url);
		};
		window.addEventListener("open-url", veto);
		this.register(() => window.removeEventListener("open-url", veto));
	}

	armed() {
		return this.armedAt > 0 && performance.now() - this.armedAt < MAX_AGE;
	}

	open(url) {
		const child = spawn("open", ["-a", BROWSER, url], { detached: true, stdio: "ignore" });
		child.on("error", () => new Notice(`${BROWSER} laesst sich nicht oeffnen.`));
		child.unref();
	}
};
