import type { DbOrTx } from "@reactive-resume/db/client";
import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import { ORPCError } from "@orpc/client";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import z from "zod";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import {
	APPLICATION_VIEWS_MAX,
	applicationViewFiltersSchema,
	applicationViewLayoutSchema,
	applicationViewNameSchema,
	applicationViewSchema,
	readApplicationViewFilters,
	readApplicationViewLayout,
} from "@reactive-resume/schema/applications/views";
import { protectedProcedure } from "../../context";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { lockDocumentOwner } from "../documents/ownership";

type Row = typeof schema.applicationView.$inferSelect;

/** A stored view as the API returns it, its filters and layout read leniently. */
export const toApplicationView = (row: Row): ApplicationView => ({
	id: row.id,
	name: row.name,
	filters: readApplicationViewFilters(row.filters),
	layout: readApplicationViewLayout(row.layout),
	isDefault: row.isDefault,
	position: row.position,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

const owned = (userId: string) => eq(schema.applicationView.userId, userId);
const byOrder = [asc(schema.applicationView.position), asc(schema.applicationView.createdAt)];

const nameTaken = (name: string) =>
	new ORPCError("CONFLICT", {
		message: `You already have a view called "${name}".`,
		data: { reason: "name-taken" },
	});

const isUniqueViolation = (error: unknown): boolean => {
	if (!error || typeof error !== "object") return false;
	if ("code" in error && error.code === "23505") return true;
	return "cause" in error && isUniqueViolation(error.cause);
};

/** Whether the user has another view with this name, ignoring case. */
async function nameInUse(client: DbOrTx, userId: string, name: string, exceptId?: string) {
	const [row] = await client
		.select({ id: schema.applicationView.id })
		.from(schema.applicationView)
		.where(
			and(
				owned(userId),
				sql`lower(${schema.applicationView.name}) = lower(${name})`,
				...(exceptId ? [ne(schema.applicationView.id, exceptId)] : []),
			),
		)
		.limit(1);
	return Boolean(row);
}

async function clearDefault(client: DbOrTx, userId: string) {
	await client
		.update(schema.applicationView)
		.set({ isDefault: false })
		.where(and(owned(userId), eq(schema.applicationView.isDefault, true)));
}

/** Runs a write in a transaction that holds the user's row, so counts and names can't race; a name clash is a conflict. */
async function write<T>(userId: string, name: string | undefined, run: (tx: DbOrTx) => Promise<T>): Promise<T> {
	try {
		return await db.transaction(async (tx) => {
			await lockDocumentOwner(tx, userId);
			return run(tx);
		});
	} catch (error) {
		if (name !== undefined && isUniqueViolation(error)) throw nameTaken(name);
		throw error;
	}
}

type CreateInput = {
	userId: string;
	name: string;
	filters: ApplicationView["filters"];
	layout: ApplicationView["layout"];
	isDefault?: boolean | undefined;
};

type UpdateInput = {
	userId: string;
	id: string;
	name?: string | undefined;
	filters?: ApplicationView["filters"] | undefined;
	layout?: ApplicationView["layout"] | undefined;
	isDefault?: boolean | undefined;
};

export const applicationViewService = {
	list: async (userId: string): Promise<ApplicationView[]> => {
		const rows = await db
			.select()
			.from(schema.applicationView)
			.where(owned(userId))
			.orderBy(...byOrder);
		return rows.map(toApplicationView);
	},

	/** A new view at the end of the list. Up to 50 per account; names are unique ignoring case. */
	create: (input: CreateInput): Promise<ApplicationView> =>
		write(input.userId, input.name, async (tx) => {
			const [{ total = 0 } = {}] = await tx
				.select({ total: count() })
				.from(schema.applicationView)
				.where(owned(input.userId));
			if (total >= APPLICATION_VIEWS_MAX) {
				throw new ORPCError("BAD_REQUEST", {
					message: `You can keep up to ${APPLICATION_VIEWS_MAX} views. Delete one to save another.`,
					data: { reason: "limit" },
				});
			}
			if (await nameInUse(tx, input.userId, input.name)) throw nameTaken(input.name);
			if (input.isDefault) await clearDefault(tx, input.userId);
			const [{ last = null } = {}] = await tx
				.select({ last: sql<number | null>`max(${schema.applicationView.position})` })
				.from(schema.applicationView)
				.where(owned(input.userId));
			const [row] = await tx
				.insert(schema.applicationView)
				.values({
					userId: input.userId,
					name: input.name,
					filters: input.filters,
					layout: input.layout,
					isDefault: input.isDefault ?? false,
					position: last === null ? 0 : Number(last) + 1,
				})
				.returning();
			if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
			return toApplicationView(row);
		}),

	/** Changes what's given. Setting the default clears the old one in the same transaction. */
	update: (input: UpdateInput): Promise<ApplicationView> =>
		write(input.userId, input.name, async (tx) => {
			const [current] = await tx
				.select({ id: schema.applicationView.id })
				.from(schema.applicationView)
				.where(and(owned(input.userId), eq(schema.applicationView.id, input.id)));
			if (!current) throw new ORPCError("NOT_FOUND");
			if (input.name !== undefined && (await nameInUse(tx, input.userId, input.name, input.id))) {
				throw nameTaken(input.name);
			}
			if (input.isDefault) await clearDefault(tx, input.userId);
			const [row] = await tx
				.update(schema.applicationView)
				.set({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.filters !== undefined ? { filters: input.filters } : {}),
					...(input.layout !== undefined ? { layout: input.layout } : {}),
					...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
					updatedAt: new Date(),
				})
				.where(and(owned(input.userId), eq(schema.applicationView.id, input.id)))
				.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			return toApplicationView(row);
		}),

	/**
	 * Puts the views in this order. Ids the user doesn't own are ignored; views left out keep their order after the
	 * listed ones.
	 */
	reorder: (input: { userId: string; ids: string[] }): Promise<ApplicationView[]> =>
		write(input.userId, undefined, async (tx) => {
			const rows = await tx
				.select({ id: schema.applicationView.id })
				.from(schema.applicationView)
				.where(owned(input.userId))
				.orderBy(...byOrder);
			const ownedIds = new Set(rows.map((row) => row.id));
			const listed = [...new Set(input.ids)].filter((id) => ownedIds.has(id));
			const order = [...listed, ...rows.map((row) => row.id).filter((id) => !listed.includes(id))];
			for (const [position, id] of order.entries()) {
				await tx
					.update(schema.applicationView)
					.set({ position })
					.where(and(owned(input.userId), eq(schema.applicationView.id, id)));
			}
			const updated = await tx
				.select()
				.from(schema.applicationView)
				.where(owned(input.userId))
				.orderBy(...byOrder);
			return updated.map(toApplicationView);
		}),

	/** Deletes one view and returns it, so the client can offer Undo. */
	delete: async (input: { userId: string; id: string }): Promise<ApplicationView> => {
		const [row] = await db
			.delete(schema.applicationView)
			.where(and(owned(input.userId), eq(schema.applicationView.id, input.id)))
			.returning();
		if (!row) throw new ORPCError("NOT_FOUND");
		return toApplicationView(row);
	},
};

const idInput = z.string().min(1).max(64).describe("The view's ID.");

const tags = ["Applications"];

export const viewsRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/applications/views",
			tags,
			operationId: "listApplicationViews",
			summary: "List saved views",
			description:
				"Returns the authenticated user's saved views of the Applications screen in menu order. A view is a name for a set of filters, a sort and the List columns. Requires authentication.",
			successDescription: "The user's saved views.",
		})
		.input(z.object({}).optional())
		.output(z.array(applicationViewSchema))
		.handler(({ context }) => applicationViewService.list(context.user.id)),

	create: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/views",
			tags,
			operationId: "createApplicationView",
			summary: "Save a view",
			description: `Saves a view at the end of the list. Names are unique per user ignoring case (409 when taken), up to ${APPLICATION_VIEWS_MAX} views. Making it the default clears the previous default. Requires authentication.`,
			successDescription: "The new view.",
		})
		.input(
			z.object({
				name: applicationViewNameSchema,
				filters: applicationViewFiltersSchema,
				layout: applicationViewLayoutSchema,
				isDefault: z.boolean().optional().describe("Open Applications with this view in a new tab."),
			}),
		)
		.use(resumeMutationRateLimit)
		.output(applicationViewSchema)
		.handler(({ input, context }) => applicationViewService.create({ userId: context.user.id, ...input })),

	update: protectedProcedure
		.route({
			method: "PUT",
			path: "/applications/views/{id}",
			tags,
			operationId: "updateApplicationView",
			summary: "Update a saved view",
			description:
				"Renames a view, replaces its filters or layout, or sets or clears it as the default. Only given fields change. Requires authentication.",
			successDescription: "The updated view.",
		})
		.input(
			z.object({
				id: idInput,
				name: applicationViewNameSchema.optional(),
				filters: applicationViewFiltersSchema.optional(),
				layout: applicationViewLayoutSchema.optional(),
				isDefault: z.boolean().optional(),
			}),
		)
		.use(resumeMutationRateLimit)
		.output(applicationViewSchema)
		.handler(({ input, context }) => applicationViewService.update({ userId: context.user.id, ...input })),

	reorder: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/views/reorder",
			tags,
			operationId: "reorderApplicationViews",
			summary: "Reorder saved views",
			description:
				"Puts the user's views in the given order. Views left out keep their order after the listed ones. Requires authentication.",
			successDescription: "The views in their new order.",
		})
		.input(z.object({ ids: z.array(idInput).max(APPLICATION_VIEWS_MAX * 2) }))
		.use(resumeMutationRateLimit)
		.output(z.array(applicationViewSchema))
		.handler(({ input, context }) => applicationViewService.reorder({ userId: context.user.id, ids: input.ids })),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/applications/views/{id}",
			tags,
			operationId: "deleteApplicationView",
			summary: "Delete a saved view",
			description: "Deletes one saved view and returns it. Requires authentication.",
			successDescription: "The deleted view.",
		})
		.input(z.object({ id: idInput }))
		.use(resumeMutationRateLimit)
		.output(applicationViewSchema)
		.handler(({ input, context }) => applicationViewService.delete({ userId: context.user.id, id: input.id })),
};
