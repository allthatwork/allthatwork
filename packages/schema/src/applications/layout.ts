import z from "zod";
import { applicationSortSchema } from "./filters";

/**
 * How one account lays out the Applications screen: which List columns show after Role, in what order and how wide,
 * one width for every Board column, and the sort. Saved on the user (`applications_layout`) so it follows the account
 * to any browser. Data only, so saved views can store it too.
 */

/** The List columns that can show after Role, which always comes first and takes the width the others leave. */
export const LIST_COLUMN_IDS = [
	"next",
	"fit",
	"tfit",
	"build",
	"stage",
	"sent",
	"foundBy",
	"source",
	"lane",
	"salary",
	"tags",
	"followUp",
	"applied",
	"added",
	"updated",
] as const;

export type ListColumnId = (typeof LIST_COLUMN_IDS)[number];

export const DEFAULT_LIST_COLUMNS: readonly ListColumnId[] = ["next", "fit", "build", "stage", "sent", "updated"];

/** Each column's starting width and the narrowest it can be dragged, in px. */
export const LIST_COLUMN_WIDTHS: Readonly<Record<ListColumnId, { width: number; min: number }>> = {
	next: { width: 200, min: 120 },
	fit: { width: 56, min: 48 },
	tfit: { width: 104, min: 64 },
	build: { width: 88, min: 80 },
	stage: { width: 104, min: 80 },
	sent: { width: 56, min: 48 },
	foundBy: { width: 96, min: 70 },
	source: { width: 124, min: 80 },
	lane: { width: 176, min: 90 },
	salary: { width: 124, min: 80 },
	tags: { width: 160, min: 80 },
	followUp: { width: 104, min: 80 },
	applied: { width: 80, min: 64 },
	added: { width: 76, min: 64 },
	updated: { width: 104, min: 80 },
};

export const LIST_COLUMN_MAX_WIDTH = 640;

/** Role takes whatever the other columns leave, never less than this; past that the table scrolls sideways. */
export const ROLE_MIN_WIDTH = 240;

/** The width every Board column takes once one is dragged; unset, they share the board evenly. */
export const BOARD_COLUMN_WIDTH = { min: 256, max: 640 } as const;

const listColumnSchema = z.object({
	id: z.enum(LIST_COLUMN_IDS),
	/** Left out while the column has its starting width. */
	width: z.number().int().min(LIST_COLUMN_WIDTHS.fit.min).max(LIST_COLUMN_MAX_WIDTH).optional(),
});

export type ListColumn = z.output<typeof listColumnSchema>;

/** What the account may save. Anything left out takes its default. */
export const applicationsLayoutSchema = z.object({
	sort: applicationSortSchema.optional(),
	/** The shown columns after Role, in order. Unset: the default columns; empty: Role only. */
	listColumns: z
		.array(listColumnSchema)
		.max(LIST_COLUMN_IDS.length)
		.refine((columns) => new Set(columns.map((column) => column.id)).size === columns.length, {
			message: "Each column can show once.",
		})
		.optional(),
	boardColumnWidth: z.number().int().min(BOARD_COLUMN_WIDTH.min).max(BOARD_COLUMN_WIDTH.max).optional(),
});

export type ApplicationsLayout = z.output<typeof applicationsLayoutSchema>;

export const clampListColumnWidth = (id: ListColumnId, width: number) =>
	Math.round(Math.min(LIST_COLUMN_MAX_WIDTH, Math.max(LIST_COLUMN_WIDTHS[id].min, width)));

export const clampBoardColumnWidth = (width: number) =>
	Math.round(Math.min(BOARD_COLUMN_WIDTH.max, Math.max(BOARD_COLUMN_WIDTH.min, width)));

const storedColumnSchema = z.object({ id: z.enum(LIST_COLUMN_IDS), width: z.number().optional().catch(undefined) });

/**
 * Reads a saved layout leniently: anything unreadable falls back to its default, unknown or repeated columns are
 * dropped (so columns can be added or retired later), and widths are brought within each column's limits.
 */
export function readApplicationsLayout(value: unknown): ApplicationsLayout {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const raw = value as Record<string, unknown>;
	const layout: ApplicationsLayout = {};

	if (raw.sort && typeof raw.sort === "object") {
		const sort = applicationSortSchema.safeParse(raw.sort);
		if (sort.success) layout.sort = sort.data;
	}

	if (Array.isArray(raw.listColumns)) {
		const seen = new Set<ListColumnId>();
		const columns: ListColumn[] = [];
		for (const item of raw.listColumns) {
			const parsed = storedColumnSchema.safeParse(item);
			if (!parsed.success || seen.has(parsed.data.id)) continue;
			const { id, width } = parsed.data;
			seen.add(id);
			columns.push(
				width === undefined || !Number.isFinite(width) ? { id } : { id, width: clampListColumnWidth(id, width) },
			);
		}
		layout.listColumns = columns;
	}

	if (typeof raw.boardColumnWidth === "number" && Number.isFinite(raw.boardColumnWidth)) {
		layout.boardColumnWidth = clampBoardColumnWidth(raw.boardColumnWidth);
	}

	return layout;
}

/** The List's columns after Role with their widths, the defaults filled in. */
export function resolveListColumns(layout: ApplicationsLayout): { id: ListColumnId; width: number }[] {
	const columns: readonly ListColumn[] = layout.listColumns ?? DEFAULT_LIST_COLUMNS.map((id) => ({ id }));
	return columns.map((column) => ({ id: column.id, width: column.width ?? LIST_COLUMN_WIDTHS[column.id].width }));
}
