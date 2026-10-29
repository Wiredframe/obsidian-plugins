import { Editor, EditorPosition } from "obsidian";

/** A pair of markers wrapped around a run of text. All of ours are symmetric. */
export interface Wrap {
	start: string;
	end: string;
}

export const WRAPS: Record<string, Wrap> = {
	bold: { start: "**", end: "**" },
	italic: { start: "*", end: "*" },
	strike: { start: "~~", end: "~~" },
	highlight: { start: "==", end: "==" },
	code: { start: "`", end: "`" },
};

const WORD = /[\p{L}\p{N}_]/u;

const RE = {
	quote: /^(\s*)((?:>[ \t]?)+)/,
	task: /^(\s*)([-*+])[ \t]+\[([^\]])\][ \t]?/,
	bullet: /^(\s*)([-*+])[ \t]+/,
	ordered: /^(\s*)(\d+)[.)][ \t]+/,
	heading: /^(\s*)(#{1,6})[ \t]+/,
};

export type LineKind = "bullet" | "ordered" | "task" | "heading" | "plain";

/* ------------------------------------------------------------------ *
 * Positions
 * ------------------------------------------------------------------ */

function docEnd(ed: Editor): number {
	const last = ed.lastLine();
	return ed.posToOffset({ line: last, ch: ed.getLine(last).length });
}

function shift(ed: Editor, pos: EditorPosition, by: number): EditorPosition {
	const at = Math.max(0, Math.min(docEnd(ed), ed.posToOffset(pos) + by));
	return ed.offsetToPos(at);
}

/** The word the caret sits in or beside, as a range, or null on whitespace. */
function wordAt(line: string, ch: number): [number, number] | null {
	let a = ch;
	let b = ch;
	while (a > 0 && WORD.test(line[a - 1])) a--;
	while (b < line.length && WORD.test(line[b])) b++;
	return b > a ? [a, b] : null;
}

/* ------------------------------------------------------------------ *
 * Inline markers
 * ------------------------------------------------------------------ */

/** Add or remove a marker pair around the selection. With no selection the
 *  word under the caret is used, and on empty space a bare pair is dropped in
 *  with the caret parked between the halves. */
export function toggleInline(ed: Editor, w: Wrap): void {
	let from = ed.getCursor("from");
	let to = ed.getCursor("to");
	const empty = from.line === to.line && from.ch === to.ch;

	if (empty) {
		const span = wordAt(ed.getLine(from.line), from.ch);
		if (span) {
			from = { line: from.line, ch: span[0] };
			to = { line: from.line, ch: span[1] };
		}
	}

	const sel = ed.getRange(from, to);
	const start = ed.posToOffset(from);
	const select = (a: number, b: number) => ed.setSelection(ed.offsetToPos(a), ed.offsetToPos(b));

	// markers inside the selection: strip them
	if (sel.length >= w.start.length + w.end.length && sel.startsWith(w.start) && sel.endsWith(w.end)) {
		const inner = sel.slice(w.start.length, sel.length - w.end.length);
		ed.replaceRange(inner, from, to);
		select(start, start + inner.length);
		return;
	}

	// markers just outside it: strip those instead, so pressing the button
	// again undoes it whether the user reselected the text or the markers
	const outerFrom = shift(ed, from, -w.start.length);
	const outerTo = shift(ed, to, w.end.length);
	if (ed.getRange(outerFrom, from) === w.start && ed.getRange(to, outerTo) === w.end) {
		const at = ed.posToOffset(outerFrom);
		ed.replaceRange(sel, outerFrom, outerTo);
		select(at, at + sel.length);
		return;
	}

	ed.replaceRange(w.start + sel + w.end, from, to);
	const inner = start + w.start.length;
	select(inner, inner + sel.length);
}

/** Whether the caret sits inside a pair of these markers, for button state. */
export function inlineActive(ed: Editor, w: Wrap): boolean {
	const pos = ed.getCursor("from");
	return markerActive(ed.getLine(pos.line), pos.ch, w.start);
}

function markerActive(line: string, ch: number, m: string): boolean {
	let i = 0;
	let open = -1;
	while (i < line.length) {
		// a single "*" never matches the "**" of bold, and vice versa
		const run = m === "*" && line.startsWith("**", i);
		if (!run && line.startsWith(m, i)) {
			if (open < 0) {
				open = i + m.length;
			} else {
				if (ch >= open && ch <= i) return true;
				open = -1;
			}
			i += m.length;
			continue;
		}
		i += run ? 2 : 1;
	}
	return false;
}

/** Strip every inline marker from the selection. */
export function clearInline(ed: Editor): void {
	const from = ed.getCursor("from");
	const to = ed.getCursor("to");
	const sel = ed.getRange(from, to);
	if (!sel) return;
	const out = sel
		.replace(/(\*\*|__)(.*?)\1/gs, "$2")
		.replace(/(\*|_)(.*?)\1/gs, "$2")
		.replace(/~~(.*?)~~/gs, "$1")
		.replace(/==(.*?)==/gs, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/<\/?(mark|u|span|font)\b[^>]*>/gi, "");
	const at = ed.posToOffset(from);
	ed.replaceRange(out, from, to);
	ed.setSelection(ed.offsetToPos(at), ed.offsetToPos(at + out.length));
}

/* ------------------------------------------------------------------ *
 * Line markers
 * ------------------------------------------------------------------ */

/** Split off a leading quote prefix so list work inside quotes and callouts
 *  operates on the line's real body. */
function peel(line: string): { pre: string; body: string } {
	const m = RE.quote.exec(line);
	return m ? { pre: m[0], body: line.slice(m[0].length) } : { pre: "", body: line };
}

export function bodyKind(body: string): LineKind {
	if (RE.task.test(body)) return "task";
	if (RE.bullet.test(body)) return "bullet";
	if (RE.ordered.test(body)) return "ordered";
	if (RE.heading.test(body)) return "heading";
	return "plain";
}

/** A line without its list, task or ordered marker. */
function stripMarker(body: string): { indent: string; text: string } {
	const m = RE.task.exec(body) ?? RE.bullet.exec(body) ?? RE.ordered.exec(body);
	if (m) return { indent: m[1], text: body.slice(m[0].length) };
	const indent = /^[ \t]*/.exec(body)![0];
	return { indent, text: body.slice(indent.length) };
}

export type LineMode = "bullet" | "ordered" | "task" | "quote";

/** The kind of the line the caret is on, for button state. */
export function lineActive(ed: Editor, mode: LineMode): boolean {
	const line = ed.getLine(ed.getCursor("from").line);
	const { pre, body } = peel(line);
	return mode === "quote" ? pre.length > 0 : bodyKind(body) === mode;
}

/** Turn the selected lines into a list, task list, numbered list or quote,
 *  or back out of it when they are all that already. */
export function toggleLineMode(ed: Editor, mode: LineMode): void {
	rewriteLines(ed, (lines) => {
		const filled = lines.filter((l) => l.trim().length > 0);
		if (mode === "quote") {
			const on = filled.length > 0 && filled.every((l) => peel(l).pre.length > 0);
			return lines.map((l) => {
				const { pre, body } = peel(l);
				if (!on) return "> " + l;
				return pre.replace(/^([ \t]*)>[ \t]?/, "$1") + body;
			});
		}

		const on = filled.length > 0 && filled.every((l) => bodyKind(peel(l).body) === mode);
		let n = 1;
		return lines.map((line) => {
			const { pre, body } = peel(line);
			const { indent, text } = stripMarker(body);
			if (!body.trim()) return line;
			if (on) {
				// a task falls back to a plain bullet, everything else to prose
				const back = mode === "task" ? indent + "- " + text : indent + text;
				return pre + back;
			}
			const marker = mode === "bullet" ? "- " : mode === "task" ? "- [ ] " : `${n++}. `;
			return pre + indent + marker + text;
		});
	});
}

/** Tick or untick the selected tasks, making them tasks first if they are not. */
export function toggleDone(ed: Editor): void {
	rewriteLines(ed, (lines) => {
		const tasks = lines.filter((l) => bodyKind(peel(l).body) === "task");
		const allDone = tasks.length > 0 && tasks.every((l) => /\[[xX]\]/.test(l));
		return lines.map((line) => {
			const { pre, body } = peel(line);
			if (!body.trim()) return line;
			const m = RE.task.exec(body);
			if (m) return pre + body.replace(/\[[^\]]\]/, allDone ? "[ ]" : "[x]");
			const { indent, text } = stripMarker(body);
			return pre + indent + "- [x] " + text;
		});
	});
}

/** The markers the button walks through. Obsidian takes any single character
 *  here and hands it to CSS as data-task, so "/" for half-done is a convention
 *  rather than a feature: Tasks, Minimal and Things all read it that way, and
 *  this plugin paints it itself so it does not need any of them. */
const TASK_CYCLE = [" ", "/", "x"];

/** The marker on the first task line the selection touches, or null when it
 *  touches none. */
export function taskState(ed: Editor): string | null {
	const from = ed.getCursor("from");
	const to = ed.getCursor("to");
	for (let i = from.line; i <= to.line; i++) {
		const m = RE.task.exec(peel(ed.getLine(i)).body);
		if (m) return m[3].toLowerCase();
	}
	return null;
}

/** Walk the selected lines on one step: nothing to do, to in progress, to
 *  done, and then out of task-hood again to a plain bullet. The whole
 *  selection moves together, from whatever its first task says. */
export function cycleTask(ed: Editor): void {
	const now = taskState(ed);
	const at = now == null ? -1 : TASK_CYCLE.indexOf(now);
	// a marker from somewhere else, say a theme's [-] for cancelled, counts as
	// the end of the walk: one press retires it rather than renaming it
	const next = now != null && (at < 0 || at + 1 >= TASK_CYCLE.length) ? null : TASK_CYCLE[at + 1];
	setTask(ed, next);
}

/** Put every selected line into one task state, or back to a bullet with null. */
export function setTask(ed: Editor, state: string | null): void {
	rewriteLines(ed, (lines) =>
		lines.map((line) => {
			const { pre, body } = peel(line);
			if (!body.trim()) return line;
			const { indent, text } = stripMarker(body);
			return pre + indent + (state == null ? "- " : `- [${state}] `) + text;
		}),
	);
}

/** Set the heading level of the selected lines. Level 0 is body text, and
 *  asking for the level a line already has takes it back to body text. */
export function setHeading(ed: Editor, level: number): void {
	rewriteLines(ed, (lines) => {
		const same = lines.every((l) => {
			const m = RE.heading.exec(peel(l).body);
			return level > 0 && !!m && m[2].length === level;
		});
		const target = same ? 0 : level;
		return lines.map((line) => {
			const { pre, body } = peel(line);
			const m = RE.heading.exec(body);
			const indent = m ? m[1] : /^[ \t]*/.exec(body)![0];
			const text = m ? body.slice(m[0].length) : body.slice(indent.length);
			if (!text.trim() && !target) return line;
			return pre + indent + (target ? "#".repeat(target) + " " : "") + text;
		});
	});
}

export function headingLevel(ed: Editor): number {
	const m = RE.heading.exec(peel(ed.getLine(ed.getCursor("from").line)).body);
	return m ? m[2].length : 0;
}

/** Run a transform over every line the selection touches and write it back,
 *  keeping the selection on the same text. */
function rewriteLines(ed: Editor, fn: (lines: string[]) => string[]): void {
	const from = ed.getCursor("from");
	const to = ed.getCursor("to");
	const empty = from.line === to.line && from.ch === to.ch;
	const lines: string[] = [];
	for (let i = from.line; i <= to.line; i++) lines.push(ed.getLine(i));

	const out = fn(lines);
	if (out.join("\n") === lines.join("\n")) return;

	const startPos = { line: from.line, ch: 0 };
	const endPos = { line: to.line, ch: lines[lines.length - 1].length };
	ed.replaceRange(out.join("\n"), startPos, endPos);

	if (empty) {
		const delta = out[0].length - lines[0].length;
		ed.setCursor({ line: from.line, ch: Math.max(0, from.ch + delta) });
	} else {
		ed.setSelection(startPos, { line: to.line, ch: out[out.length - 1].length });
	}
}

/* ------------------------------------------------------------------ *
 * Inserts
 * ------------------------------------------------------------------ */

/** Replace the selection and leave the caret behind it, or on the marker that
 *  `caret` points at, counted from the start of the inserted text. */
export function insert(ed: Editor, text: string, caret?: number): void {
	const from = ed.getCursor("from");
	const at = ed.posToOffset(from);
	ed.replaceSelection(text);
	if (caret != null) ed.setCursor(ed.offsetToPos(at + caret));
	ed.focus();
}

/** A blank line above and below, added only where there is not one already. */
export function insertBlock(ed: Editor, text: string, caret?: number): void {
	const pos = ed.getCursor("from");
	const end = ed.getCursor("to");
	const line = ed.getLine(pos.line);
	const before = line.slice(0, pos.ch).trim() ? "\n\n" : pos.line > 0 && ed.getLine(pos.line - 1).trim() && !line.trim() ? "\n" : "";
	// what follows the END of the selection: the selection itself is on its way out
	const after = ed.getLine(end.line).slice(end.ch).trim() ? "\n\n" : "\n";
	insert(ed, before + text + after, caret == null ? undefined : before.length + caret);
}

export function tableMarkdown(cols: number, rows: number): string {
	const head = "|" + " Column |".repeat(cols);
	const rule = "|" + " --- |".repeat(cols);
	const body = ("|" + "  |".repeat(cols) + "\n").repeat(rows);
	return head + "\n" + rule + "\n" + body.trimEnd();
}

/** Wrap the selected lines in a callout of the given type. */
export function makeCallout(ed: Editor, type: string): void {
	const from = ed.getCursor("from");
	const to = ed.getCursor("to");
	const lines: string[] = [];
	for (let i = from.line; i <= to.line; i++) lines.push(ed.getLine(i));
	const head = `> [!${type}]`;
	const body = lines.map((l) => "> " + l.replace(/^[ \t]*>[ \t]?/, "")).join("\n");
	ed.replaceRange(head + "\n" + body, { line: from.line, ch: 0 }, { line: to.line, ch: lines[lines.length - 1].length });
	ed.setCursor({ line: from.line, ch: head.length });
}

/** One step of list indentation on every selected line. */
export function indent(ed: Editor, out: boolean): void {
	rewriteLines(ed, (lines) =>
		lines.map((l) => {
			if (!l.trim()) return l;
			return out ? l.replace(/^(\t| {1,4})/, "") : "\t" + l;
		}),
	);
}
