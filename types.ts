/**
 * Minimal type definitions for values not re-exported from @mariozechner/pi-coding-agent.
 *
 * These mirror the actual runtime shapes so we can type ctx.model
 * without any casts.
 */

/** Runtime shape of ctx.model — mirrors Model<TApi> from @mariozechner/pi-ai. */
export interface Model {
	id: string;
	name: string;
	provider: string;
}

/** Theme info — same shape as the core package's ThemeInfo. */
export interface CoreThemeInfo {
	name: string;
	path: string | undefined;
}
