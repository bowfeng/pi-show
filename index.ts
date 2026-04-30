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

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	SlashCommandInfo,
	SourceInfo,
	ToolInfo as ImportedToolInfo,
} from "@mariozechner/pi-coding-agent";
import type { CoreThemeInfo, Model } from "./types.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 160;
const WIDTH_PADDING = 4;
const MIN_DESC_WIDTH = 20;
const CONTINUATION_INDENT = "  ";
const SEPARATOR = " — ";

// ─── Types ─────────────────────────────────────────────────────────────────────

type FoundItem =
	| { kind: "builtin"; item: SlashCommandInfo }
	| { kind: "command"; item: SlashCommandInfo }
	| { kind: "tool"; item: ImportedToolInfo };

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

function getTerminalWidth(): number {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const nodeProcess = (globalThis as Record<string, unknown>).process as any | undefined;
	return (nodeProcess?.stdout?.columns as number | undefined) ?? DEFAULT_WIDTH;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

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

// ─── Rendering helpers ─────────────────────────────────────────────────────────

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

// ─── Model helpers ─────────────────────────────────────────────────────────────

function extractModelInfo(model: Model | undefined): { id: string; name: string; provider: string } | undefined {
	if (!model) return undefined;
	return {
		id: model.id || "unknown",
		name: model.name || "unknown",
		provider: model.provider || "unknown",
	};
}

// ─── Overview ──────────────────────────────────────────────────────────────────

function showOverview(
	commands: SlashCommandInfo[],
	tools: ImportedToolInfo[],
	themes: CoreThemeInfo[],
	model: { id: string; name: string; provider: string } | undefined,
	width: number,
): string {
	const lines: string[] = [
		"## **pi-coding-agent Information**",
		"",
		model
			? `**Model:** \`${model.id}\` (${model.provider})`
			: "**Model:** none selected",
	];

	const grouped = groupCommands(commands);

	const sectionLines = (sectionName: string, items: SlashCommandInfo[], count?: number) => {
		if (items.length === 0) return [];
		const result: string[] = ["", `## **${sectionName}**${count !== undefined ? ` (${count})` : ""}`];
		for (const cmd of items) {
			const desc = cmd.description ?? "";
			const line = `- \`${cmd.name}\`${desc ? SEPARATOR + desc : ""}`;
			const wrapped = desc ? wrapPlain(line, width, CONTINUATION_INDENT) : line;
			result.push(wrapped);
		}
		return result;
	};

	lines.push(...sectionLines("Commands", grouped.builtin));
	lines.push(...sectionLines("Skills", grouped.skills, grouped.skills.length));
	lines.push(...sectionLines("Prompt Templates", grouped.prompts, grouped.prompts.length));

	if (tools.length > 0) {
		lines.push("", `## **Tools** (${tools.length})`);
		for (const tool of tools) {
			const desc = tool.description ?? "";
			const line = `\`${tool.name}\`${desc ? SEPARATOR + desc : ""}`;
			const wrapped = desc ? wrapPlain(line, width, CONTINUATION_INDENT) : line;
			lines.push(wrapped);
		}
	}

	if (themes.length > 0) {
		lines.push("", `## **Themes** (${themes.length})`);
		for (const theme of themes) {
			const pathPart = theme.path ? `${theme.name}${SEPARATOR}${theme.path}` : `${theme.name} [built-in]`;
			lines.push(`- ${pathPart}`);
		}
	}

	return lines.join("\n");
}

// ─── Lookup ────────────────────────────────────────────────────────────────────

function wrapCommand(cmd: SlashCommandInfo): FoundItem {
	return { kind: cmd.source === "extension" ? "builtin" : "command", item: cmd };
}

function findByName(commands: SlashCommandInfo[], tools: ImportedToolInfo[], query: string): FoundItem | undefined {
	for (const cmd of commands) {
		if (cmd.name.toLowerCase() === query) return wrapCommand(cmd);
	}
	for (const tool of tools) {
		if (tool.name.toLowerCase() === query) return { kind: "tool", item: tool };
	}
	return undefined;
}

function findPartialMatches(commands: SlashCommandInfo[], tools: ImportedToolInfo[], query: string): FoundItem[] {
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

function showThemeDetail(themeInfo: CoreThemeInfo): string {
	const lines: string[] = [];
	lines.push(`## **Theme:** \`${themeInfo.name}\``);
	lines.push("");
	if (themeInfo.path) {
		lines.push(`**Path:** \`${themeInfo.path}\``);
	} else {
		lines.push("**Path:** built-in");
	}
	return lines.join("\n");
}

function showThemeCandidates(themes: CoreThemeInfo[]): string {
	const lines: string[] = ["**Multiple theme matches found:**"];
	for (const theme of themes) {
		const pathPart = theme.path ? theme.path : "[built-in]";
		lines.push(`- \`${theme.name}\`${SEPARATOR}${pathPart}`);
	}
	lines.push("");
	lines.push("Try \`/show <exact_theme_name>\` for details.");
	return lines.join("\n");
}

function showDetail(item: FoundItem, width: number): string {
	if (item.kind !== "tool") {
		const cmd = item.item;
		const label = SOURCE_LABELS[cmd.source as CommandSource] ?? "Unknown";
		const lines: string[] = [
			`## **${label}:** \`${cmd.name}\``,
			"",
		];
		if (cmd.description) {
			lines.push("**Description:**");
			lines.push(wrapPlain(cmd.description, width, CONTINUATION_INDENT));
		}
		lines.push(`**Source type:** \`${cmd.source}\``);
		lines.push(`**Source path:** \`${cmd.sourceInfo.path}\``);
		if (cmd.sourceInfo.scope) lines.push(`**Scope:** \`${cmd.sourceInfo.scope}\``);
		if (cmd.sourceInfo.origin) lines.push(`**Origin:** \`${cmd.sourceInfo.origin}\``);
		if (cmd.sourceInfo.baseDir) lines.push(`**Base dir:** \`${cmd.sourceInfo.baseDir}\``);
		return lines.join("\n");
	}

	const tool = item.item;
	const lines: string[] = [
		`## **Tool:** \`${tool.name}\``,
		"",
	];
	if (tool.description) {
		lines.push("**Description:**");
		lines.push(wrapPlain(tool.description, width, CONTINUATION_INDENT));
	}
	lines.push(`**Source path:** \`${tool.sourceInfo.path}\``);
	if (tool.sourceInfo.scope) lines.push(`**Scope:** \`${tool.sourceInfo.scope}\``);
	if (tool.sourceInfo.origin) lines.push(`**Origin:** \`${tool.sourceInfo.origin}\``);
	if (tool.sourceInfo.baseDir) lines.push(`**Base dir:** \`${tool.sourceInfo.baseDir}\``);
	return lines.join("\n");
}

// ─── Candidates ────────────────────────────────────────────────────────────────

function showCandidates(matches: FoundItem[], width: number): string {
	const lines: string[] = ["**Multiple matches found:**"];
	for (const match of matches) {
		const name = match.item.name;
		const desc = match.item.description;
		const kindLabel = match.kind === "tool" ? "tool" : match.item.source;
		if (desc) {
			const line = `\`${name}\` [${kindLabel}]${SEPARATOR}${desc}`;
			const wrapped = wrapPlain(line, width, CONTINUATION_INDENT);
			lines.push(`- ${wrapped}`);
		} else {
			lines.push(`- \`${name}\` [${kindLabel}]`);
		}
	}
	lines.push("");
	lines.push("Try \`/show <exact_name>\` for details.");
	return lines.join("\n");
}

// ─── Not Found ─────────────────────────────────────────────────────────────────

function showNotFound(
	query: string,
	commands: SlashCommandInfo[],
	tools: ImportedToolInfo[],
	themes: CoreThemeInfo[],
	width: number,
): string {
	const grouped = groupCommands(commands);
	const lines: string[] = [
		`**No command, skill, prompt, tool, or theme named "${query}" found.**`,
		"",
		"**Available:**",
	];

	const sectionLines = (sectionName: string, items: SlashCommandInfo[], count?: number) => {
		if (items.length === 0) return [];
		const result: string[] = [`**${sectionName}**${count !== undefined ? ` (${count})` : ""}`];
		for (const cmd of items) {
			const desc = cmd.description ?? "";
			const line = `\`${cmd.name}\`${desc ? SEPARATOR + desc : ""}`;
			const wrapped = desc ? wrapPlain(line, width, CONTINUATION_INDENT) : line;
			result.push(`- ${wrapped}`);
		}
		return result;
	};

	lines.push(...sectionLines(SECTION_LABELS.extension, grouped.builtin, grouped.builtin.length));
	lines.push(...sectionLines(SECTION_LABELS.skill, grouped.skills, grouped.skills.length));
	lines.push(...sectionLines(SECTION_LABELS.prompt, grouped.prompts, grouped.prompts.length));

	if (tools.length > 0) {
		lines.push(`**Tools** (${tools.length})`);
		for (const tool of tools) {
			const desc = tool.description ?? "";
			const line = `\`${tool.name}\`${desc ? SEPARATOR + desc : ""}`;
			const wrapped = desc ? wrapPlain(line, width, CONTINUATION_INDENT) : line;
			lines.push(`- ${wrapped}`);
		}
	}

	if (themes.length > 0) {
		lines.push(`**Themes** (${themes.length})`);
		for (const theme of themes) {
			const pathPart = theme.path ? `${theme.name}${SEPARATOR}${theme.path}` : `${theme.name} [built-in]`;
			lines.push(`- ${pathPart}`);
		}
	}

	return lines.join("\n");
}

// ─── Extension Entry Point ─────────────────────────────────────────────────────

export default function piShowExtension(pi: ExtensionAPI): void {
	pi.registerCommand("show", {
		description: "Show pi-coding-agent info (commands, skills, prompts, tools, themes, model)",
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		handler: async (_args: string, ctx: any) => {
			const typedCtx = ctx as ExtensionCommandContext;
			const commands = pi.getCommands();
			const tools = pi.getAllTools() as ImportedToolInfo[];
			const themes: CoreThemeInfo[] = typedCtx.ui.getAllThemes?.() ?? [];
			const width = getTerminalWidth() - WIDTH_PADDING;
			const model = extractModelInfo(typedCtx.model as Model | undefined);

			const query = _args.trim().toLowerCase();

			let result: string;

			if (!query) {
				result = showOverview(commands, tools, themes, model, width);
			} else {
				const found = findByName(commands, tools, query);
				if (found) {
					result = showDetail(found, width);
				} else {
					const matches = findPartialMatches(commands, tools, query);
					if (matches.length === 1) {
						result = showDetail(matches[0], width);
					} else {
						const themeMatches = themes.filter((theme) => theme.name.toLowerCase().includes(query));
						if (themeMatches.length === 1) {
							result = showThemeDetail(themeMatches[0]);
						} else if (themeMatches.length > 0) {
							result = showThemeCandidates(themeMatches);
						} else if (matches.length > 0) {
							result = showCandidates(matches, width);
						} else {
							result = showNotFound(query, commands, tools, themes, width);
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
