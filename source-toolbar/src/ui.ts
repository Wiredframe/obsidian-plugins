import { App, Modal, Setting, SuggestModal, TFile } from "obsidian";

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp"]);

/** Case-insensitive subsequence match, the way Obsidian's own pickers feel. */
function matches(haystack: string, needle: string): boolean {
	if (!needle) return true;
	const h = haystack.toLowerCase();
	const n = needle.toLowerCase();
	let i = 0;
	for (const ch of n) {
		i = h.indexOf(ch, i);
		if (i < 0) return false;
		i++;
	}
	return true;
}

/** Pick a note, and get back the link text for it. */
export class NoteSuggest extends SuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder("Link to note…");
	}

	getSuggestions(query: string): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => matches(f.path, query))
			.sort((a, b) => a.path.length - b.path.length)
			.slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		el.createDiv({ text: file.basename });
		el.createDiv({ text: file.path, cls: "stb-suggest-path" });
	}

	onChooseSuggestion(file: TFile) {
		this.onPick(file);
	}
}

/** Pick an image from the vault, or type a URL and take that instead. */
export class ImageSuggest extends SuggestModal<string> {
	constructor(app: App, private onPick: (target: string, external: boolean) => void) {
		super(app);
		this.setPlaceholder("Image from the vault, or paste a URL…");
	}

	getSuggestions(query: string): string[] {
		const files = this.app.vault
			.getFiles()
			.filter((f) => IMAGE_EXT.has(f.extension.toLowerCase()) && matches(f.path, query))
			.sort((a, b) => a.path.length - b.path.length)
			.slice(0, 50)
			.map((f) => f.path);
		return /^(https?:\/\/|data:image\/)/i.test(query.trim()) ? [query.trim(), ...files] : files;
	}

	renderSuggestion(target: string, el: HTMLElement) {
		const external = /^(https?:|data:)/i.test(target);
		el.createDiv({ text: external ? "Insert this URL" : target.split("/").pop() ?? target });
		el.createDiv({ text: external ? target : target, cls: "stb-suggest-path" });
	}

	onChooseSuggestion(target: string) {
		this.onPick(target, /^(https?:|data:)/i.test(target));
	}
}

/** Text and URL for a link. The note button hands over to NoteSuggest. */
export class LinkModal extends Modal {
	private text: string;
	private url = "";

	constructor(
		app: App,
		selection: string,
		private onSubmit: (text: string, url: string) => void,
		private onNote: () => void,
	) {
		super(app);
		// a selected URL is the target, not the label
		this.text = /^\w+:\/\//.test(selection.trim()) ? "" : selection;
		if (!this.text) this.url = /^\w+:\/\//.test(selection.trim()) ? selection.trim() : "";
	}

	onOpen() {
		this.titleEl.setText("Insert link");
		const { contentEl } = this;
		let urlInput: HTMLInputElement | null = null;

		const submit = () => {
			if (!this.url.trim()) return;
			this.close();
			this.onSubmit(this.text.trim(), this.url.trim());
		};
		const onEnter = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				submit();
			}
		};

		new Setting(contentEl).setName("Text").addText((t) => {
			t.setValue(this.text).onChange((v) => (this.text = v));
			t.inputEl.addEventListener("keydown", onEnter);
		});

		new Setting(contentEl).setName("URL").addText((t) => {
			t.setValue(this.url)
				.setPlaceholder("https://")
				.onChange((v) => (this.url = v));
			t.inputEl.addEventListener("keydown", onEnter);
			urlInput = t.inputEl;
		});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Link to note…").onClick(() => {
					this.close();
					this.onNote();
				}),
			)
			.addButton((b) => b.setButtonText("Insert").setCta().onClick(submit));

		window.setTimeout(() => urlInput?.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** The Word-style grid: sweep out a size, click to insert it. */
export function openTableGrid(anchor: HTMLElement, onPick: (cols: number, rows: number) => void): void {
	const MAX = 8;
	// the anchor's own document, so the grid lands in the right popout window
	const doc = anchor.ownerDocument;
	const pop = doc.body.createDiv({ cls: "stb-grid" });
	const label = pop.createDiv({ cls: "stb-grid-label", text: "1 × 1" });
	const board = pop.createDiv({ cls: "stb-grid-board" });
	const cells: HTMLElement[][] = [];

	const close = () => {
		pop.remove();
		doc.removeEventListener("pointerdown", onOutside, true);
		doc.removeEventListener("keydown", onKey, true);
	};
	const onOutside = (e: PointerEvent) => {
		if (!pop.contains(e.target as Node)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	};

	for (let r = 0; r < MAX; r++) {
		const row = board.createDiv({ cls: "stb-grid-row" });
		cells.push([]);
		for (let c = 0; c < MAX; c++) {
			const cell = row.createDiv({ cls: "stb-grid-cell" });
			cells[r].push(cell);
			cell.addEventListener("pointerenter", () => {
				label.setText(`${c + 1} × ${r + 1}`);
				for (let y = 0; y < MAX; y++) for (let x = 0; x < MAX; x++) cells[y][x].toggleClass("is-on", y <= r && x <= c);
			});
			cell.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				close();
				onPick(c + 1, r + 1);
			});
		}
	}

	const box = anchor.getBoundingClientRect();
	const width = doc.defaultView?.innerWidth ?? window.innerWidth;
	pop.style.top = `${box.bottom + 4}px`;
	pop.style.left = `${Math.max(8, Math.min(box.left, width - pop.offsetWidth - 8))}px`;
	doc.addEventListener("pointerdown", onOutside, true);
	doc.addEventListener("keydown", onKey, true);
}

/** The system's own file dialog, through a hidden input rather than Electron,
 *  so it works on a phone too. Resolves empty when the dialog is cancelled. */
export function pickFiles(doc: Document = document): Promise<File[]> {
	return new Promise((resolve) => {
		const input = doc.body.createEl("input", { attr: { type: "file", multiple: "" } });
		input.style.display = "none";

		let done = false;
		const finish = (files: File[]) => {
			if (done) return;
			done = true;
			input.remove();
			doc.defaultView?.removeEventListener("focus", onFocus);
			resolve(files);
		};
		// A cancelled dialog fires "cancel" on current Chromium; the focus
		// coming back is the fallback, delayed so a real pick wins the race.
		const onFocus = () => window.setTimeout(() => finish([]), 400);

		input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
		input.addEventListener("cancel", () => finish([]));
		doc.defaultView?.addEventListener("focus", onFocus);
		input.click();
	});
}
