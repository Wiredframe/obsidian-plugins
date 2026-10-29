const { Plugin, Notice } = require("obsidian");
const { spawn } = require("child_process");

const BROWSER = "Google Chrome";
const MAX_AGE = 1500; // ms allowed between the click and the open attempt

module.exports = class OpenInChromePlugin extends Plugin {
	onload() {
		this.armedAt = 0;

		// Only remember the modifiers on click, don't interfere. Obsidian opens the
		// link afterwards via window.open or the Electron main process.
		const remember = (evt) => {
			if (evt.metaKey && evt.altKey) this.armedAt = evt.timeStamp;
		};
		document.addEventListener("mousedown", remember, true);
		this.register(() => document.removeEventListener("mousedown", remember, true));

		// Net 1: catch window.open before the main process is even asked.
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

		// Net 2: Obsidian asks the renderer for permission via open-url before it
		// calls shell.openExternal. preventDefault stops the default browser.
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
		child.on("error", () => new Notice(`${BROWSER} lässt sich nicht öffnen.`));
		child.unref();
	}
};
