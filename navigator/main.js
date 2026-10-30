// Navigator: folders and a file list side by side, like Apple Mail or Notes.
// Deliberately small: no settings tab, no index, everything comes straight from the vault.
const { Plugin, ItemView, Modal, Menu, Notice, TFile, TFolder, setIcon, getIcon, debounce } = require("obsidian");

const VIEW = "wf-navigator";
// Pseudo folder at the top of the tree: the most recently modified files. Stored in data.folder like a real path.
const RECENT = { path: ":recent", name: "Zuletzt bearbeitet" };
const RECENT_MAX = 50;
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
const TYPE_ICONS = {
	pdf: "file-text",
	doc: "file-type", docx: "file-type", odt: "file-type", rtf: "file-type", pages: "file-type",
	xls: "file-spreadsheet", xlsx: "file-spreadsheet", csv: "file-spreadsheet", numbers: "file-spreadsheet",
	zip: "file-archive",
	mp3: "file-audio", m4a: "file-audio", wav: "file-audio",
	mp4: "file-video", mov: "file-video",
	py: "file-code", js: "file-code", json: "file-code", xml: "file-code", xsd: "file-code", html: "file-code", xhtml: "file-code", css: "file-code",
};

module.exports = class NavigatorPlugin extends Plugin {
	async onload() {
		this.data = Object.assign({ folder: "/", expanded: [], icons: {}, notesOnly: false }, await this.loadData());
		this.registerView(VIEW, (leaf) => new NavigatorView(leaf, this));
		this.addCommand({ id: "open", name: "Navigator öffnen", callback: () => this.activate() });
		this.addCommand({
			id: "reveal",
			name: "Aktuelle Datei im Navigator zeigen",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.activate().then((view) => view && view.reveal(file));
				return true;
			},
		});
		// Open on app start only: after a plugin reload Obsidian restores the existing tab itself, a bit later
		if (!this.app.workspace.layoutReady) this.app.workspace.onLayoutReady(() => {
			if (!this.app.workspace.getLeavesOfType(VIEW).length) this.activate();
		});
		// Carry stored paths (selected folder, expanded folders, icons) along when folders are renamed or moved
		this.registerEvent(this.app.vault.on("rename", (file, old) => {
			if (!(file instanceof TFolder)) return;
			const move = (p) => (p === old ? file.path : p.startsWith(old + "/") ? file.path + p.slice(old.length) : p);
			this.data.folder = move(this.data.folder);
			this.data.expanded = this.data.expanded.map(move);
			this.data.icons = Object.fromEntries(Object.entries(this.data.icons).map(([p, i]) => [move(p), i]));
			this.save();
		}));
	}

	async activate() {
		const ws = this.app.workspace;
		let leaf = ws.getLeavesOfType(VIEW)[0];
		if (!leaf) {
			leaf = ws.getLeftLeaf(false);
			await leaf.setViewState({ type: VIEW, active: true });
		}
		await ws.revealLeaf(leaf);
		if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
		return leaf.view instanceof NavigatorView ? leaf.view : null;
	}

	save() {
		this.saveData(this.data);
	}
};

class NavigatorView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.previews = new Map(); // path -> { mtime, text }
		this.filter = "";
		this.cursor = null; // selected file in the list
		this.refresh = debounce(() => this.render(), 150, true);
	}

	getViewType() { return VIEW; }
	getDisplayText() { return "Navigator"; }
	getIcon() { return "folder-tree"; }

	get data() { return this.plugin.data; }

	async onOpen() {
		this.contentEl.addClass("wfn-view");
		const root = this.contentEl.createDiv("wfn");
		// Obsidian's tab bar and vault switcher are hidden (styles.css), this bar takes their place like Mail's title bar
		const side = root.createDiv("wfn-side");
		const bar = side.createDiv("wfn-titlebar");
		const hide = bar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Seitenleiste ausblenden" } });
		setIcon(hide, "panel-left");
		hide.onclick = () => this.app.workspace.leftSplit.collapse();
		this.treeEl = side.createDiv({ cls: "wfn-tree", attr: { tabindex: "0" } });
		const pane = root.createDiv("wfn-pane");
		const head = pane.createDiv("wfn-head");
		const heading = head.createDiv("wfn-heading");
		this.headTitleEl = heading.createDiv("wfn-title");
		this.countEl = heading.createDiv("wfn-count");
		this.kindEl = head.createDiv("clickable-icon");
		this.kindEl.onclick = () => { this.data.notesOnly = !this.data.notesOnly; this.plugin.save(); this.render(); };
		const add = head.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Neue Notiz" } });
		setIcon(add, "square-pen");
		add.onclick = () => this.newNote(this.folder());
		this.filterEl = pane.createEl("input", { cls: "wfn-filter", attr: { type: "search", placeholder: "Filtern" } });
		this.filterEl.oninput = () => { this.filter = this.filterEl.value.trim().toLowerCase(); this.renderList(); };
		this.filterEl.onkeydown = (e) => {
			if (e.key === "ArrowDown") { e.preventDefault(); this.listEl.focus(); this.move(1); }
			if (e.key === "Escape") { this.filterEl.value = ""; this.filter = ""; this.renderList(); this.listEl.focus(); }
		};
		this.listEl = pane.createDiv({ cls: "wfn-list", attr: { tabindex: "0" } });

		this.treeEl.onkeydown = (e) => this.treeKey(e);
		this.listEl.onkeydown = (e) => this.listKey(e);
		this.treeEl.oncontextmenu = (e) => { if (e.target === this.treeEl) this.folderMenu(e, this.app.vault.getRoot()); };

		const vault = this.app.vault;
		this.registerEvent(vault.on("create", () => this.refresh()));
		this.registerEvent(vault.on("delete", () => this.refresh()));
		this.registerEvent(vault.on("rename", (file, old) => {
			if (this.cursor === old) this.cursor = file.path;
			this.previews.delete(old);
			this.refresh();
		}));
		this.registerEvent(vault.on("modify", (file) => {
			this.previews.delete(file.path);
			if (this.isRecent() || (this.items && this.items.includes(file))) this.refresh();
		}));
		// Switching tabs follows the active file: jump to its folder unless it is already in the list
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			if (!file) return;
			if (this.items && this.items.includes(file)) { this.cursor = file.path; this.markCursor(); this.scrollToCursor(); }
			else this.reveal(file);
		}));
		this.render();
	}

	isRecent() { return this.data.folder === RECENT.path; }

	folder() {
		const f = this.app.vault.getAbstractFileByPath(this.data.folder);
		return f instanceof TFolder ? f : this.app.vault.getRoot();
	}

	render() {
		this.renderTree();
		this.renderList();
	}

	// ---- Folder tree ----

	renderTree() {
		const scroll = this.treeEl.scrollTop;
		this.treeEl.empty();
		this.visible = [];
		const expanded = new Set(this.data.expanded);
		this.recentRow();
		const walk = (folder, depth) => {
			const subs = folder.children.filter((c) => c instanceof TFolder).sort(byName);
			this.folderRow(folder, depth, subs.length > 0, folder.isRoot() || expanded.has(folder.path));
			if (folder.isRoot() || expanded.has(folder.path)) subs.forEach((s) => walk(s, depth + 1));
		};
		walk(this.app.vault.getRoot(), 0);
		this.treeEl.scrollTop = scroll;
	}

	recentRow() {
		this.visible.push(RECENT);
		const row = this.treeEl.createDiv("wfn-row wfn-row-recent");
		row.toggleClass("is-selected", this.isRecent());
		row.createDiv("wfn-chevron");
		setIcon(row.createDiv("wfn-icon"), "clock");
		row.createDiv({ cls: "wfn-name", text: RECENT.name });
		row.onclick = () => this.select(RECENT);
	}

	folderRow(folder, depth, hasChildren, open) {
		this.visible.push(folder);
		const row = this.treeEl.createDiv("wfn-row");
		row.style.setProperty("--depth", String(Math.max(0, depth - 1)));
		row.toggleClass("is-selected", !this.isRecent() && folder.path === this.folder().path);
		row.toggleClass("is-collapsed", !open);
		// The vault itself reads as a section header like an account in Mail, but stays selectable
		row.toggleClass("wfn-section", folder.isRoot());
		if (!folder.isRoot()) {
			const chevron = row.createDiv("wfn-chevron");
			if (hasChildren) {
				setIcon(chevron, "chevron-down");
				chevron.onclick = (e) => { e.stopPropagation(); this.toggle(folder); };
			}
			setIcon(row.createDiv("wfn-icon"), this.data.icons[folder.path] || "folder");
		}
		row.createDiv({ cls: "wfn-name", text: folder.isRoot() ? this.app.vault.getName() : folder.name });
		const files = folder.children.filter((c) => c instanceof TFile && this.shows(c)).length;
		if (files) row.createDiv({ cls: "wfn-num", text: String(files) });

		row.onclick = () => this.select(folder);
		row.ondblclick = () => hasChildren && !folder.isRoot() && this.toggle(folder);
		row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); this.folderMenu(e, folder); };

		// Dragging: move folders, drop files and folders here
		if (!folder.isRoot()) {
			row.draggable = true;
			row.ondragstart = (e) => {
				const dm = this.app.dragManager;
				dm.onDragStart(e, dm.dragFolder(e, folder));
			};
		}
		row.ondragover = (e) => {
			const d = this.app.dragManager.draggable;
			if (!d || !["file", "files", "folder"].includes(d.type)) return;
			e.preventDefault();
			row.addClass("is-drop");
		};
		row.ondragleave = () => row.removeClass("is-drop");
		row.ondrop = async (e) => {
			row.removeClass("is-drop");
			const d = this.app.dragManager.draggable;
			const items = ((d && (d.files || (d.file && [d.file]))) || []).filter((item) =>
				item !== folder && item.parent !== folder && !(item instanceof TFolder && folder.path.startsWith(item.path + "/")));
			if (!items.length) return;
			e.preventDefault();
			for (const item of items) await this.app.fileManager.renameFile(item, join(folder, item.name));
		};
	}

	select(folder) {
		this.data.folder = folder.path;
		this.plugin.save();
		this.filterEl.value = "";
		this.filter = "";
		this.render();
	}

	toggle(folder, open) {
		const set = new Set(this.data.expanded);
		const isOpen = set.has(folder.path);
		if (open === undefined) open = !isOpen;
		if (open === isOpen) return false;
		open ? set.add(folder.path) : set.delete(folder.path);
		this.data.expanded = [...set];
		this.plugin.save();
		this.renderTree();
		return true;
	}

	treeKey(e) {
		const current = this.isRecent() ? RECENT : this.folder();
		const i = this.visible.indexOf(current);
		const hasChildren = current !== RECENT && current.children.some((c) => c instanceof TFolder);
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			const next = this.visible[i + (e.key === "ArrowDown" ? 1 : -1)];
			if (next) this.select(next);
		} else if (e.key === "ArrowRight") {
			if (current === RECENT || current.isRoot() || !hasChildren || !this.toggle(current, true)) this.listEl.focus();
		} else if (e.key === "ArrowLeft") {
			if (current !== RECENT && !this.toggle(current, false) && current.parent) this.select(current.parent);
		} else if (e.key === "Enter" || e.key === "Tab") {
			this.listEl.focus();
			if (!this.cursor) this.move(1);
		} else return;
		e.preventDefault();
		const row = this.treeEl.querySelector(".is-selected");
		if (row) row.scrollIntoView({ block: "nearest" });
	}

	// ---- File list ----

	// The toggle in the head: only notes or all files. "Zuletzt bearbeitet" always lists notes only.
	shows(file) {
		return file.extension === "md" || !this.data.notesOnly;
	}

	files() {
		if (this.isRecent()) {
			return this.app.vault.getMarkdownFiles()
				.filter((f) => f.name.toLowerCase().includes(this.filter))
				.sort((a, b) => b.stat.mtime - a.stat.mtime)
				.slice(0, RECENT_MAX);
		}
		const folder = this.folder();
		let files;
		if (this.filter) {
			files = [];
			const walk = (f) => f.children.forEach((c) => (c instanceof TFile ? files.push(c) : walk(c)));
			walk(folder);
			files = files.filter((f) => f.name.toLowerCase().includes(this.filter));
		} else {
			files = folder.children.filter((c) => c instanceof TFile);
		}
		return files.filter((f) => this.shows(f)).sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	renderList() {
		const folder = this.folder();
		this.headTitleEl.setText(this.isRecent() ? RECENT.name : folder.isRoot() ? this.app.vault.getName() : folder.name);
		const files = this.files();
		this.countEl.setText(files.length === 1 ? "1 Datei" : `${files.length} Dateien`);
		this.kindEl.toggle(!this.isRecent());
		this.kindEl.toggleClass("is-active", this.data.notesOnly);
		setIcon(this.kindEl, this.data.notesOnly ? "file-text" : "files");
		this.kindEl.setAttr("aria-label", this.data.notesOnly ? "Nur Notizen, klicken für alle Dateien" : "Alle Dateien, klicken für nur Notizen");
		const scroll = this.listEl.scrollTop;
		this.listEl.empty();
		this.items = files;
		for (const file of files) this.fileRow(file);
		if (!files.length) this.listEl.createDiv({ cls: "wfn-empty", text: this.filter ? "Nichts gefunden" : "Keine Dateien" });
		this.listEl.scrollTop = scroll;
		this.markCursor();
	}

	fileRow(file) {
		const row = this.listEl.createDiv({ cls: "wfn-item", attr: { "data-path": file.path } });
		const text = row.createDiv("wfn-item-text");
		const top = text.createDiv("wfn-item-top");
		top.createDiv({ cls: "wfn-item-title", text: file.extension === "md" ? file.basename : file.name });
		top.createDiv({ cls: "wfn-item-date", text: when(file.stat.mtime) });
		const preview = text.createDiv("wfn-item-preview");
		if ((this.isRecent() || this.filter) && file.parent !== this.folder()) text.createDiv({ cls: "wfn-item-path", text: file.parent.path });

		const ext = file.extension.toLowerCase();
		if (ext === "md") {
			this.preview(file).then((t) => preview.setText(t));
			const img = this.firstImage(file);
			if (img) this.thumb(row, img);
		} else {
			preview.setText(`${ext.toUpperCase()} · ${size(file.stat.size)}`);
			if (IMAGES.has(ext)) this.thumb(row, file);
			else setIcon(row.createDiv("wfn-type"), TYPE_ICONS[ext] || "file");
		}

		// A click shows the file and keeps focus in the list (to flip through quickly); double-click jumps into the editor
		row.onclick = (e) => {
			this.cursor = file.path;
			this.markCursor();
			this.listEl.focus();
			if (e.metaKey) this.openItem(file, "tab");
			else if (this.opensInside(file)) this.peek(file);
		};
		// Middle click opens in a new tab like Cmd-click; mousedown would otherwise start autoscroll
		row.onmousedown = (e) => { if (e.button === 1) e.preventDefault(); };
		row.onauxclick = (e) => {
			if (e.button !== 1) return;
			e.preventDefault();
			this.cursor = file.path;
			this.markCursor();
			this.openItem(file, "tab");
		};
		row.ondblclick = () => this.openItem(file, false);
		row.oncontextmenu = (e) => { e.preventDefault(); this.fileMenu(e, file); };
		row.draggable = true;
		row.ondragstart = (e) => {
			const dm = this.app.dragManager;
			dm.onDragStart(e, dm.dragFile(e, file));
		};
	}

	thumb(row, file) {
		row.createEl("img", { cls: "wfn-thumb", attr: { src: this.app.vault.getResourcePath(file), loading: "lazy", alt: "" } });
	}

	firstImage(file) {
		const cache = this.app.metadataCache.getFileCache(file);
		for (const embed of (cache && cache.embeds) || []) {
			const target = this.app.metadataCache.getFirstLinkpathDest(embed.link.split("#")[0], file.path);
			if (target && IMAGES.has(target.extension.toLowerCase())) return target;
		}
		return null;
	}

	async preview(file) {
		const hit = this.previews.get(file.path);
		if (hit && hit.mtime === file.stat.mtime) return hit.text;
		const raw = await this.app.vault.cachedRead(file);
		const text = raw
			.replace(/^---\n[\s\S]*?\n---\n?/, "")
			.replace(/^\s*# .*\n?/, "") // the H1 usually just repeats the title
			.replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/^\s*(#+|>|[-*+]( \[.\])?|\d+\.)\s*/gm, "")
			.replace(/\*\*|__|~~|==|[*`|]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 220);
		this.previews.set(file.path, { mtime: file.stat.mtime, text });
		return text;
	}

	markCursor() {
		if (!this.listEl) return;
		this.listEl.querySelectorAll(".wfn-item").forEach((el) => el.toggleClass("is-selected", el.dataset.path === this.cursor));
	}

	scrollToCursor() {
		const row = this.listEl.querySelector(".wfn-item.is-selected");
		if (row) row.scrollIntoView({ block: "nearest" });
	}

	move(step) {
		if (!this.items.length) return;
		const i = this.items.findIndex((f) => f.path === this.cursor);
		const next = this.items[Math.min(this.items.length - 1, Math.max(0, i < 0 ? 0 : i + step))];
		this.cursor = next.path;
		this.markCursor();
		this.scrollToCursor();
		// Like Mail: arrow keys show the content right away, focus stays in the list
		if (this.opensInside(next)) this.peek(next);
	}

	listKey(e) {
		const file = this.items.find((f) => f.path === this.cursor);
		if (e.key === "ArrowDown") this.move(1);
		else if (e.key === "ArrowUp") this.move(-1);
		else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) this.treeEl.focus();
		else if ((e.key === "Enter" || e.key === "ArrowRight" || e.key === "Tab") && file) this.openItem(file, e.metaKey ? "tab" : false);
		else return;
		e.preventDefault();
	}

	opensInside(file) {
		return this.app.viewRegistry.isExtensionRegistered(file.extension);
	}

	// Show a file but stay in the list. The editor sometimes grabs focus only after opening.
	async peek(file) {
		await this.openItem(file, false, false);
		if (this.cursor === file.path) this.listEl.focus();
	}

	async openItem(file, where, focus = true) {
		if (!this.opensInside(file)) return this.app.openWithDefaultApp(file.path);
		const leaf = this.app.workspace.getLeaf(where);
		await leaf.openFile(file, { active: focus });
	}

	reveal(file) {
		let f = file.parent;
		const set = new Set(this.data.expanded);
		while (f && !f.isRoot()) { set.add(f.path); f = f.parent; }
		this.data.expanded = [...set];
		this.cursor = file.path;
		this.select(file.parent);
		for (const el of [this.treeEl.querySelector(".is-selected"), this.listEl.querySelector(".is-selected")]) {
			if (el) el.scrollIntoView({ block: "center" });
		}
	}

	// ---- Context menus ----

	fileMenu(e, file) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("In neuem Tab öffnen").setIcon("file-plus").onClick(() => this.openItem(file, "tab")));
		menu.addItem((i) => i.setTitle("Umbenennen …").setIcon("pencil").onClick(() => this.rename(file)));
		menu.addItem((i) => i.setTitle("Im Finder zeigen").setIcon("folder-open").onClick(() => this.app.showInFolder(file.path)));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Löschen").setIcon("trash-2").setWarning(true).onClick(() => this.app.fileManager.trashFile(file)));
		this.app.workspace.trigger("file-menu", menu, file, "wf-navigator");
		menu.showAtMouseEvent(e);
	}

	folderMenu(e, folder) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Neue Notiz").setIcon("square-pen").onClick(() => this.newNote(folder)));
		menu.addItem((i) => i.setTitle("Neuer Ordner …").setIcon("folder-plus").onClick(() => this.newFolder(folder)));
		if (!folder.isRoot()) {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle("Umbenennen …").setIcon("pencil").onClick(() => this.rename(folder)));
			menu.addItem((i) => i.setTitle("Symbol …").setIcon("smile").onClick(() => this.chooseIcon(folder)));
			menu.addItem((i) => i.setTitle("Im Finder zeigen").setIcon("folder-open").onClick(() => this.app.showInFolder(folder.path)));
			menu.addSeparator();
			menu.addItem((i) => i.setTitle("Löschen").setIcon("trash-2").setWarning(true).onClick(() => this.app.fileManager.trashFile(folder)));
			this.app.workspace.trigger("file-menu", menu, folder, "wf-navigator");
		}
		menu.showAtMouseEvent(e);
	}

	// Like Obsidian's own "New note": create "Unbenannt", open it and select the inline title for renaming
	async newNote(folder) {
		const file = await this.app.fileManager.createNewMarkdownFile(folder, "Unbenannt");
		this.cursor = file.path;
		await this.app.workspace.getLeaf(false).openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
	}

	newFolder(parent) {
		ask(this.app, "Neuer Ordner", "", async (name) => {
			const folder = await this.app.vault.createFolder(join(parent, name));
			this.toggle(parent, true);
			this.select(folder);
		});
	}

	rename(item) {
		const isNote = item instanceof TFile;
		const ext = isNote ? "." + item.extension : "";
		ask(this.app, "Umbenennen", isNote ? item.basename : item.name, async (name) => {
			const path = join(item.parent, name + ext);
			if (path !== item.path) await this.app.fileManager.renameFile(item, path);
		});
	}

	chooseIcon(folder) {
		ask(this.app, "Lucide-Symbol (leer = Standard)", this.data.icons[folder.path] || "", (name) => {
			name = name.replace(/^lucide-/, "");
			if (name && !getIcon(name)) return new Notice(`Kein Symbol „${name}“, Namen unter lucide.dev`);
			if (name) this.data.icons[folder.path] = name;
			else delete this.data.icons[folder.path];
			this.plugin.save();
			this.renderTree();
		}, true);
	}
}

// Small input dialog, Enter confirms
function ask(app, title, value, onSubmit, allowEmpty = false) {
	const modal = new Modal(app);
	modal.titleEl.setText(title);
	const input = modal.contentEl.createEl("input", { cls: "wfn-ask", attr: { type: "text", value } });
	input.onkeydown = async (e) => {
		if (e.key !== "Enter" || e.isComposing) return;
		const v = input.value.trim().replace(/[\\/:]/g, "-");
		if (!v && !allowEmpty) return;
		modal.close();
		try { await onSubmit(v); } catch (err) { new Notice(String(err.message || err)); }
	};
	modal.open();
	input.select();
}

function join(folder, name) {
	return folder.isRoot() ? name : `${folder.path}/${name}`;
}

function byName(a, b) {
	return a.name.localeCompare(b.name, "de", { numeric: true });
}

function size(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

// Dates like Mail: time for today, then "Gestern", weekday, date
function when(ms) {
	const d = new Date(ms);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const days = Math.floor((today - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
	if (days <= 0) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
	if (days === 1) return "Gestern";
	if (days < 7) return d.toLocaleDateString("de-DE", { weekday: "long" });
	return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
