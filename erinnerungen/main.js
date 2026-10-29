// Erinnerungen: open tasks with (@31 July 2026) or (@31 July 2026 14:00) notify you when they are due.
// The format is the one of the Reminder community plugin, so existing notes keep working.
const { Plugin, Notice, Menu, EditorSuggest, TFile, moment, setIcon } = require("obsidian");

const TASK = /^\s*[-*+] \[ \] (.*?)\s*\(@([^)]+)\)/;
const FORMATS = ["DD MMMM YYYY HH:mm", "DD MMMM YYYY"];
const DEFAULT_TIME = { hour: 10, minute: 0 };
const CHECK_MS = 30 * 1000;

module.exports = class ErinnerungenPlugin extends Plugin {
	async onload() {
		const saved = await this.loadData();
		this.firstRun = !saved;
		this.notified = new Set((saved && saved.notified) || []);
		this.byFile = new Map(); // path -> [{ key, path, line, title, due }]

		this.status = this.addStatusBarItem();
		this.status.addClass("mod-clickable", "wfe-status");
		this.status.onclick = (e) => this.listMenu(e);

		this.registerEditorSuggest(new DateSuggest(this));

		this.app.workspace.onLayoutReady(async () => {
			for (const file of this.app.vault.getMarkdownFiles()) await this.scan(file);
			// On the very first run, silently accept everything already due, otherwise old reminders fire all at once
			if (this.firstRun) { this.all().filter((r) => r.due <= Date.now()).forEach((r) => this.notified.add(r.key)); this.persist(); }
			this.check();
			this.registerInterval(window.setInterval(() => this.check(), CHECK_MS));
			const vault = this.app.vault;
			this.registerEvent(vault.on("modify", (f) => f instanceof TFile && f.extension === "md" && this.scan(f).then(() => this.check())));
			this.registerEvent(vault.on("create", (f) => f instanceof TFile && f.extension === "md" && this.scan(f)));
			this.registerEvent(vault.on("delete", (f) => {
				for (const path of [...this.byFile.keys()]) if (under(path, f.path)) this.byFile.delete(path);
				this.updateStatus();
			}));
			this.registerEvent(vault.on("rename", (f, old) => {
				// Reminders already shown stay shown under the new path,
				// for a folder that applies to every file inside
				for (const key of [...this.notified]) {
					if (under(key.split("|")[0], old)) { this.notified.delete(key); this.notified.add(f.path + key.slice(old.length)); }
				}
				const moved = [...this.byFile.keys()].filter((path) => under(path, old));
				moved.forEach((path) => this.byFile.delete(path));
				const files = moved.map((path) => vault.getAbstractFileByPath(f.path + path.slice(old.length))).filter((x) => x instanceof TFile);
				if (f instanceof TFile && f.extension === "md" && !files.includes(f)) files.push(f);
				Promise.all(files.map((x) => this.scan(x))).then(() => this.persist());
			}));
		});
	}

	async scan(file) {
		const text = await this.app.vault.cachedRead(file);
		const found = [];
		if (text.includes("(@")) {
			text.split("\n").forEach((line, i) => {
				const m = TASK.exec(line);
				if (!m) return;
				const due = parse(m[2]);
				if (due) found.push({ key: `${file.path}|${m[1]}|${m[2]}`, path: file.path, line: i, title: m[1], raw: m[2], due });
			});
		}
		if (found.length) this.byFile.set(file.path, found);
		else this.byFile.delete(file.path);
		this.updateStatus();
	}

	all() {
		return [...this.byFile.values()].flat().sort((a, b) => a.due - b.due);
	}

	check() {
		const now = Date.now();
		let changed = false;
		for (const r of this.all()) {
			if (r.due > now || this.notified.has(r.key)) continue;
			this.notified.add(r.key);
			this.notify(r);
			changed = true;
		}
		if (changed) this.persist();
		this.updateStatus();
	}

	persist() {
		// Only keep keys that still exist
		const live = new Set(this.all().map((r) => r.key));
		this.saveData({ notified: [...this.notified].filter((k) => live.has(k)) });
	}

	updateStatus() {
		const overdue = this.all().filter((r) => r.due <= Date.now()).length;
		this.status.empty();
		this.status.toggle(this.byFile.size > 0);
		setIcon(this.status.createSpan("wfe-status-icon"), "alarm-clock");
		this.status.createSpan({ text: overdue ? ` ${overdue} überfällig` : "" });
		this.status.toggleClass("is-overdue", overdue > 0);
	}

	notify(r) {
		const notice = new Notice(createFragment((f) => {
			f.createDiv({ cls: "wfe-title", text: r.title });
			f.createDiv({ cls: "wfe-meta", text: `${r.path.replace(/\.md$/, "")} · ${show(r.due)}` });
			const buttons = f.createDiv("wfe-buttons");
			const btn = (label, action) => {
				const b = buttons.createEl("button", { text: label });
				b.onclick = (e) => { e.stopPropagation(); notice.hide(); action(); };
			};
			btn("Öffnen", () => this.open(r));
			btn("Erledigt", () => this.done(r));
		}), 0);
	}

	listMenu(e) {
		const menu = new Menu();
		const now = Date.now();
		const soon = now + 7 * 86400000;
		const list = this.all().filter((r) => r.due <= soon);
		if (!list.length) menu.addItem((i) => i.setTitle("Nichts fällig in den nächsten 7 Tagen").setDisabled(true));
		for (const r of list) {
			menu.addItem((i) => i
				.setTitle(`${show(r.due)}  ${r.title}`)
				.setIcon(r.due <= now ? "alarm-clock-off" : "alarm-clock")
				.onClick(() => this.open(r)));
		}
		menu.showAtMouseEvent(e);
	}

	async open(r) {
		const file = this.app.vault.getAbstractFileByPath(r.path);
		if (!(file instanceof TFile)) return;
		await this.app.workspace.getLeaf(false).openFile(file, { active: true, eState: { line: r.line } });
	}

	async done(r) {
		const file = this.app.vault.getAbstractFileByPath(r.path);
		if (!(file instanceof TFile)) return;
		await this.app.vault.process(file, (text) => {
			const lines = text.split("\n");
			// The line may have moved: find it again by title and date
			const i = lines.findIndex((l) => { const m = TASK.exec(l); return m && m[1] === r.title && m[2] === r.raw; });
			if (i >= 0) lines[i] = lines[i].replace("[ ]", "[x]");
			return lines.join("\n");
		});
	}
};

// After "(@" suggest dates, inserted in the existing format
class DateSuggest extends EditorSuggest {
	constructor(plugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger(cursor, editor) {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const m = /\(@([^()]*)$/.exec(before);
		if (!m) return null;
		return { start: { line: cursor.line, ch: cursor.ch - m[0].length }, end: cursor, query: m[1] };
	}

	getSuggestions(ctx) {
		const now = moment();
		const at = (d) => d.clone().set(DEFAULT_TIME);
		const list = [
			{ label: "In 1 Stunde", date: now.clone().add(1, "hour").startOf("minute"), time: true },
			{ label: "Heute", date: at(now) },
			{ label: "Morgen", date: at(now.clone().add(1, "day")) },
			{ label: "Übermorgen", date: at(now.clone().add(2, "day")) },
			{ label: "Nächste Woche", date: at(now.clone().add(1, "week").isoWeekday(1)) },
		];
		const q = ctx.query.trim();
		// Typed date: 31.12. or 31.12.2026, optionally with a time
		const typed = moment(q, ["D.M.YYYY H:mm", "D.M. H:mm", "D.M.YYYY", "D.M."], true);
		if (q && typed.isValid()) {
			if (!/\d{4}/.test(q) && typed.isBefore(now, "day")) typed.add(1, "year");
			const hasTime = /:/.test(q);
			return [{ label: q, date: hasTime ? typed : at(typed), time: hasTime }];
		}
		return list.filter((s) => s.date.isAfter(now) && s.label.toLowerCase().startsWith(q.toLowerCase()));
	}

	renderSuggestion(s, el) {
		el.createDiv({ text: s.label });
		el.createDiv({ cls: "wfe-suggest-date", text: format(s) });
	}

	selectSuggestion(s) {
		const { editor, start, end } = this.context;
		// Auto-pairing often already put the closing parenthesis after the cursor
		const after = editor.getLine(end.line).charAt(end.ch) === ")" ? { line: end.line, ch: end.ch + 1 } : end;
		editor.replaceRange(`(@${format(s)})`, start, after);
		editor.setCursor({ line: start.line, ch: start.ch + format(s).length + 3 });
	}
}

function under(path, base) {
	return path === base || path.startsWith(base + "/");
}

function parse(raw) {
	const m = moment(raw.trim(), FORMATS, "en", true);
	if (!m.isValid()) return null;
	if (!/\d:\d/.test(raw)) m.set(DEFAULT_TIME);
	return m.valueOf();
}

function format(s) {
	return s.date.clone().locale("en").format(s.time ? FORMATS[0] : FORMATS[1]);
}

function show(ms) {
	return new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
