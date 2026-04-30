/**
 * Minimal type definitions for values not re-exported from @mariozechner/pi-coding-agent.
 *
 * These mirror the actual runtime shapes so we can type ctx.model
 * without any casts.
 */

/**
 * Runtime shape of ctx.model.
 * Mirrors Model<TApi> from @mariozechner/pi-ai (not re-exported from @mariozechner/pi-coding-agent).
 * @see https://github.com/mariozechner/pi-ai/blob/main/src/types.ts
 */
export interface Model {
	id: string;
	name: string;
	provider: string;
}

/**
 * Theme info — same shape as ThemeInfo in @mariozechner/pi-coding-agent.
 * Not re-exported from the agent's main entry point.
 * @see https://github.com/mariozechner/pi-coding-agent/blob/main/src/modes/interactive/theme/theme.ts
 */
export interface CoreThemeInfo {
	name: string;
	path: string | undefined;
}
