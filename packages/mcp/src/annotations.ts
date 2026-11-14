import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type BehaviorAnnotations = ToolAnnotations &
	Required<Pick<ToolAnnotations, "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint">>;

export const READ_IDEMPOTENT: BehaviorAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};
export const READ_EXTERNAL: BehaviorAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
};
export const WRITE_NON_IDEMPOTENT: BehaviorAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};
export const WRITE_DESTRUCTIVE: BehaviorAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
};
export const WRITE_IDEMPOTENT: BehaviorAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};
export const WRITE_EXTERNAL: BehaviorAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
};
export const WRITE_DESTRUCTIVE_EXTERNAL: BehaviorAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: true,
};
