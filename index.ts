/**
 * pi-show Extension
 *
 * Shows current pi-coding-agent state: commands, skills, prompt templates, tools, themes, model info.
 *
 * Usage:
 *   /show                  — Overview of all resources
 *   /show <name>           — Detailed info about a specific command, skill, prompt, tool, or theme
 *   /show agent_context    — List agent context files (AGENTS.md, CLAUDE.md) contributing to the system prompt
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

// ─── Agent context files cache ───────────────────────────────────────────────
// Populated by before_agent_start event (structured). If undefined, parsed
// from ctx.getSystemPrompt() in the handler (fallback, works without event).
type AgentFileInfo = { path: string; level: string; content: string };
let cachedAgentFiles: AgentFileInfo[] | undefined;

// ─── Types ─────────────────────────────────────────────────────────────────────

type FoundItem =
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
			else console.warn(`[pi-show] Unknown command source: "${source}"`);
			return acc;
		},
		{ builtin: [], skills: [], prompts: [] },
	);
}

// ─── Agent file helpers ────────────────────────────────────────────────────────

function inferAgentFileLevel(filePath: string): string {
	if (filePath.includes("/.pi/")) return "Global";
	return "Ancestor";
}

function parseAgentFiles(systemPrompt: string): AgentFileInfo[] {
	const files: AgentFileInfo[] = [];
	const section = systemPrompt.match(/# Project Context\n\n([\s\S]*?)(?=\nCurrent date:|$)/);
	if (!section) return files;

	const contentBlock = section[1];
	// Match file headers `## /path` (Unix) or `## C:\path` (Windows).
	const fileRegex = /## ((?:\/|\w:)[^\n]+)\n\n([\s\S]*?)(?=\n## (?:\/|\w:)|\nCurrent date:|\nCurrent working directory:|$)/g;
	let match;

	while ((match = fileRegex.exec(contentBlock)) !== null) {
		let content = match[2].trim();
		// Strip the injected skills section that leaks into the last file's content.
		content = content.replace(/\n\nThe following skills provide specialized instructions[\s\S]*$/, "");
		files.push({
			path: match[1].trim(),
			content,
			level: inferAgentFileLevel(match[1].trim()),
		});
	}

	return files;
}

function inferLevelWithCwd(file: AgentFileInfo, cwd: string): string {
	if (file.path === cwd) return "Workspace";
	return file.level;
}

// ─── Agent list renderer (shared by showOverview, showAgentOverview,
//     showAgentCandidates, showAgentsNotFound)

function renderAgentListItem(file: AgentFileInfo): string {
	return `- \`${file.path}\` [${file.level}]`;
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
	model: { id: string; name: string; provider: string } | undefined,
	themes: CoreThemeInfo[],
	agents: AgentFileInfo[] | undefined,
	tools: ImportedToolInfo[],
	commands: SlashCommandInfo[],
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

	if (themes.length > 0) {
		lines.push("", `## **Themes** (${themes.length})`);
		for (const theme of themes) {
			lines.push(`- \`${theme.name}\`${theme.path ? SEPARATOR + theme.path : " [built-in]"}`);
		}
	}

	if (agents && agents.length > 0) {
		lines.push("", `## **Agent Context Files** (${agents.length})`);
		for (const file of agents) {
			lines.push(renderAgentListItem(file));
		}
	}

	if (tools.length > 0) {
		lines.push("", `## **Tools** (${tools.length})`);
		for (const tool of tools) {
			const desc = tool.description ?? "";
			const line = `\`${tool.name}\`${desc ? SEPARATOR + desc : ""}`;
			const wrapped = desc ? wrapPlain(line, width, CONTINUATION_INDENT) : line;
			lines.push(wrapped);
		}
	}

	lines.push(...sectionLines("Skills", grouped.skills, grouped.skills.length));
	lines.push(...sectionLines("Commands", grouped.builtin, grouped.builtin.length));
	lines.push(...sectionLines("Prompt Templates", grouped.prompts, grouped.prompts.length));

	return lines.join("\n");
}

// ─── Lookup ────────────────────────────────────────────────────────────────────

function wrapCommand(cmd: SlashCommandInfo): FoundItem {
	return { kind: "command", item: cmd };
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
		const kindLabel = match.kind === "tool" ? "tool" : SOURCE_LABELS[match.item.source as CommandSource] ?? match.item.source;
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

// ─── Agent Context Files ───────────────────────────────────────────────────────

function showAgentOverview(width: number, cwd: string, agents?: AgentFileInfo[]): string {
	if (!agents || agents.length === 0) {
		return "**No agent context files loaded.**\n\n"
			+ "Context files (AGENTS.md, CLAUDE.md) contribute to the system prompt.\n\n"
			+ "To set up agent context files:\n"
			+ "  1. Create `AGENTS.md` or `CLAUDE.md` in your project root\n"
			+ "  2. Global files can be placed in `~/.pi/AGENTS.md`\n\n"
			+ "If you see this message after having agent files, try `/reload`.";
	}

	const lines: string[] = [
		`## **Agent Context Files** (${agents.length})`,
		"",
	];

	// Group by level
	const byLevel = new Map<string, AgentFileInfo[]>();
	for (const file of agents) {
		const level = file.path === cwd ? "Workspace" : file.level;
		const list = byLevel.get(level) ?? [];
		list.push(file);
		byLevel.set(level, list);
	}

	const levelOrder = ["Global", "Workspace", "Ancestor"];
	let firstInSection = true;
	for (const level of levelOrder) {
		const list = byLevel.get(level);
		if (!list || list.length === 0) continue;
		if (!firstInSection) lines.push("");
		lines.push(`**${level}:**`);
		for (const file of list) {
			lines.push(renderAgentListItem(file));
		}
		firstInSection = false;
	}

	lines.push("");
	lines.push("_Files are captured from the current system prompt. Run `/reload` to refresh after changes._");
	return lines.join("\n");
}

function showAgentDetail(file: AgentFileInfo): string {
	const lines: string[] = [
		`## **Agent Context File:** \`${file.path}\``,
		"",
		`**Level:** ${file.level}`,
		"",
		"**Content:**",
	];
	if (file.content) {
		lines.push("```markdown");
		lines.push(file.content);
		if (!file.content.endsWith("\n")) lines.push("");
		lines.push("```");
	} else {
		lines.push("_Empty file._");
	}
	return lines.join("\n");
}

function showAgentCandidates(matches: AgentFileInfo[]): string {
	const lines: string[] = ["**Multiple agent context file matches found:**", ""];
	for (const file of matches) {
		lines.push(renderAgentListItem(file));
	}
	lines.push("");
	lines.push("Try `/show agent_context <exact_path>` for details.");
	return lines.join("\n");
}

function showAgentsNotFound(query: string, allFiles: AgentFileInfo[]): string {
	if (allFiles.length === 0) {
		return `**No agent context file matching "${query}" found.**\n\n` +
			"**No agent context files loaded.**\n" +
			"Create `AGENTS.md` or `CLAUDE.md` in your project root or `~/.pi/`.";
	}

	const lines: string[] = [
		`**No agent context file matching "${query}" found.**`,
		"",
		"**Available agent context files:**",
	];
	for (const file of allFiles) {
		lines.push(renderAgentListItem(file));
	}
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
			lines.push(`- \`${theme.name}\`${theme.path ? SEPARATOR + theme.path : " [built-in]"}`);
		}
	}

	return lines.join("\n");
}

// ─── Extended handler (extracted for testability) ─────────────────────────────

function handleShow(
	_args: string,
	ctx: ExtensionCommandContext,
	api: ExtensionAPI,
): string {
	const commands = api.getCommands();
	const tools = api.getAllTools() as ImportedToolInfo[];
	const themes: CoreThemeInfo[] = ctx.ui.getAllThemes?.() ?? [];
	const width = Math.max(MIN_DESC_WIDTH, getTerminalWidth() - WIDTH_PADDING);
	const model = extractModelInfo(ctx.model as Model | undefined);

	// Agent files: use cached (from before_agent_start), or parse & cache.
	const cwd = ctx.cwd;
	let agents = cachedAgentFiles;
	if (agents === undefined) {
		try {
			agents = parseAgentFiles(ctx.getSystemPrompt());
			cachedAgentFiles = agents;
		} catch {
			agents = [];
		}
	}

	const rawQuery = _args.trim();
	const query = rawQuery.toLowerCase();

	if (!query) {
		return showOverview(model, themes, agents, tools, commands, width);
	}

	// ─── Agent context files ────────────────────────────────────────────────
	if (query === "agent_context") {
		return showAgentOverview(width, cwd, agents);
	}

	if (query.startsWith("agent_context ")) {
		const rawSubquery = rawQuery.slice("agent_context ".length);
		if (!rawSubquery) {
			return showAgentOverview(width, cwd, agents);
		}
		const sub = rawSubquery.toLowerCase();
		const subBasename = sub.split("/").pop() ?? sub;
		if (!agents || agents.length === 0) {
			return showAgentsNotFound(rawSubquery, []);
		}
		const agentMatches = agents.filter((f) => {
			const fp = f.path.toLowerCase();
			const basename = f.path.split("/").pop()?.toLowerCase() ?? f.path.toLowerCase();
			// Match if stored path contains subquery OR user's path contains stored path OR basenames match
			return fp.includes(sub) || sub.includes(fp) || basename === subBasename;
		});
		if (agentMatches.length === 0) {
			return showAgentsNotFound(rawSubquery, agents);
		}
		if (agentMatches.length === 1) {
			return showAgentDetail(agentMatches[0]);
		}
		return showAgentCandidates(agentMatches);
	}

	const found = findByName(commands, tools, query);
	if (found) {
		return showDetail(found, width);
	}

	const matches = findPartialMatches(commands, tools, query);
	if (matches.length === 1) {
		return showDetail(matches[0], width);
	}

	const themeMatches = themes.filter((theme) => theme.name.toLowerCase().includes(query));
	if (themeMatches.length === 1) {
		return showThemeDetail(themeMatches[0]);
	}
	if (themeMatches.length > 0) {
		return showThemeCandidates(themeMatches);
	}
	if (matches.length > 0) {
		return showCandidates(matches, width);
	}

	return showNotFound(query, commands, tools, themes, width);
}

// ─── Extension Entry Point ─────────────────────────────────────────────────────

export default function piShowExtension(pi: ExtensionAPI): void {
	pi.registerCommand("show", {
		description: "Show pi-coding-agent info (commands, skills, prompts, tools, themes, model)",
		handler: async (_args: string, ctx: unknown) => {
			const result = handleShow(_args, ctx as ExtensionCommandContext, pi);
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

	// Capture agent context files when the agent loop starts.
	// This provides structured access to contextFiles.
	// If the event never fires (no agent loop yet), the handler
	// falls back to parsing ctx.getSystemPrompt().
	pi.on("before_agent_start", (event: unknown) => {
		const e = event as Record<string, unknown>;
		const opts = e.systemPromptOptions as Record<string, unknown> | undefined;
		const files = opts?.contextFiles as Array<{ path: string; content: string }> | undefined;
		cachedAgentFiles = files?.map((f) => ({
			path: f.path,
			level: inferAgentFileLevel(f.path),
			content: f.content,
		})) ?? [];
	});
}
