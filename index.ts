/**
 * pi-show Extension
 *
 * Shows current pi-coding-agent state: commands, skills, prompt templates, tools, themes, model info.
 *
 * Usage:
 *   /show                  — Overview of all resources
 *   /show <name>           — Detailed info about a specific command, skill, prompt, tool, or theme
 *
 * Install: pi install npm:pi-show
 * Then: /reload to activate
 */

import type { ExtensionAPI, SlashCommandInfo, SourceInfo } from "@mariozechner/pi-coding-agent";

interface ThemeInfo {
	name: string;
	path: string | undefined;
}

type FoundItem =
	| { kind: "builtin"; item: SlashCommandInfo }
	| { kind: "command"; item: SlashCommandInfo }
	| { kind: "tool"; item: { name: string; description: string; parameters: unknown; sourceInfo: SourceInfo } };

export default function piShowExtension(pi: ExtensionAPI): void {
	function sendInfo(text: string): void {
		pi.sendMessage(
			{
				customType: "pi-show",
				content: [{ type: "text", text }],
				display: true,
			},
			{ triggerTurn: false },
		);
	}

	// ─── Coloring helpers (operate on plain text, no ANSI in wrapping) ───────────

	/** Try to get a theme fg/bold helper from the UI context. Returns null on failure. */
	function tryGetThemeHelpers(): {
		fg: (color: string, text: string) => string;
		bold: (text: string) => string;
	} | null {
		try {
			// We'll call this from the handler where ctx is available
			return null;
		} catch {
			return null;
		}
	}

	/** Apply theme colors to plain-text line. **bold** → accent, `code` → mdCode, [text] → muted. */
	function styleLine(plain: string, fgFn: (c: string, t: string) => string): string {
		let out = plain;
		out = out.replace(/`(.+?)`/g, (_, t) => fgFn("mdCode", t));
		out = out.replace(/\[(.+?)\]/g, (_, t) => fgFn("muted", `[${t}]`));
		return out;
	}

	/** Style a header/bullet line. **bold** also → bold+accent. */
	function styleItem(plain: string, fgFn: (c: string, t: string) => string, boldFn: (t: string) => string): string {
		let out = plain;
		out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => boldFn(fgFn("accent", t)));
		out = out.replace(/`(.+?)`/g, (_, t) => fgFn("mdCode", t));
		out = out.replace(/\[(.+?)\]/g, (_, t) => fgFn("muted", `[${t}]`));
		out = out.replace(/^(-) /, (_, d) => `${fgFn("muted", d)} `);
		return out;
	}

	/** Wrap plain text at width, indent continuation lines. */
	function wrapPlain(text: string, width: number, indent: string): string {
		const words = text.split(/\s+/);
		const lines: string[] = [];
		let line = "";
		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word;
			if (candidate.length > width && line) {
				lines.push(line);
				line = indent + word;
			} else {
				line = candidate;
			}
		}
		if (line) lines.push(line);
		const result: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			result.push(i === 0 ? lines[i] : `${indent}${lines[i]}`);
		}
		return result.join("\n");
	}

	/** Wrap a list item: colored header + plain description. First line is colored, rest is plain. */
	function wrapItem(
		headerPlain: string,
		descPlain: string,
		bullet: string,
		width: number,
		fgFn: (c: string, t: string) => string,
		boldFn: (t: string) => string,
	): string {
		const headerWithBullet = `${bullet} ${headerPlain}`;
		const fullLen = headerWithBullet.length + (descPlain ? " — " : "") + descPlain.length;
		if (descPlain === "" || fullLen <= width) {
			return styleItem(headerWithBullet + (descPlain ? ` — ${descPlain}` : ""), fgFn, boldFn);
		}
		// Need wrap: color the header line, plain wrap the rest
		const headerLen = headerWithBullet.length + 4;
		const descWidth = Math.max(width - headerLen, 20);
		const words = descPlain.split(/\s+/);
		let firstPart = "";
		for (const w of words) {
			const test = firstPart ? `${firstPart} ${w}` : w;
			if (test.length <= descWidth || (firstPart.length === 0 && w.length <= descWidth)) {
				firstPart = test;
			} else {
				break;
			}
		}
		const rest = descPlain.slice(firstPart.length).trim();
		let out = styleLine(headerWithBullet + " — " + firstPart, fgFn);
		if (rest) out += "\n" + "  " + wrapPlain(rest, width - 2, "  ");
		return out;
	}

	// ─── Overview ────────────────────────────────────────────────────────────────

	function showOverview(
		commands: SlashCommandInfo[],
		tools: { name: string; description: string; parameters: unknown; sourceInfo: SourceInfo }[],
		themes: ThemeInfo[],
		model: { id: string; name: string; provider: string } | undefined,
		fgFn: (c: string, t: string) => string,
		boldFn: (t: string) => string,
		width: number,
	): void {
		const lines: string[] = [];
		lines.push(styleItem("### **pi-coding-agent Information**", fgFn, boldFn));
		lines.push("");

		if (model) {
			lines.push(styleItem(`**Model:** \`${model.id}\` (${fgFn("success", model.provider)})`, fgFn, boldFn));
		} else {
			lines.push(styleItem("**Model:** none selected", fgFn, boldFn));
		}

		const builtin = commands.filter((c) => c.source === "extension");
		const skills = commands.filter((c) => c.source === "skill");
		const prompts = commands.filter((c) => c.source === "prompt");

		if (builtin.length > 0) {
			lines.push("");
			lines.push(styleItem("**Commands**", fgFn, boldFn));
			for (const cmd of builtin) {
				const header = `**/${cmd.name}**`;
				const desc = cmd.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (skills.length > 0) {
			lines.push("");
			lines.push(styleItem(`**Skills** (${fgFn("mdCode", String(skills.length))})`, fgFn, boldFn));
			for (const s of skills) {
				const header = `**/${s.name}**`;
				const desc = s.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (prompts.length > 0) {
			lines.push("");
			lines.push(styleItem(`**Prompt Templates** (${fgFn("mdCode", String(prompts.length))})`, fgFn, boldFn));
			for (const p of prompts) {
				const header = `**/${p.name}**`;
				const desc = p.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (tools.length > 0) {
			lines.push("");
			lines.push(styleItem(`**Tools** (${fgFn("mdCode", String(tools.length))})`, fgFn, boldFn));
			for (const tool of tools) {
				const header = `**${tool.name}**`;
				const desc = tool.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (themes.length > 0) {
			lines.push("");
			lines.push(styleItem(`**Themes** (${fgFn("mdCode", String(themes.length))})`, fgFn, boldFn));
			for (const t of themes) {
				if (t.path) {
					const header = `${t.name} — ${t.path}`;
					const wrapped = wrapPlain(`- ${header}`, width - 2, "  ");
					lines.push(styleLine(wrapped, fgFn));
				} else {
					lines.push(styleItem(`- \`${t.name}\` [built-in]`, fgFn, boldFn));
				}
			}
		}

		sendInfo(lines.join("\n"));
	}

	// ─── Lookup ──────────────────────────────────────────────────────────────────

	function findByName(
		commands: SlashCommandInfo[],
		tools: { name: string; description: string; parameters: unknown; sourceInfo: SourceInfo }[],
		query: string,
	): FoundItem | undefined {
		for (const cmd of commands) {
			if (cmd.name.toLowerCase() === query) {
				return cmd.source === "extension"
					? { kind: "builtin", item: cmd }
					: { kind: "command", item: cmd };
			}
		}
		for (const tool of tools) {
			if (tool.name.toLowerCase() === query) return { kind: "tool", item: tool };
		}
		return undefined;
	}

	function findPartialMatches(
		commands: SlashCommandInfo[],
		tools: { name: string; description: string; parameters: unknown; sourceInfo: SourceInfo }[],
		query: string,
	): FoundItem[] {
		const results: FoundItem[] = [];
		for (const cmd of commands) {
			if (cmd.name.toLowerCase().includes(query)) {
				results.push(cmd.source === "extension"
					? { kind: "builtin", item: cmd }
					: { kind: "command", item: cmd });
			}
		}
		for (const tool of tools) {
			if (tool.name.toLowerCase().includes(query)) results.push({ kind: "tool", item: tool });
		}
		return results;
	}

	// ─── Detail View ─────────────────────────────────────────────────────────────

	function showThemeDetail(themeInfo: ThemeInfo, fgFn: (c: string, t: string) => string, boldFn: (t: string) => string): void {
		const lines: string[] = [];
		lines.push(styleItem(`### **Theme:** \`${themeInfo.name}\``, fgFn, boldFn));
		lines.push("");
		if (themeInfo.path) {
			lines.push(styleItem(`**Path:** \`${themeInfo.path}\``, fgFn, boldFn));
		} else {
			lines.push(styleItem(`**Path:** ${fgFn("muted", "built-in")}`, fgFn, boldFn));
		}
		sendInfo(lines.join("\n"));
	}

	function showThemeCandidates(themes: ThemeInfo[], fgFn: (c: string, t: string) => string, boldFn: (t: string) => string): void {
		const lines: string[] = [styleItem("**Multiple theme matches found:**", fgFn, boldFn)];
		for (const t of themes) {
			const pathPart = t.path ? fgFn("mdCode", t.path) : fgFn("muted", "[built-in]");
			lines.push(styleItem(`- \`${t.name}\` — ${pathPart}`, fgFn, boldFn));
		}
		lines.push("\nTry `/show <exact_theme_name>` for details.");
		sendInfo(lines.join("\n"));
	}

	function showDetail(item: FoundItem, fgFn: (c: string, t: string) => string, boldFn: (t: string) => string, width: number): void {
		const lines: string[] = [];

		if (item.kind === "builtin" || item.kind === "command") {
			const cmd = item.item;
			const label = cmd.source === "skill" ? "Skill" : item.kind === "builtin" ? "Command" : "Prompt Template";
			lines.push(styleItem(`### **${label}:** \`${cmd.name}\``, fgFn, boldFn));
			lines.push("");
			if (cmd.description) {
				lines.push(styleItem("**Description:**", fgFn, boldFn));
				lines.push(wrapPlain(cmd.description, width, "  "));
			}
			lines.push(styleItem(`**Source type:** ${fgFn("muted", cmd.source)}`, fgFn, boldFn));
			lines.push(styleItem(`**Source path:** \`${cmd.sourceInfo.path}\``, fgFn, boldFn));
			if (cmd.sourceInfo.scope) lines.push(styleItem(`**Scope:** ${fgFn("mdCode", cmd.sourceInfo.scope)}`, fgFn, boldFn));
			if (cmd.sourceInfo.origin) lines.push(styleItem(`**Origin:** ${fgFn("mdCode", cmd.sourceInfo.origin)}`, fgFn, boldFn));
			if (cmd.sourceInfo.baseDir) lines.push(styleItem(`**Base dir:** \`${cmd.sourceInfo.baseDir}\``, fgFn, boldFn));
		} else {
			const tool = item.item;
			lines.push(styleItem(`### **Tool:** \`${tool.name}\``, fgFn, boldFn));
			lines.push("");
			if (tool.description) {
				lines.push(styleItem("**Description:**", fgFn, boldFn));
				lines.push(wrapPlain(tool.description, width, "  "));
			}
			lines.push(styleItem(`**Source path:** \`${tool.sourceInfo.path}\``, fgFn, boldFn));
			if (tool.sourceInfo.scope) lines.push(styleItem(`**Scope:** ${fgFn("mdCode", tool.sourceInfo.scope)}`, fgFn, boldFn));
			if (tool.sourceInfo.origin) lines.push(styleItem(`**Origin:** ${fgFn("mdCode", tool.sourceInfo.origin)}`, fgFn, boldFn));
			if (tool.sourceInfo.baseDir) lines.push(styleItem(`**Base dir:** \`${tool.sourceInfo.baseDir}\``, fgFn, boldFn));
		}

		sendInfo(lines.join("\n"));
	}

	// ─── Candidates ──────────────────────────────────────────────────────────────

	function showCandidates(matches: FoundItem[], fgFn: (c: string, t: string) => string, boldFn: (t: string) => string, width: number): void {
		const lines: string[] = [styleItem("**Multiple matches found:**", fgFn, boldFn)];
		for (const m of matches) {
			const name = m.kind === "tool" ? m.item.name : m.item.name;
			const desc = m.kind === "tool" ? (m.item.description || "") : (m.item.description || "");
			const kindLabel = m.kind === "tool" ? fgFn("mdCode", "tool") : fgFn("muted", m.item.source);
			if (desc) {
				const header = `**${name}** [${kindLabel}]`;
				const wrapped = wrapItem(header, desc, "-", width, fgFn, boldFn);
				lines.push(wrapped);
			} else {
				lines.push(styleItem(`- \`${name}\` [${kindLabel}]`, fgFn, boldFn));
			}
		}
		lines.push("\nTry `/show <exact_name>` for details.");
		sendInfo(lines.join("\n"));
	}

	// ─── Not Found ───────────────────────────────────────────────────────────────

	function showNotFound(
		query: string,
		commands: SlashCommandInfo[],
		tools: { name: string; description: string; parameters: unknown; sourceInfo: SourceInfo }[],
		themes: ThemeInfo[],
		fgFn: (c: string, t: string) => string,
		boldFn: (t: string) => string,
		width: number,
	): void {
		const lines: string[] = [
			styleItem(`**No command, skill, prompt, tool, or theme named "${fgFn("error", query)}" found.**`, fgFn, boldFn),
			"",
			styleItem("Available:", fgFn, boldFn),
		];

		const builtin = commands.filter((c) => c.source === "extension");
		const skills = commands.filter((c) => c.source === "skill");
		const prompts = commands.filter((c) => c.source === "prompt");

		if (builtin.length > 0) {
			lines.push("");
			lines.push(styleItem("**Commands:**", fgFn, boldFn));
			for (const cmd of builtin) {
				const header = `**/${cmd.name}**`;
				const desc = cmd.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (skills.length > 0) {
			lines.push("");
			lines.push(styleItem("**Skills:**", fgFn, boldFn));
			for (const s of skills) {
				const header = `**/${s.name}**`;
				const desc = s.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (prompts.length > 0) {
			lines.push("");
			lines.push(styleItem("**Prompt Templates:**", fgFn, boldFn));
			for (const p of prompts) {
				const header = `**/${p.name}**`;
				const desc = p.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (tools.length > 0) {
			lines.push("");
			lines.push(styleItem("**Tools:**", fgFn, boldFn));
			for (const tool of tools) {
				const header = `**${tool.name}**`;
				const desc = tool.description || "";
				lines.push(wrapItem(header, desc, "-", width, fgFn, boldFn));
			}
		}

		if (themes.length > 0) {
			lines.push("");
			lines.push(styleItem("**Themes:**", fgFn, boldFn));
			for (const t of themes) {
				if (t.path) {
					const header = `${t.name} — ${t.path}`;
					const wrapped = wrapPlain(`- ${header}`, width - 2, "  ");
					lines.push(styleLine(wrapped, fgFn));
				} else {
					lines.push(styleItem(`- \`${t.name}\` [built-in]`, fgFn, boldFn));
				}
			}
		}

		sendInfo(lines.join("\n"));
	}

	// ─── Command ─────────────────────────────────────────────────────────────────

	pi.registerCommand("show", {
		description: "Show pi-coding-agent info (commands, skills, prompts, tools, themes, model)",
		handler: async (_args, ctx) => {
			const commands = pi.getCommands();
			const tools = pi.getAllTools();
			const themes = ctx.ui.getAllThemes();
			const width = (process.stdout.columns || 160) - 4;

			// Get theme helpers safely
			let fgFn: (c: string, t: string) => string;
			let boldFn: (t: string) => string;
			try {
				const raw = ctx.ui.theme;
				fgFn = typeof raw.fg === "function" ? raw.fg.bind(raw) : (_c, t) => t;
				boldFn = typeof raw.bold === "function" ? raw.bold.bind(raw) : (t) => t;
			} catch {
				fgFn = (_c, t) => t;
				boldFn = (t) => t;
			}

			// Get model info safely
			let model: { id: string; name: string; provider: string } | undefined;
			try {
				if (ctx.model) {
					const m = ctx.model as any;
					model = {
						id: m.id || m.modelId || "unknown",
						name: m.name || m.label || "unknown",
						provider: m.provider || m.apiType || "unknown",
					};
				}
			} catch {
				model = undefined;
			}

			const query = _args.trim().toLowerCase();

			if (!query) {
				showOverview(commands, tools, themes, model, fgFn, boldFn, width);
				return;
			}

			const found = findByName(commands, tools, query);
			if (found) { showDetail(found, fgFn, boldFn, width); return; }

			const matches = findPartialMatches(commands, tools, query);
			if (matches.length === 1) { showDetail(matches[0], fgFn, boldFn, width); return; }

			const themeMatches = themes.filter((t) => t.name.toLowerCase().includes(query));
			if (themeMatches.length === 1) { showThemeDetail(themeMatches[0], fgFn, boldFn); return; }
			if (themeMatches.length > 0) { showThemeCandidates(themeMatches, fgFn, boldFn); return; }

			if (matches.length > 0) { showCandidates(matches, fgFn, boldFn, width); return; }

			showNotFound(query, commands, tools, themes, fgFn, boldFn, width);
		},
		getArgumentCompletions: () => null,
	});
}
