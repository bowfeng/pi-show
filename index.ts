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

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 160;
const WIDTH_PADDING = 4;
const MIN_DESC_WIDTH = 20;
const CONTINUATION_INDENT = "  ";
const SEPARATOR = " — ";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ThemeInfo {
	name: string;
	path: string | undefined;
}

interface ToolInfo {
	name: string;
	description: string;
	parameters: unknown;
	sourceInfo: SourceInfo;
}

type FoundItem =
	| { kind: "builtin"; item: SlashCommandInfo }
	| { kind: "command"; item: SlashCommandInfo }
	| { kind: "tool"; item: ToolInfo };

type CommandSource = "extension" | "skill" | "prompt";

interface GroupedCommands {
	builtin: SlashCommandInfo[];
	skills: SlashCommandInfo[];
	prompts: SlashCommandInfo[];
}

type LabelMap = Record<CommandSource, string>;

const SOURCE_LABELS: LabelMap = {
	extension: "Command",
	skill: "Skill",
	prompt: "Prompt Template",
} as const;

const SECTION_LABELS: LabelMap = {
	extension: "Commands",
	skill: "Skills",
	prompt: "Prompt Templates",
} as const;

// ─── Terminal helpers ──────────────────────────────────────────────────────────

/** Get terminal columns, or DEFAULT_WIDTH if unavailable. */
function getTerminalWidth(): number {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const nodeProcess = (globalThis as Record<string, unknown>).process as any | undefined;
	return (nodeProcess?.stdout?.columns as number | undefined) ?? DEFAULT_WIDTH;
}

// ─── Theme helpers ─────────────────────────────────────────────────────────────

/** Safely extract theme color functions from context. */
function extractThemeHelpers(ctx: unknown): { fgFn: (c: string, t: string) => string; boldFn: (t: string) => string } {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const raw = (ctx as any)?.ui?.theme as Record<string, unknown> | undefined;
		const fgFn = typeof raw?.fg === "function" ? (raw.fg as Function).bind(raw) : undefined;
		const boldFn = typeof raw?.bold === "function" ? (raw.bold as Function).bind(raw) : undefined;
		return {
			fgFn: typeof fgFn === "function" ? fgFn : (_c: string, t: string) => t,
			boldFn: typeof boldFn === "function" ? boldFn : (t: string) => t,
		};
	} catch {
		return { fgFn: (_c: string, t: string) => t, boldFn: (t: string) => t };
	}
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

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

/** Apply theme colors to plain-text line. **bold** → accent, `code` → mdCode, [text] → muted. */
function styleLine(plain: string, fgFn: (c: string, t: string) => string): string {
	let out = plain;
	out = out.replace(/`(.+?)`/g, (_, t) => fgFn("mdCode", t));
	out = out.replace(/\[(.+?)\]/g, (_, t) => fgFn("muted", `[${t}]`));
	return out;
}

/** Style a header/bullet line. **bold** → bold+accent, `code` → mdCode, [text] → muted. */
function styleItem(plain: string, fgFn: (c: string, t: string) => string, boldFn: (t: string) => string): string {
	let out = plain;
	// Process **bold** first: apply bold + accent color directly
	// We need to insert bold code BEFORE the color code, not before the text
	// fgFn("accent", t) returns something like "\x1b[38;5;XXtext\x1b[0m"
	// We need "\x1b[1m\x1b[38;5;XXtext\x1b[0m" (bold + color before text, reset after)
	out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => {
		// Apply accent color — returns "\x1b[...text\x1b[0m"
		const colored = fgFn("accent", t);
		// Insert bold code (\x1b[1m) right after the opening \x1b[ and before the color code
		// The colored string starts with \x1b[, so we insert \x1b[1m after \x1b[
		return colored.replace(/^\x1b\[/, '\x1b[1m\x1b[');
	});
	out = out.replace(/`(.+?)`/g, (_, t) => fgFn("mdCode", t));
	out = out.replace(/\[(.+?)\]/g, (_, t) => fgFn("muted", `[${t}]`));
	out = out.replace(/^(-) /, (_, d) => `${fgFn("muted", d)} `);
	return out;
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
	const descPrefix = descPlain ? SEPARATOR : "";
	const fullLen = headerWithBullet.length + descPrefix.length + descPlain.length;
	if (descPlain === "" || fullLen <= width) {
		return styleItem(headerWithBullet + descPrefix + descPlain, fgFn, boldFn);
	}
	// Need wrap: color the header line with bold support, plain wrap the rest
	const headerLen = headerWithBullet.length + SEPARATOR.length;
	const descWidth = Math.max(width - headerLen, MIN_DESC_WIDTH);
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
	// Use styleItem instead of styleLine to support **bold** for command names
	let out = styleItem(headerWithBullet + SEPARATOR + firstPart, fgFn, boldFn);
	if (rest) out += "\n" + CONTINUATION_INDENT + wrapPlain(rest, width - CONTINUATION_INDENT.length, CONTINUATION_INDENT);
	return out;
}

// ─── Rendering helpers ─────────────────────────────────────────────────────────

/** Group commands by their source type. */
function groupCommands(commands: SlashCommandInfo[]): GroupedCommands {
	return commands.reduce<GroupedCommands>(
		(acc, cmd) => {
			const source = cmd.source as CommandSource;
			if (source === "extension") acc.builtin.push(cmd);
			else if (source === "skill") acc.skills.push(cmd);
			else if (source === "prompt") acc.prompts.push(cmd);
			return acc;
		},
		{ builtin: [], skills: [], prompts: [] },
	);
}

/** Render a single list item for commands/skills/prompts. */
function renderCommandItem(
	cmd: SlashCommandInfo,
	width: number,
	fgFn: (c: string, t: string) => string,
	boldFn: (t: string) => string,
): string {
	return wrapItem(`**/${cmd.name}**`, cmd.description ?? "", "-", width, fgFn, boldFn);
}

/** Render a section with a header and list of items. */
function renderSection<T extends { name: string; description?: string }>(
	items: readonly T[],
	sectionName: string,
	count: number | undefined,
	width: number,
	fgFn: (c: string, t: string) => string,
	boldFn: (t: string) => string,
	renderItem: (item: T) => string,
): string[] {
	if (items.length === 0) return [];
	const lines: string[] = ["", styleItem(`**${sectionName}**${count !== undefined ? ` (${fgFn("mdCode", String(count))})` : ""}`, fgFn, boldFn)];
	for (const item of items) {
		lines.push(renderItem(item));
	}
	return lines;
}

/** Render theme list items. */
function renderThemeItem(
	theme: ThemeInfo,
	width: number,
	fgFn: (c: string, t: string) => string,
): string {
	if (theme.path) {
		return styleLine(wrapPlain(`- ${theme.name}${SEPARATOR}${theme.path}`, width - CONTINUATION_INDENT.length, CONTINUATION_INDENT), fgFn);
	}
	return styleItem(`- \`${theme.name}\` [built-in]`, fgFn, () => fgFn("muted", "[built-in]"));
}

/** Render a tool list item. */
function renderToolItem(
	tool: ToolInfo,
	width: number,
	fgFn: (c: string, t: string) => string,
	boldFn: (t: string) => string,
): string {
	return wrapItem(`**${tool.name}**`, tool.description ?? "", "-", width, fgFn, boldFn);
}

/** Render a list of tools. */
function renderToolList(tools: ToolInfo[], width: number, fgFn: (c: string, t: string) => string, boldFn: (t: string) => string): string[] {
	if (tools.length === 0) return [];
	const lines: string[] = ["", styleItem(`**Tools** (${fgFn("mdCode", String(tools.length))})`, fgFn, boldFn)];
	for (const tool of tools) {
		lines.push(renderToolItem(tool, width, fgFn, boldFn));
	}
	return lines;
}

/** Render a list of themes. */
function renderThemeList(themes: ThemeInfo[], width: number, fgFn: (c: string, t: string) => string): string[] {
	if (themes.length === 0) return [];
	const lines: string[] = ["", styleItem(`**Themes** (${fgFn("mdCode", String(themes.length))})`, fgFn, () => fgFn("mdCode", ""))];
	for (const theme of themes) {
		lines.push(renderThemeItem(theme, width, fgFn));
	}
	return lines;
}

/** Render common source info lines for commands and tools. */
function renderSourceInfo(sourceInfo: SourceInfo, fgFn: (c: string, t: string) => string): string[] {
	const lines: string[] = [];
	lines.push(styleItem(`**Source path:** \`${sourceInfo.path}\``, fgFn, () => fgFn("mdCode", "")));
	if (sourceInfo.scope) lines.push(styleItem(`**Scope:** ${fgFn("mdCode", sourceInfo.scope)}`, fgFn, () => fgFn("mdCode", "")));
	if (sourceInfo.origin) lines.push(styleItem(`**Origin:** ${fgFn("mdCode", sourceInfo.origin)}`, fgFn, () => fgFn("mdCode", "")));
	if (sourceInfo.baseDir) lines.push(styleItem(`**Base dir:** \`${sourceInfo.baseDir}\``, fgFn, () => fgFn("mdCode", "")));
	return lines;
}

// ─── Model helpers ─────────────────────────────────────────────────────────────

/** Safely extract model info from the model object. */
function extractModelInfo(model: unknown): { id: string; name: string; provider: string } | undefined {
	if (!model) return undefined;
	const m = model as Record<string, unknown>;
	return {
		id: (m.id as string) || (m.modelId as string) || "unknown",
		name: (m.name as string) || (m.label as string) || "unknown",
		provider: (m.provider as string) || (m.apiType as string) || "unknown",
	};
}

// ─── Overview ──────────────────────────────────────────────────────────────────

function showOverview(
	commands: SlashCommandInfo[],
	tools: ToolInfo[],
	themes: ThemeInfo[],
	model: { id: string; name: string; provider: string } | undefined,
	fgFn: (c: string, t: string) => string,
	boldFn: (t: string) => string,
	width: number,
): string {
	const lines: string[] = [
		styleItem("### **pi-coding-agent Information**", fgFn, boldFn),
		"",
		model
			? styleItem(`**Model:** \`${model.id}\` (${fgFn("success", model.provider)})`, fgFn, boldFn)
			: styleItem("**Model:** none selected", fgFn, boldFn),
	];

	const grouped = groupCommands(commands);

	lines.push(
		...renderSection(grouped.builtin, "Commands", undefined, width, fgFn, boldFn, (cmd) => renderCommandItem(cmd, width, fgFn, boldFn)),
	);
	lines.push(...renderSection(grouped.skills, "Skills", grouped.skills.length, width, fgFn, boldFn, (cmd) => renderCommandItem(cmd, width, fgFn, boldFn)));
	lines.push(
		...renderSection(grouped.prompts, "Prompt Templates", grouped.prompts.length, width, fgFn, boldFn, (cmd) => renderCommandItem(cmd, width, fgFn, boldFn)),
	);
	lines.push(...renderToolList(tools, width, fgFn, boldFn));
	lines.push(...renderThemeList(themes, width, fgFn));

	return lines.join("\n");
}

// ─── Lookup ────────────────────────────────────────────────────────────────────

/** Wrap a command as FoundItem based on its source type. */
function wrapCommand(cmd: SlashCommandInfo): FoundItem {
	return { kind: cmd.source === "extension" ? "builtin" : "command", item: cmd };
}

function findByName(
	commands: SlashCommandInfo[],
	tools: ToolInfo[],
	query: string,
): FoundItem | undefined {
	for (const cmd of commands) {
		if (cmd.name.toLowerCase() === query) return wrapCommand(cmd);
	}
	for (const tool of tools) {
		if (tool.name.toLowerCase() === query) return { kind: "tool", item: tool };
	}
	return undefined;
}

function findPartialMatches(
	commands: SlashCommandInfo[],
	tools: ToolInfo[],
	query: string,
): FoundItem[] {
	const results: FoundItem[] = [];
	for (const cmd of commands) {
		if (cmd.name.toLowerCase().includes(query)) results.push(wrapCommand(cmd));
	}
	for (const tool of tools) {
		if (tool.name.toLowerCase().includes(query)) results.push({ kind: "tool", item: tool });
	}
	return results;
}

// ─── Detail View ───────────────────────────────────────────────────────────────

function showThemeDetail(themeInfo: ThemeInfo, fgFn: (c: string, t: string) => string, boldFn: (t: string) => string): string {
	const lines: string[] = [];
	lines.push(styleItem(`### **Theme:** \`${themeInfo.name}\``, fgFn, boldFn));
	lines.push("");
	if (themeInfo.path) {
		lines.push(styleItem(`**Path:** \`${themeInfo.path}\``, fgFn, boldFn));
	} else {
		lines.push(styleItem(`**Path:** ${fgFn("muted", "built-in")}`, fgFn, boldFn));
	}
	return lines.join("\n");
}

function showThemeCandidates(themes: ThemeInfo[], fgFn: (c: string, t: string) => string, boldFn: (t: string) => string): string {
	const lines: string[] = [styleItem("**Multiple theme matches found:**", fgFn, boldFn)];
	for (const theme of themes) {
		const pathPart = theme.path ? fgFn("mdCode", theme.path) : fgFn("muted", "[built-in]");
		lines.push(styleItem(`- \`${theme.name}\`${SEPARATOR}${pathPart}`, fgFn, boldFn));
	}
	lines.push(`\nTry \`/show <exact_theme_name>\` for details.`);
	return lines.join("\n");
}

function showDetail(item: FoundItem, fgFn: (c: string, t: string) => string, boldFn: (t: string) => string, width: number): string {
	let lines: string[];

	if (item.kind !== "tool") {
		const cmd = item.item;
		const label = SOURCE_LABELS[cmd.source as CommandSource] ?? "Unknown";
		lines = [
			styleItem(`### **${label}:** \`${cmd.name}\``, fgFn, boldFn),
			"",
			...(cmd.description ? [
				styleItem("**Description:**", fgFn, boldFn),
				wrapPlain(cmd.description, width, CONTINUATION_INDENT),
			] : []),
			styleItem(`**Source type:** ${fgFn("muted", cmd.source)}`, fgFn, boldFn),
			...renderSourceInfo(cmd.sourceInfo, fgFn),
		];
	} else {
		const tool = item.item;
		lines = [
			styleItem(`### **Tool:** \`${tool.name}\``, fgFn, boldFn),
			"",
			...(tool.description ? [
				styleItem("**Description:**", fgFn, boldFn),
				wrapPlain(tool.description, width, CONTINUATION_INDENT),
			] : []),
			...renderSourceInfo(tool.sourceInfo, fgFn),
		];
	}

	return lines.join("\n");
}

// ─── Candidates ────────────────────────────────────────────────────────────────

function showCandidates(matches: FoundItem[], fgFn: (c: string, t: string) => string, boldFn: (t: string) => string, width: number): string {
	const lines: string[] = [styleItem("**Multiple matches found:**", fgFn, boldFn)];
	for (const match of matches) {
		const name = match.item.name;
		const desc = match.item.description;
		const kindLabel = match.kind === "tool" ? fgFn("mdCode", "tool") : fgFn("muted", match.item.source);
		if (desc) {
			lines.push(wrapItem(`**${name}** [${kindLabel}]`, desc, "-", width, fgFn, boldFn));
		} else {
			lines.push(styleItem(`- \`${name}\` [${kindLabel}]`, fgFn, boldFn));
		}
	}
	lines.push(`\nTry \`/show <exact_name>\` for details.`);
	return lines.join("\n");
}

// ─── Not Found ─────────────────────────────────────────────────────────────────

function showNotFound(
	query: string,
	commands: SlashCommandInfo[],
	tools: ToolInfo[],
	themes: ThemeInfo[],
	fgFn: (c: string, t: string) => string,
	boldFn: (t: string) => string,
	width: number,
): string {
	const grouped = groupCommands(commands);
	const lines: string[] = [
		styleItem(`**No command, skill, prompt, tool, or theme named "${fgFn("error", query)}" found.**`, fgFn, boldFn),
		"",
		styleItem("Available:", fgFn, boldFn),
		...renderSection(grouped.builtin, SECTION_LABELS.extension, grouped.builtin.length, width, fgFn, boldFn, (cmd) => renderCommandItem(cmd, width, fgFn, boldFn)),
		...renderSection(grouped.skills, SECTION_LABELS.skill, grouped.skills.length, width, fgFn, boldFn, (cmd) => renderCommandItem(cmd, width, fgFn, boldFn)),
		...renderSection(grouped.prompts, SECTION_LABELS.prompt, grouped.prompts.length, width, fgFn, boldFn, (cmd) => renderCommandItem(cmd, width, fgFn, boldFn)),
		...renderToolList(tools, width, fgFn, boldFn),
		...renderThemeList(themes, width, fgFn),
	];

	return lines.join("\n");
}

// ─── Extension Entry Point ─────────────────────────────────────────────────────

export default function piShowExtension(pi: ExtensionAPI): void {
	pi.registerCommand("show", {
		description: "Show pi-coding-agent info (commands, skills, prompts, tools, themes, model)",
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		handler: async (_args: string, ctx: any) => {
			const commands = pi.getCommands();
			const tools = pi.getAllTools() as ToolInfo[];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const themes = ((ctx.ui as any)?.getAllThemes as (() => ThemeInfo[]) | undefined)?.() ?? [];
			const width = getTerminalWidth() - WIDTH_PADDING;
			const { fgFn, boldFn } = extractThemeHelpers(ctx);
			const model = extractModelInfo(ctx.model);

			const query = _args.trim().toLowerCase();

			let result: string;

			if (!query) {
				result = showOverview(commands, tools, themes, model, fgFn, boldFn, width);
			} else {
				const found = findByName(commands, tools, query);
				if (found) {
					result = showDetail(found, fgFn, boldFn, width);
				} else {
					const matches = findPartialMatches(commands, tools, query);
					if (matches.length === 1) {
						result = showDetail(matches[0], fgFn, boldFn, width);
					} else {
						const themeMatches = themes.filter((theme) => theme.name.toLowerCase().includes(query));
						if (themeMatches.length === 1) {
							result = showThemeDetail(themeMatches[0], fgFn, boldFn);
						} else if (themeMatches.length > 0) {
							result = showThemeCandidates(themeMatches, fgFn, boldFn);
						} else if (matches.length > 0) {
							result = showCandidates(matches, fgFn, boldFn, width);
						} else {
							result = showNotFound(query, commands, tools, themes, fgFn, boldFn, width);
						}
					}
				}
			}

			pi.sendMessage(
				{
					customType: "pi-show",
					content: [{ type: "text", text: result }],
					display: true,
				},
				{ triggerTurn: false },
			);
		},
		getArgumentCompletions: () => null,
	});
}