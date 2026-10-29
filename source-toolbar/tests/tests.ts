// A fake editor over a string, so the transforms can be checked without
// Obsidian. Positions go through offsets exactly as the real Editor does.
//
// Notation: «selected» marks a selection, | marks a bare caret.

import type { Editor, EditorPosition } from "obsidian";
import {
	WRAPS,
	clearInline,
	cycleTask,
	headingLevel,
	indent,
	inlineActive,
	insertBlock,
	makeCallout,
	setHeading,
	tableMarkdown,
	taskState,
	toggleDone,
	toggleInline,
	toggleLineMode,
} from "../src/format";

class Fake {
	text: string;
	from = 0;
	to = 0;

	constructor(marked: string) {
		const sel = marked.indexOf("«");
		if (sel >= 0) {
			const end = marked.indexOf("»");
			this.from = sel;
			this.to = end - 1;
			this.text = marked.replace("«", "").replace("»", "");
		} else {
			this.from = this.to = marked.indexOf("|");
			this.text = marked.replace("|", "");
		}
	}

	private starts(): number[] {
		const out = [0];
		for (let i = 0; i < this.text.length; i++) if (this.text[i] === "\n") out.push(i + 1);
		return out;
	}

	posToOffset(p: EditorPosition): number {
		return this.starts()[p.line] + p.ch;
	}

	offsetToPos(off: number): EditorPosition {
		const starts = this.starts();
		let line = 0;
		while (line + 1 < starts.length && starts[line + 1] <= off) line++;
		return { line, ch: off - starts[line] };
	}

	getCursor(which?: string): EditorPosition {
		return this.offsetToPos(which === "to" ? this.to : this.from);
	}

	setCursor(p: EditorPosition) {
		this.from = this.to = this.posToOffset(p);
	}

	setSelection(a: EditorPosition, b: EditorPosition) {
		this.from = this.posToOffset(a);
		this.to = this.posToOffset(b);
	}

	getSelection(): string {
		return this.text.slice(this.from, this.to);
	}

	replaceSelection(s: string) {
		this.replaceRange(s, this.offsetToPos(this.from), this.offsetToPos(this.to));
		this.from = this.to = this.from + s.length;
	}

	getLine(n: number): string {
		return this.text.split("\n")[n] ?? "";
	}

	lastLine(): number {
		return this.text.split("\n").length - 1;
	}

	getRange(a: EditorPosition, b: EditorPosition): string {
		return this.text.slice(this.posToOffset(a), this.posToOffset(b));
	}

	replaceRange(s: string, a: EditorPosition, b: EditorPosition) {
		const x = this.posToOffset(a);
		const y = this.posToOffset(b);
		this.text = this.text.slice(0, x) + s + this.text.slice(y);
	}

	focus() {}

	/** The document with the selection or caret marked, for comparing. */
	marked(): string {
		if (this.from === this.to) return this.text.slice(0, this.from) + "|" + this.text.slice(this.from);
		return this.text.slice(0, this.from) + "«" + this.text.slice(this.from, this.to) + "»" + this.text.slice(this.to);
	}
}

let failed = 0;
let ran = 0;

function check(name: string, got: string, want: string) {
	ran++;
	if (got === want) return;
	failed++;
	console.log(`FAIL  ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
}

function editor(marked: string): { ed: Editor; fake: Fake } {
	const fake = new Fake(marked);
	return { ed: fake as unknown as Editor, fake };
}

function t(name: string, input: string, fn: (ed: Editor) => void, want: string) {
	const { ed, fake } = editor(input);
	fn(ed);
	check(name, fake.marked(), want);
}

/* inline markers */

t("bold a selection", "say «hello» there", (ed) => toggleInline(ed, WRAPS.bold), "say **«hello»** there");
t("unbold from inside", "say **«hello»** there", (ed) => toggleInline(ed, WRAPS.bold), "say «hello» there");
t("unbold from outside", "say «**hello**» there", (ed) => toggleInline(ed, WRAPS.bold), "say «hello» there");
t("highlight the word at the caret", "say hel|lo there", (ed) => toggleInline(ed, WRAPS.highlight), "say ==«hello»== there");
t("strike an empty spot", "a | b", (ed) => toggleInline(ed, WRAPS.strike), "a ~~|~~ b");
t("highlight across lines", "«one\ntwo»", (ed) => toggleInline(ed, WRAPS.highlight), "==«one\ntwo»==");
t("clear formatting", "«**bold** and ==lit== and ~~out~~»", clearInline, "«bold and lit and out»");

check("active inside markers", String(inlineActive(editor("a ==li|t== b").ed, WRAPS.highlight)), "true");
check("not active outside", String(inlineActive(editor("a ==lit== b|").ed, WRAPS.highlight)), "false");
check("bold is not italic", String(inlineActive(editor("**bo|ld**").ed, WRAPS.italic)), "false");

/* lines */

t("bullets on", "«one\ntwo»", (ed) => toggleLineMode(ed, "bullet"), "«- one\n- two»");
t("bullets off", "«- one\n- two»", (ed) => toggleLineMode(ed, "bullet"), "«one\ntwo»");
t("numbers on", "«one\ntwo\nthree»", (ed) => toggleLineMode(ed, "ordered"), "«1. one\n2. two\n3. three»");
t("bullets become tasks", "«- one\n- two»", (ed) => toggleLineMode(ed, "task"), "«- [ ] one\n- [ ] two»");
t("tasks fall back to bullets", "«- [ ] one\n- [x] two»", (ed) => toggleLineMode(ed, "task"), "«- one\n- two»");
t("quote on", "«one\ntwo»", (ed) => toggleLineMode(ed, "quote"), "«> one\n> two»");
t("quote off", "«> one\n> two»", (ed) => toggleLineMode(ed, "quote"), "«one\ntwo»");
t("bullets inside a quote", "«> one\n> two»", (ed) => toggleLineMode(ed, "bullet"), "«> - one\n> - two»");
t("indentation is kept", "«  one»", (ed) => toggleLineMode(ed, "bullet"), "«  - one»");
t("blank lines are left alone", "«one\n\ntwo»", (ed) => toggleLineMode(ed, "bullet"), "«- one\n\n- two»");
t("tick a task", "- [ ] one|", toggleDone, "- [x] one|");
t("untick a task", "- [x] one|", toggleDone, "- [ ] one|");
t("plain lines become done tasks", "one|", toggleDone, "- [x] one|");
t("a line becomes a task", "one|", cycleTask, "- [ ] one|");
t("a bullet becomes a task", "- one|", cycleTask, "- [ ] one|");
t("to do becomes in progress", "- [ ] one|", cycleTask, "- [/] one|");
t("in progress becomes done", "- [/] one|", cycleTask, "- [x] one|");
t("done leaves task-hood", "- [x] one|", cycleTask, "- one|");
t("an unknown marker also leaves", "- [-] one|", cycleTask, "- one|");
t("a selection moves as one", "«- [ ] one\n- [x] two»", cycleTask, "«- [/] one\n- [/] two»");
t("in progress survives ticking", "- [/] one|", toggleDone, "- [x] one|");

check("state of the first task", String(taskState(editor("- [/] one|").ed)), "/");
check("no task, no state", String(taskState(editor("one|").ed)), "null");

t("heading on", "one|", (ed) => setHeading(ed, 2), "## one|");
t("heading swapped", "## one|", (ed) => setHeading(ed, 3), "### one|");
t("heading off again", "## one|", (ed) => setHeading(ed, 2), "one|");
t("indent", "«- one»", (ed) => indent(ed, false), "«\t- one»");
t("outdent", "«\t- one»", (ed) => indent(ed, true), "«- one»");

check("heading level", String(headingLevel(editor("### hi|").ed)), "3");

/* blocks */

t("callout", "«one\ntwo»", (ed) => makeCallout(ed, "tip"), "> [!tip]|\n> one\n> two");
t("a rule after text", "one|", (ed) => insertBlock(ed, "---"), "one\n\n---\n|");
t("a rule on a blank line", "one\n|", (ed) => insertBlock(ed, "---"), "one\n\n---\n|");
t("a code block wraps the selection", "«x = 1»", (ed) => insertBlock(ed, "```\n" + ed.getSelection() + "\n```", 3), "```|\nx = 1\n```\n");

check("table markdown", tableMarkdown(2, 1), "| Column | Column |\n| --- | --- |\n|  |  |");

console.log(failed ? `\n${failed} of ${ran} failed` : `${ran} checks passed`);
process.exit(failed ? 1 : 0);
