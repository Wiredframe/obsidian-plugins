import { App, Editor, MarkdownView, Menu, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, setIcon } from "obsidian";
import {
	WRAPS,
	clearInline,
	cycleTask,
	headingLevel,
	indent,
	inlineActive,
	insert,
	insertBlock,
	lineActive,
	makeCallout,
	setHeading,
	setTask,
	tableMarkdown,
	taskState,
	toggleDone,
	toggleInline,
	toggleLineMode,
} from "./format";
import { IMAGE_EXT, ImageSuggest, LinkModal, NoteSuggest, openTableGrid, pickFiles } from "./ui";

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

interface ToolbarSettings {
	showToolbar: boolean;
	showOnMobile: boolean;
	sourceModeOnly: boolean;
	compact: boolean;
	hiddenButtons: string[];
}

const DEFAULT_SETTINGS: ToolbarSettings = {
	showToolbar: true,
	showOnMobile: true,
	sourceModeOnly: false,
	compact: false,
	hiddenButtons: [],
};

/** The buttons, in the order they appear. "|" is a separator. */
const ORDER = [
	"heading",
	"|",
	"bold",
	"italic",
	"strike",
	"highlight",
	"code",
	"|",
	"bullet",
	"ordered",
	"task",
	"outdent",
	"indent",
	"|",
	"quote",
	"callout",
	"|",
	"link",
	"image",
	"attach",
	"table",
	"|",
	"codeblock",
	"hr",
	"clear",
];

/** What the task button will do next, given what the line says now. */
const TASK_TIPS: Record<string, string> = {
	none: "Task list",
	" ": "Task: mark as indeterminate",
	"/": "Task: mark as done",
	x: "Task: back to a bullet",
};

const CALLOUTS = ["note", "tip", "info", "success", "question", "warning", "danger", "example", "quote"];

interface Action {
	id: string;
	icon: string;
	label: string;
	run: (ed: Editor, anchor: HTMLElement) => void;
	/** Lit up when the caret sits in something this button made. */
	active?: (ed: Editor) => boolean;
	/** A tooltip that depends on where the caret is, for buttons whose next
	 *  press does something other than what they did last time. */
	tip?: (ed: Editor) => string;
	/** Opens a menu or dialog, so it has to wait for the click rather than
	 *  firing on pointerdown, or the same release closes it again. */
	opens?: boolean;
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

export default class SourceToolbarPlugin extends Plugin {
	settings: ToolbarSettings = DEFAULT_SETTINGS;
	actions: Map<string, Action> = new Map();

	async onload() {
		await this.loadSettings();
		for (const a of this.buildActions()) this.actions.set(a.id, a);

		this.addSettingTab(new ToolbarSettingTab(this.app, this));

		// every button is a command too, so anything can have a hotkey
		for (const a of this.actions.values()) {
			this.addCommand({
				id: a.id,
				name: a.label,
				editorCallback: (ed: Editor, ctx) => {
					const anchor = ctx instanceof MarkdownView ? this.buttonEl(ctx, a.id) ?? ctx.containerEl : document.body;
					a.run(ed, anchor);
				},
			});
		}
		this.addCommand({
			id: "toggle-done",
			name: "Tick or untick task",
			editorCallback: (ed: Editor) => toggleDone(ed),
		});
		this.addCommand({
			id: "task-in-progress",
			name: "Task: mark as indeterminate",
			editorCallback: (ed: Editor) => setTask(ed, "/"),
		});
		this.addCommand({
			id: "task-list-toggle",
			name: "Task list on or off",
			editorCallback: (ed: Editor) => toggleLineMode(ed, "task"),
		});
		this.addCommand({
			id: "toggle-toolbar",
			name: "Show or hide the toolbar",
			callback: async () => {
				this.settings.showToolbar = !this.settings.showToolbar;
				await this.saveSettings();
			},
		});

		this.app.workspace.onLayoutReady(() => this.refresh());
		this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
		this.registerEvent(this.app.workspace.on("editor-change", () => this.queueState()));
		this.registerDomEvent(document, "selectionchange", () => this.queueState());
	}

	onunload() {
		// popout windows have their own document, so the views are the truth here
		for (const view of this.views()) this.barEl(view)?.remove();
		for (const el of Array.from(document.querySelectorAll(".stb-bar"))) el.remove();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.rebuild();
	}

	/* -------------------------------------------------------------- *
	 * The bar
	 * -------------------------------------------------------------- */

	/** Views that exist yet: Obsidian defers a restored tab's view until it is
	 *  first shown, and the placeholder answers to nothing but containerEl. */
	private views(): MarkdownView[] {
		return this.app.workspace.getLeavesOfType("markdown").flatMap((leaf) => (leaf.view instanceof MarkdownView ? [leaf.view] : []));
	}

	private barEl(view: MarkdownView): HTMLElement | null {
		return view.containerEl.querySelector<HTMLElement>(":scope > .stb-bar");
	}

	private buttonEl(view: MarkdownView, id: string): HTMLElement | null {
		return this.barEl(view)?.querySelector<HTMLElement>(`[data-stb="${id}"]`) ?? null;
	}

	private wanted(view: MarkdownView): boolean {
		if (view.getMode() !== "source") return false;
		if (!this.settings.sourceModeOnly) return true;
		return (view.getState() as { source?: boolean }).source === true;
	}

	rebuild() {
		for (const view of this.views()) this.barEl(view)?.remove();
		this.refresh();
	}

	refresh() {
		const show = this.settings.showToolbar && (!Platform.isMobile || this.settings.showOnMobile);
		for (const view of this.views()) {
			const bar = this.barEl(view);
			if (!show) {
				bar?.remove();
				continue;
			}
			(bar ?? this.build(view))?.toggleClass("stb-hidden", !this.wanted(view));
		}
		this.queueState();
	}

	private build(view: MarkdownView): HTMLElement | null {
		const content = view.containerEl.querySelector(":scope > .view-content");
		if (!content) return null;
		const bar = createDiv({ cls: "stb-bar" });
		bar.toggleClass("stb-compact", this.settings.compact);
		view.containerEl.insertBefore(bar, content);

		const hidden = new Set(this.settings.hiddenButtons);
		for (const id of ORDER) {
			if (id === "|") {
				if (bar.lastElementChild && !bar.lastElementChild.hasClass("stb-sep")) bar.createDiv({ cls: "stb-sep" });
				continue;
			}
			const a = this.actions.get(id);
			if (!a || hidden.has(id)) continue;

			const b = bar.createEl("button", { cls: "stb-btn", attr: { "data-stb": id, "aria-label": a.label, type: "button" } });
			setIcon(b, a.icon);
			// pointerdown always keeps the editor's focus and selection; the
			// action itself only runs here when it does not open anything
			b.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				if (a.opens) return;
				const ed = this.editor();
				if (ed) a.run(ed, b);
			});
			b.addEventListener("click", () => {
				if (!a.opens) return;
				const ed = this.editor();
				if (ed) a.run(ed, b);
			});
		}
		if (bar.lastElementChild?.hasClass("stb-sep")) bar.lastElementChild.remove();
		return bar;
	}

	private editor(): Editor | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view && view.getMode() === "source" ? view.editor : null;
	}

	/* -------------------------------------------------------------- *
	 * Button state
	 * -------------------------------------------------------------- */

	private stateQueued = false;

	private queueState() {
		if (this.stateQueued) return;
		this.stateQueued = true;
		window.requestAnimationFrame(() => {
			this.stateQueued = false;
			this.paintState();
		});
	}

	private paintState() {
		for (const view of this.views()) {
			const bar = this.barEl(view);
			if (!bar || bar.hasClass("stb-hidden")) continue;
			const ed = view.editor;
			for (const b of Array.from(bar.querySelectorAll<HTMLElement>(".stb-btn"))) {
				const a = this.actions.get(b.dataset.stb ?? "");
				if (!a) continue;
				if (a.active) b.toggleClass("is-active", a.active(ed));
				if (a.tip) {
					const tip = a.tip(ed);
					if (b.getAttr("aria-label") !== tip) b.setAttr("aria-label", tip);
				}
			}
		}
	}

	/* -------------------------------------------------------------- *
	 * What the buttons do
	 * -------------------------------------------------------------- */

	private buildActions(): Action[] {
		const wrap = (id: string, icon: string, label: string): Action => ({
			id,
			icon,
			label,
			run: (ed) => toggleInline(ed, WRAPS[id]),
			active: (ed) => inlineActive(ed, WRAPS[id]),
		});
		const line = (id: "bullet" | "ordered" | "task" | "quote", icon: string, label: string): Action => ({
			id,
			icon,
			label,
			run: (ed) => toggleLineMode(ed, id),
			active: (ed) => lineActive(ed, id),
		});

		return [
			{
				id: "heading",
				icon: "heading",
				label: "Heading",
				opens: true,
				active: (ed) => headingLevel(ed) > 0,
				run: (ed, anchor) => {
					const menu = new Menu();
					menu.addItem((i) => i.setTitle("Body text").setChecked(headingLevel(ed) === 0).onClick(() => setHeading(ed, 0)));
					for (let l = 1; l <= 6; l++) {
						menu.addItem((i) =>
							i
								.setTitle(`Heading ${l}`)
								.setChecked(headingLevel(ed) === l)
								.onClick(() => setHeading(ed, l)),
						);
					}
					this.showMenu(menu, anchor);
				},
			},
			wrap("bold", "bold", "Bold"),
			wrap("italic", "italic", "Italic"),
			wrap("strike", "strikethrough", "Strikethrough"),
			wrap("highlight", "highlighter", "Highlight"),
			wrap("code", "code", "Inline code"),
			line("bullet", "list", "Bulleted list"),
			line("ordered", "list-ordered", "Numbered list"),
			{
				id: "task",
				icon: "list-checks",
				label: "Task list",
				run: (ed) => cycleTask(ed),
				active: (ed) => lineActive(ed, "task"),
				tip: (ed) => TASK_TIPS[taskState(ed) ?? "none"] ?? "Task list",
			},
			{ id: "outdent", icon: "outdent", label: "Decrease indent", run: (ed) => indent(ed, true) },
			{ id: "indent", icon: "indent-increase", label: "Increase indent", run: (ed) => indent(ed, false) },
			line("quote", "text-quote", "Quote"),
			{
				id: "callout",
				icon: "message-square-quote",
				label: "Callout",
				opens: true,
				run: (ed, anchor) => {
					const menu = new Menu();
					for (const type of CALLOUTS) {
						menu.addItem((i) => i.setTitle(type[0].toUpperCase() + type.slice(1)).onClick(() => makeCallout(ed, type)));
					}
					this.showMenu(menu, anchor);
				},
			},
			{
				id: "link",
				icon: "link",
				label: "Insert link",
				opens: true,
				run: (ed) => {
					const sel = ed.getSelection();
					new LinkModal(
						this.app,
						sel,
						(text, url) => insert(ed, `[${text || url}](${url})`),
						() => this.noteLink(ed, sel),
					).open();
				},
			},
			{
				id: "image",
				icon: "image",
				label: "Insert image",
				opens: true,
				run: (ed) => {
					new ImageSuggest(this.app, (target, external) => {
						insert(ed, external ? `![](${target})` : this.vaultEmbed(target));
					}).open();
				},
			},
			{
				id: "attach",
				icon: "paperclip",
				label: "Attach a file",
				opens: true,
				run: (ed, anchor) => void this.attach(ed, anchor.ownerDocument),
			},
			{
				id: "table",
				icon: "table",
				label: "Insert table",
				opens: true,
				run: (ed, anchor) => openTableGrid(anchor, (cols, rows) => insertBlock(ed, tableMarkdown(cols, rows), 2)),
			},
			{
				id: "codeblock",
				icon: "code-2",
				label: "Code block",
				run: (ed) => insertBlock(ed, "```\n" + ed.getSelection() + "\n```", 3),
			},
			{ id: "hr", icon: "separator-horizontal", label: "Horizontal rule", run: (ed) => insertBlock(ed, "---") },
			{ id: "clear", icon: "remove-formatting", label: "Clear formatting", run: (ed) => clearInline(ed) },
		];
	}

	private showMenu(menu: Menu, anchor: HTMLElement) {
		const box = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: box.left, y: box.bottom + 2 });
	}

	/** Copy the picked files into the vault where Obsidian keeps attachments,
	 *  and link them. Pictures go in as embeds; a PDF or a document goes in as
	 *  a link, so four attachments under a heading read as four lines rather
	 *  than four scrolling previews. */
	private async attach(ed: Editor, doc: Document) {
		const files = await pickFiles(doc);
		if (!files.length) return;

		const source = this.app.workspace.getActiveFile()?.path ?? "";
		const links: string[] = [];
		for (const file of files) {
			try {
				const path = await this.app.fileManager.getAvailablePathForAttachment(file.name, source);
				const made = await this.app.vault.createBinary(path, await file.arrayBuffer());
				// generateMarkdownLink follows the vault's link style, including
				// relative paths; whether it marks an embed is ours to decide
				const bare = this.app.fileManager.generateMarkdownLink(made, source).replace(/^!/, "");
				links.push(IMAGE_EXT.has(made.extension.toLowerCase()) ? "!" + bare : bare);
			} catch (e) {
				console.error(e);
				new Notice(`Could not attach ${file.name}`);
			}
		}
		if (links.length) insert(ed, links.join("\n"));
	}

	private noteLink(ed: Editor, selection: string) {
		new NoteSuggest(this.app, (file) => {
			const name = this.app.metadataCache.fileToLinktext(file, this.app.workspace.getActiveFile()?.path ?? "", true);
			insert(ed, selection ? `[[${name}|${selection}]]` : `[[${name}]]`);
		}).open();
	}

	/** An embed in whichever link style the vault is set to. */
	private vaultEmbed(path: string): string {
		const file = this.app.vault.getAbstractFileByPath(path);
		const markdownLinks = (this.app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("useMarkdownLinks") === true;
		if (markdownLinks) return `![](${encodeURI(path)})`;
		const name =
			file instanceof TFile ? this.app.metadataCache.fileToLinktext(file, this.app.workspace.getActiveFile()?.path ?? "", true) : path;
		return `![[${name}]]`;
	}
}

/* ------------------------------------------------------------------ *
 * Settings tab
 * ------------------------------------------------------------------ */

class ToolbarSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SourceToolbarPlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Show the toolbar")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showToolbar).onChange(async (v) => {
					this.plugin.settings.showToolbar = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Show it on mobile")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showOnMobile).onChange(async (v) => {
					this.plugin.settings.showOnMobile = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Source mode only")
			.setDesc("Hide the toolbar in Live Preview, leaving it to plain source mode.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.sourceModeOnly).onChange(async (v) => {
					this.plugin.settings.sourceModeOnly = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Compact")
			.setDesc("Smaller buttons and less padding.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.compact).onChange(async (v) => {
					this.plugin.settings.compact = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Buttons").setHeading();

		for (const id of ORDER) {
			if (id === "|") continue;
			const action = this.plugin.actions.get(id);
			if (!action) continue;
			new Setting(containerEl).setName(action.label).addToggle((t) =>
				t.setValue(!this.plugin.settings.hiddenButtons.includes(id)).onChange(async (v) => {
					const hidden = new Set(this.plugin.settings.hiddenButtons);
					if (v) hidden.delete(id);
					else hidden.add(id);
					this.plugin.settings.hiddenButtons = Array.from(hidden);
					await this.plugin.saveSettings();
				}),
			);
		}
	}
}
