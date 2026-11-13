import z from "zod";

// Records are read one by one on the server (see features/account-import/records.ts), so a bad one is skipped and
// counted instead of failing the whole area.
const records = (description: string) =>
	z.array(z.record(z.string(), z.unknown())).max(50_000).default([]).describe(description);

const idMap = z.record(z.string().max(64), z.string().max(64));

export const importIdsSchema = z
	.object({
		resume: idMap.optional(),
		company: idMap.optional(),
		contact: idMap.optional(),
		letter: idMap.optional(),
		application: idMap.optional(),
		fact: idMap.optional(),
		story: idMap.optional(),
		artifact: idMap.optional(),
		schedule: idMap.optional(),
		thread: idMap.optional(),
	})
	.default({})
	.describe(
		"Old id → new id, per kind, as returned by earlier areas of the same import. New ids the user doesn't own are ignored.",
	);

const modeSchema = z
	.enum(["append", "replace"])
	.default("append")
	.describe("append adds everything as new records; replace first deletes everything the account has in this area.");

export const importAreaSchema = z.enum([
	"documents",
	"directory",
	"applications",
	"knowledge",
	"jobSearch",
	"coach",
	"settings",
]);
export type ImportArea = z.infer<typeof importAreaSchema>;

export const accountImportDto = {
	preview: {
		output: z.object({
			directory: z.object({ companies: z.number(), contacts: z.number() }),
			documents: z.object({ resumes: z.number(), letters: z.number(), locked: z.number() }),
			applications: z.object({
				applications: z.number(),
				linked: z.number().describe("Facts, stories, saved items, schedules and conversations tied to an application."),
				views: z.number().describe("Saved views of the Applications screen."),
			}),
			knowledge: z.object({ facts: z.number(), stories: z.number(), groups: z.number() }),
			jobSearch: z.object({ opportunities: z.number(), schedules: z.number() }),
			coach: z.object({ threads: z.number() }),
		}),
	},

	run: {
		input: z.discriminatedUnion("area", [
			z.object({
				area: z.literal("documents"),
				mode: modeSchema,
				resumes: records("Resume files from resumes/ in the archive."),
				letters: records("Letter files from letters/ in the archive."),
			}),
			z.object({
				area: z.literal("directory"),
				mode: modeSchema,
				companies: records("directory.json companies."),
				contacts: records("directory.json contacts."),
				employment: records("directory.json employment."),
				notes: records("directory.json notes."),
			}),
			z.object({
				area: z.literal("applications"),
				mode: modeSchema,
				ids: importIdsSchema,
				applications: records("applications.json."),
				views: z
					.array(z.record(z.string(), z.unknown()))
					.max(1000)
					.default([])
					.describe("application-views.json: saved views of the Applications screen."),
				workspaces: records("career.json workspaces."),
				letterLinks: z
					.array(z.object({ letterId: z.string().max(64), applicationId: z.string().max(64) }))
					.max(50_000)
					.default([])
					.describe("Letters written for an application, by old ids."),
			}),
			z.object({
				area: z.literal("knowledge"),
				mode: modeSchema,
				ids: importIdsSchema,
				facts: records("career.json facts."),
				groups: records("career.json factGroups."),
				overrides: records("career.json factOverrides."),
				stories: records("career.json stories."),
				artifacts: records("career.json artifacts (saved items)."),
			}),
			z.object({
				area: z.literal("jobSearch"),
				mode: modeSchema,
				ids: importIdsSchema,
				opportunities: records("career.json opportunities."),
				schedules: records("career.json schedules. They come in switched off."),
			}),
			z.object({
				area: z.literal("coach"),
				mode: modeSchema,
				ids: importIdsSchema,
				threads: records("career.json threads."),
				messages: records("career.json messages."),
				transcripts: records("career.json transcripts."),
			}),
			z.object({
				area: z.literal("settings"),
				preferences: z.record(z.string(), z.unknown()).nullable().default(null).describe("account.json user."),
				aiLimits: z.record(z.string(), z.unknown()).nullable().default(null).describe("career.json aiLimits."),
				profile: z.record(z.string(), z.unknown()).nullable().default(null).describe("career.json profile."),
			}),
		]),
		output: z.object({
			ids: importIdsSchema,
			added: z.record(z.string(), z.number().int()).describe("Records added, by kind."),
			skipped: z
				.array(
					z.object({
						kind: z.string(),
						reason: z
							.enum(["unreadable", "unlinked", "exists", "files", "limit"])
							.describe(
								"unreadable: not valid; unlinked: tied to something not imported; exists: already in the account; files: the file isn't in the export; limit: over the account's limit (50 saved views).",
							),
						count: z.number().int(),
					}),
				)
				.default([]),
			madePrivate: z.number().int().default(0).describe("Resumes that were public and came in private."),
			shortened: z
				.array(
					z.object({
						kind: z.string(),
						field: z.string(),
						max: z.number().int().describe("The most characters the API keeps for this field."),
						count: z.number().int(),
					}),
				)
				.default([])
				.describe("Text longer than the API returns for its field, cut to fit, by kind and field."),
		}),
	},
};

export type AccountImportInput = z.input<typeof accountImportDto.run.input>;
export type AccountImportResult = z.infer<typeof accountImportDto.run.output>;
