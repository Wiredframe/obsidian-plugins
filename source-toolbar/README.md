# Source Toolbar

A formatting toolbar above the editor, and nothing else. Built for writing in
source mode, where Markdown markers are the interface and typing `==highlight==`
or a table skeleton by hand gets old.

## What it does

| Group | Buttons |
| --- | --- |
| Structure | Heading (body text through H6) |
| Inline | Bold, italic, strikethrough, highlight, inline code |
| Lists | Bullets, numbers, tasks (four states), indent, outdent |
| Blocks | Quote, callout (nine types) |
| Inserts | Link, image, file attachment, table |
| Rest | Code block, horizontal rule, clear formatting |

Every button toggles. Pressing bold on bold text takes the markers off again,
whether you selected the text or the markers. With nothing selected, inline
buttons act on the word under the caret.

The buttons for the thing the caret is sitting in light up, so a glance at the
bar tells you where you are.

## Tasks have a middle

The task button walks one step per press: to do, in progress, done, and then
back out to a plain bullet. In progress is written `- [/]`, which Tasks, Minimal
and Things all read as half-done, and which Obsidian hands to CSS as
`data-task="/"`.

Obsidian counts every character other than a space as checked, so without help
a half-done task is painted exactly like a finished one. This plugin paints it
itself, as an open box with a bar rather than a tick, the way Obsidian draws
indeterminate everywhere else in its own interface. No theme required. Its text
is left un-struck-through and un-greyed, because it is not done yet.

A whole selection moves together, taking its cue from its first task, so a block
of mixed items lines up on one press.

Attach opens the system's own file dialog. What you pick is copied into the
vault, wherever Obsidian is set to keep attachments, and linked from the note.
Pictures land as embeds, a PDF or a document as a link, so four attachments
under a heading read as four lines rather than four scrolling previews. Several
at once is fine.

Links open a small dialog for text and URL, with a second button for linking to
a note instead. Images list the vault's pictures, and a pasted URL inserts that
instead. Tables use a sweep-out grid, up to 8 x 8. Vault links follow whichever
link style the vault is set to, wiki or Markdown.

Every button is a command as well, so anything can have a keyboard shortcut.
Four commands have no button: tick or untick a task, mark one as in progress,
turn a task list on or off in one go, and show or hide the bar.

## Settings

Toolbar on or off, separately on mobile, source mode only (hides it in Live
Preview), compact size, and a switch per button.

## Not in scope

No WYSIWYG rendering, no drag handles, no paste cleanup, no AI, no network
access, no clipboard access, no dependencies. The plugin reads and writes the
open note through Obsidian's editor API, lists vault files for the two pickers,
and writes a new file only when you attach one yourself. That is the whole
surface.

## Building

	npm install
	npm run build      # main.js
	npm run deploy     # build, then copy into the vault
	npm run dev        # watch

`VAULT=/path/to/vault npm run deploy` installs it elsewhere.
