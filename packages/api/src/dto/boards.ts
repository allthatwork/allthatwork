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
			detected: z
				.array(
					ref.extend({
						jobCount: z.number().int().nullable().describe("Open roles at its last check; null when never read."),
					}),
				)
				.describe("Boards named by the company's posting links on file, not yet watched."),
			careersUrl: z
				.string()
				.nullable()
				.describe("A saved jobs link on a site that can't be watched (Workday, iCIMS and others)."),
		}),
	},
	fromLink: {
		input: companyId.extend({ link: z.url({ protocol: /^https?$/ }).max(2048) }),
		output: z.object({
			boards: z.array(candidate),
			savedLink: z
				.string()
				.nullable()
				.describe(
					"Set when the link leads to no Greenhouse, Ashby or Lever page (or couldn't be opened): it was saved as the company's jobs link, which can't be watched.",
				),
		}),
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
