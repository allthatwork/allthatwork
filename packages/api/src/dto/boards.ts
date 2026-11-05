import z from "zod";
import { boardAtsSchema, boardRefSchema, boardRegionSchema, boardSourceSchema } from "@reactive-resume/schema/boards";

const companyId = z.object({ companyId: z.string().min(1) });
const ref = z.object({ ats: boardAtsSchema, region: boardRegionSchema, slug: z.string(), url: z.string() });
const candidate = ref.extend({
	name: z.string().nullable().describe("The board's own name, when its API gives one (Greenhouse)."),
	jobCount: z.number().int(),
	sample: z.array(z.string()).describe("A few of its open roles' titles."),
});

export const boardsDto = {
	company: {
		input: companyId,
		output: z.object({
			watched: z.array(
				ref.extend({
					id: z.string(),
					source: boardSourceSchema,
					confirmedAt: z.coerce.date(),
					name: z.string().nullable(),
					jobCount: z.number().int().nullable(),
					fetchedAt: z.coerce.date().nullable(),
					error: z.string().nullable().describe("Why the last check failed; its last postings are kept."),
				}),
			),
			detected: z.array(ref).describe("Boards named by the company's posting links on file, not yet watched."),
		}),
	},
	fromLink: {
		input: companyId.extend({ link: z.url({ protocol: /^https?$/ }).max(2048) }),
		output: z.array(candidate),
	},
	guess: { input: companyId, output: z.array(candidate) },
	watch: {
		input: companyId.extend(boardRefSchema.shape).extend({ source: boardSourceSchema }),
		output: z.object({
			id: z.string(),
			added: z.number().int().describe("Open roles that passed and landed in New roles."),
		}),
	},
	unwatch: { input: z.object({ id: z.string().min(1) }), output: z.void() },
	suggestions: {
		input: z.object({}),
		output: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				website: z.string().nullable(),
				contacts: z.number().int(),
				board: ref.nullable(),
				openRoles: z
					.number()
					.int()
					.nullable()
					.describe("Open roles matching target roles and places; null when unknown."),
			}),
		),
	},
};
