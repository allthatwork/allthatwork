import z from "zod";
import { aiOperationIdsSchema } from "@reactive-resume/schema/ai-usage";
import {
	careerFactInputSchema,
	careerImportFactsInputSchema,
	careerImportFactsResultSchema,
	careerFactCorrectionSchema,
	resumeFactProposalSchema,
	resumeFactsReviewSchema,
	careerOfferInputSchema,
	careerProfileDataSchema,
	careerProfileUpdateSchema,
	careerScheduleInputSchema,
	careerScopeSchema,
	careerStoryInputSchema,
	careerWorkspaceSchema,
	knowledgeReviewSchema,
	factGroupSchema,
	factStatusSchema,
	factSwitchSchema,
	overrideModeSchema,
	generateTaskSchema,
	aiLimitsSchema,
	memoryModeSchema,
	roleSuggestionsInputSchema,
	roleSuggestionsOutputSchema,
	offerTermsSchema,
} from "@reactive-resume/schema/career";
import { protectedProcedure } from "../../context";
import { savedStagesSchema } from "../../dto/application";
import {
	careerFactOverrideSchema,
	careerFactSchema,
	careerNotificationSchema,
	careerOpportunitySchema,
	careerScheduleListItemSchema,
	careerScheduleSchema,
	careerStorySchema,
	savedItemSchema,
} from "../../dto/career";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { searchScope } from "../web-access/regions";
import { answerRouter } from "./answer-router";
import { generateCareer } from "./generate";
import { joinInFlight } from "./in-flight";
import { careerJobs } from "./jobs";
import { knowledgeReview } from "./review";
import { suggestTargetRoles } from "./role-suggestions";
import { careerService, hasFitEvidence } from "./service";
import { careerVoiceRouter } from "./voice";

const id = z.object({ id: z.string().min(1) });
const applicationInput = z.object({ applicationId: z.string().min(1) });
const updatedOutput = z.object({ updated: z.number().int().describe("How many facts changed.") });
const factGroupOutput = z.object({
	group: z.string().nullable().describe("The group's path; null for facts in no group."),
	status: factSwitchSchema
		.nullable()
		.describe("How the group was last switched: new facts in it start this way. Null starts them switched on."),
	private: z
		.boolean()
		.describe("Its facts, and its subgroups', never reach the AI unless an application includes the group."),
	facts: z.object({ active: z.number().int(), excluded: z.number().int(), archived: z.number().int() }),
	activeChars: z
		.number()
		.int()
		.describe("JSON characters of its shared, switched-on facts, as the action budgets count them."),
});
const savedItemOutput = savedItemSchema.extend({
	application: z
		.object({
			company: z.string(),
			role: z.string(),
			status: z.string().nullable().optional(),
			closedReason: z.string().nullable().optional(),
		})
		.nullable(),
	outdated: z.boolean(),
	submission: z
		.boolean()
		.optional()
		.describe("Answers recorded at submission, separate from generated or current drafts."),
});

export const careerRouter = {
	suggestTargetRoles: protectedProcedure
		.use(aiRequestRateLimit)
		.route({
			method: "POST",
			path: "/career/target-roles/suggest",
			tags: ["Career"],
			operationId: "suggestCareerTargetRoles",
			summary: "Suggest editable target roles",
			description:
				"Sends only the explicitly selected owned resume and opted-in active shared Knowledge to the selected tested AI provider. Requires recipientVersion from the disclosed aiProviders.list configuration; changed settings return CONFLICT before sending. Returns unsaved suggestions with source quotes for user review. Does not search, schedule, save evidence or apply.",
		})
		.input(roleSuggestionsInputSchema)
		.output(roleSuggestionsOutputSchema)
		.handler(({ context, input, signal }) => suggestTargetRoles(context.user.id, input, signal)),
	answers: answerRouter,
	voice: careerVoiceRouter,
	schedules: protectedProcedure
		.route({
			method: "GET",
			path: "/career/schedules",
			tags: ["Career"],
			operationId: "listCareerSchedules",
			summary: "List career schedules",
		})
		.input(z.object({}))
		.output(z.array(careerScheduleListItemSchema))
		.handler(({ context }) => careerJobs.list(context.user.id)),
	saveSchedule: protectedProcedure
		.route({
			method: "POST",
			path: "/career/schedules",
			tags: ["Career"],
			operationId: "saveCareerSchedule",
			summary: "Save a career schedule",
		})
		.input(careerScheduleInputSchema.extend({ id: z.string().optional() }))
		.output(careerScheduleSchema)
		.handler(async ({ context, input }) => {
			if (input.kind === "discovery" && input.enabled)
				await searchScope(context.user.id, context.reqHeaders.get("x-client-timezone") ?? undefined);
			return careerJobs.save(context.user.id, input);
		}),
	runSchedule: protectedProcedure
		.route({
			method: "POST",
			path: "/career/schedules/{id}/run",
			tags: ["Career"],
			operationId: "runCareerSchedule",
			summary: "Check watched companies now",
			description:
				"Queues a run of the account's Watched companies schedule (kind boards) now, beside its own times. The scheduler starts it within a minute. Only that schedule can be run this way.",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.runNow(context.user.id, input.id)),
	deleteSchedule: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/schedules/{id}",
			tags: ["Career"],
			operationId: "deleteCareerSchedule",
			summary: "Delete a career schedule",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.delete(context.user.id, input.id)),
	notifications: protectedProcedure
		.route({
			method: "GET",
			path: "/career/notifications",
			tags: ["Career"],
			operationId: "listCareerNotifications",
			summary: "List career notifications",
		})
		.input(z.object({}))
		.output(z.array(careerNotificationSchema))
		.handler(({ context }) => careerJobs.notifications(context.user.id)),
	markNotificationRead: protectedProcedure
		.route({
			method: "POST",
			path: "/career/notifications/{id}/read",
			tags: ["Career"],
			operationId: "readCareerNotification",
			summary: "Mark a career notification as read",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.markRead(context.user.id, input.id)),
	opportunities: protectedProcedure
		.route({
			method: "GET",
			path: "/career/opportunities",
			tags: ["Career"],
			operationId: "listCareerOpportunities",
			summary: "List discovered opportunities",
		})
		.input(z.object({}))
		.output(z.array(careerOpportunitySchema))
		.handler(({ context }) => careerJobs.opportunities(context.user.id)),
	dismissOpportunity: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/opportunities/{id}",
			tags: ["Career"],
			operationId: "dismissCareerOpportunity",
			summary: "Dismiss a discovered opportunity",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.dismissOpportunity(context.user.id, input.id)),
	trackOpportunity: protectedProcedure
		.route({
			method: "POST",
			path: "/career/opportunities/{id}/track",
			tags: ["Career"],
			operationId: "trackCareerOpportunity",
			summary: "Track a discovered opportunity",
			description: "Creates an application at Saved with the posting link, summary and the preferences it matched.",
		})
		.input(id)
		.output(applicationInput)
		.handler(({ context, input }) => careerService.trackOpportunity(context.user.id, input.id)),
	profile: protectedProcedure
		.route({
			method: "GET",
			path: "/career/profile",
			tags: ["Career"],
			operationId: "getCareerProfile",
			summary: "Get career preferences",
		})
		.input(z.object({}).optional())
		.output(careerProfileDataSchema)
		.handler(({ context }) => careerService.profile(context.user.id)),
	saveProfile: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/profile",
			tags: ["Career"],
			operationId: "saveCareerProfile",
			summary: "Save career preferences",
			description:
				"Legacy full save: omitted memoryMode and searchRegions retain stored values; other omitted fields use their defaults.",
		})
		.input(careerProfileDataSchema.extend({ memoryMode: memoryModeSchema.optional() }))
		.output(careerProfileDataSchema)
		.handler(({ context, input }) => careerService.saveProfile(context.user.id, input)),
	updateProfile: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/profile",
			tags: ["Career"],
			operationId: "updateCareerProfile",
			summary: "Update career preferences",
			description: "Saves the supplied fields. Omitted fields keep their stored values.",
		})
		.input(careerProfileUpdateSchema)
		.output(careerProfileDataSchema)
		.handler(({ context, input }) => careerService.saveProfile(context.user.id, input)),
	aiLimits: protectedProcedure
		.route({
			method: "GET",
			path: "/career/ai-limits",
			tags: ["Career"],
			operationId: "getAiLimits",
			summary: "Get AI limits",
			description:
				"How much Knowledge each AI request may carry and how long it may run: facts and stories the coach shares up front, what one coach knowledge search returns, the fact and story budgets of Fit, Apply, Prepare and the other application actions, and the time limits of those actions and of Coach and Assistant replies. Unset limits come back as their defaults.",
		})
		.input(z.object({}).optional())
		.output(aiLimitsSchema)
		.handler(({ context }) => careerService.aiLimits(context.user.id)),
	saveAiLimits: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/ai-limits",
			tags: ["Career"],
			operationId: "saveAiLimits",
			summary: "Save AI limits",
			description:
				"Replaces every AI limit; omitted ones go back to their defaults. Character budgets are JSON characters and times are seconds. Larger Knowledge limits send more of your Knowledge to your AI provider and need a model with a larger context window; longer time limits suit slower models.",
		})
		.input(aiLimitsSchema)
		.output(aiLimitsSchema)
		.handler(({ context, input }) => careerService.saveAiLimits(context.user.id, input)),
	facts: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "listCareerFacts",
			summary: "List career facts",
		})
		.input(
			careerScopeSchema.extend({
				query: z.string().max(500).optional(),
				all: z.boolean().optional().describe("Every fact, shared and private to any application."),
				group: factGroupSchema.optional().describe("Only facts in this group or a group under it."),
			}),
		)
		.output(z.array(careerFactSchema))
		.handler(({ context, input }) => careerService.facts({ userId: context.user.id, ...input })),
	importFacts: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/imports",
			tags: ["Career"],
			operationId: "importCareerFacts",
			summary: "Import reviewed facts from a file",
			description:
				"Saves up to 500 user-reviewed shared facts in one transaction. Repeated sources and normalized duplicates are skipped; corrected, excluded, archived and forgotten sources are never recreated. Group switches and privacy still apply. No resume is created.",
		})
		.input(careerImportFactsInputSchema)
		.output(careerImportFactsResultSchema)
		.handler(({ context, input }) => careerService.importFacts(context.user.id, input)),
	forgottenFacts: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts/forgotten",
			tags: ["Career"],
			operationId: "listForgottenCareerFactCounts",
			summary: "List redacted forgotten fact counts and timestamps",
		})
		.input(z.object({}))
		.output(z.array(z.object({ count: z.number().int().positive(), at: z.date() })))
		.handler(({ context }) => careerService.forgottenFacts(context.user.id)),
	proposeResumeFacts: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/resume/preview",
			tags: ["Career"],
			operationId: "proposeResumeFacts",
			summary: "Review facts from an owned resume",
			description: "Returns visible resume excerpts without saving facts or contacting an AI provider.",
		})
		.input(z.object({ resumeId: z.string().min(1) }))
		.output(
			z.object({
				id: z.string(),
				name: z.string(),
				updatedAt: z.coerce.date(),
				proposals: z.array(resumeFactProposalSchema).max(50),
				omitted: z.number().int().nonnegative(),
			}),
		)
		.handler(({ context, input }) => careerService.proposeResumeFacts(context.user.id, input.resumeId)),
	saveResumeFacts: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/resume/import",
			tags: ["Career"],
			operationId: "saveResumeFacts",
			summary: "Save reviewed resume facts",
			description:
				"Atomically saves only selected facts as shared Knowledge, retaining their exact resume quotations. Rejects a changed or trashed source. Existing, corrected and switched-off Knowledge is preserved.",
		})
		.input(resumeFactsReviewSchema)
		.output(z.object({ saved: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }))
		.handler(({ context, input }) => careerService.saveResumeFacts(context.user.id, input)),
	saveFact: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "saveCareerFact",
			summary: "Save a career fact",
		})
		.input(careerFactInputSchema)
		.output(careerFactSchema.omit({ usedBy: true, company: true }).nullable())
		.handler(({ context, input }) => careerService.saveFact(context.user.id, input)),
	updateFact: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/facts/{id}",
			tags: ["Career"],
			operationId: "updateCareerFact",
			summary: "Update a career fact",
		})
		.input(
			id.extend({
				text: z.string().trim().min(1).max(2000).optional(),
				status: factStatusSchema
					.optional()
					.describe("archived keeps the fact but hides it and never sends it; active or excluded restores it."),
				share: z.boolean().optional(),
				group: factGroupSchema
					.nullable()
					.optional()
					.describe("Moves the fact to this group; null takes it out of any."),
			}),
		)
		.output(z.void())
		.handler(async ({ context, input }) => {
			await careerService.updateFact(context.user.id, input);
		}),
	updateFacts: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "updateCareerFacts",
			summary: "Switch or regroup several career facts",
			description:
				"Switches the listed facts on or off, moves them to a group, or both, in one change. Forgotten facts are skipped.",
		})
		.input(
			z.object({
				ids: z.array(z.string().min(1)).min(1).max(1000),
				status: factStatusSchema.optional(),
				group: factGroupSchema
					.nullable()
					.optional()
					.describe("Moves the facts to this group; null takes them out of any."),
			}),
		)
		.output(updatedOutput)
		.handler(({ context, input }) => careerService.updateFacts(context.user.id, input)),
	duplicates: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts/duplicates",
			tags: ["Career"],
			operationId: "listCareerFactDuplicates",
			summary: "Find duplicate career facts",
			description:
				"Exact duplicates (the same text, ignoring case, accents, punctuation and spacing) as sets with the fact to keep, and near duplicates (mostly the same words) as pairs with their similarity from 0 to 1. Only facts in use (switched on or off) count, and only within one scope: shared facts, or shared and one application's private facts.",
		})
		.input(z.object({}).optional())
		.output(
			z.object({
				exact: z.array(z.object({ keep: z.string(), copies: z.array(z.string()) })),
				near: z.array(
					z.object({
						factIds: z.array(z.string()),
						similarity: z.number(),
						contained: z
							.boolean()
							.describe("Matched because the longer fact holds nearly all of the shorter one's words."),
					}),
				),
				facts: z.array(
					z.object({
						id: z.string(),
						text: z.string(),
						applicationId: z.string().nullable(),
						company: z.string().nullable().describe("The application a private fact belongs to."),
						status: z.string(),
						group: z.string().nullable(),
					}),
				),
			}),
		)
		.handler(({ context }) => careerService.duplicates(context.user.id)),
	cleanDuplicates: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/duplicates/clean",
			tags: ["Career"],
			operationId: "cleanCareerFactDuplicates",
			summary: "Remove application copies of shared facts",
			description:
				"Folds every word-for-word copy of a shared fact that sits in an application into the shared fact: its stories, saved items and overrides move over, the copy is archived, and the shared fact is included for that application if it wouldn't reach it otherwise. Copies among shared facts are left alone.",
		})
		.input(z.object({}).optional())
		.output(updatedOutput)
		.handler(({ context }) => careerService.cleanDuplicates(context.user.id)),
	mergeFact: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/{id}/merge",
			tags: ["Career"],
			operationId: "mergeCareerFact",
			summary: "Merge a career fact into another",
			description:
				"Keeps the fact given as into and archives this one, which can be restored. This fact's stories, saved items and per-application overrides move to the one kept. If the one kept is private to an application and this one reached more applications, the one kept becomes shared, so no application loses it; it also takes this one's group if it has none. The one kept must not be archived.",
		})
		.input(id.extend({ into: z.string().min(1) }))
		.output(updatedOutput)
		.handler(({ context, input }) => careerService.mergeFact(context.user.id, input)),
	review: protectedProcedure
		.route({
			method: "GET",
			path: "/career/knowledge/review",
			tags: ["Career"],
			operationId: "getCareerKnowledgeReview",
			summary: "Get the last Knowledge review",
		})
		.input(z.object({}).optional())
		.output(knowledgeReviewSchema.nullable())
		.handler(({ context }) => knowledgeReview.get(context.user.id)),
	runReview: protectedProcedure
		.use(aiRequestRateLimit)
		.route({
			method: "POST",
			path: "/career/knowledge/review",
			tags: ["Career"],
			operationId: "runCareerKnowledgeReview",
			summary: "Review Knowledge with AI",
			description:
				"First removes application copies of shared facts, which needs no judgment. Then asks the default AI connection to flag facts that contradict each other, older figures a newer fact replaces, and claims with nothing to check them by, among the shared facts that reach the AI; private groups, switched-off and archived facts are never sent. Requests stay within the action budgets and time limit. Replaces the last review.",
		})
		.input(z.object({}).optional())
		.output(knowledgeReviewSchema)
		.handler(({ context, signal }) => knowledgeReview.run({ userId: context.user.id, ...(signal ? { signal } : {}) })),
	resolveFinding: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/knowledge/review/{id}",
			tags: ["Career"],
			operationId: "resolveCareerKnowledgeFinding",
			summary: "Mark a Knowledge review finding fixed or dismissed",
		})
		.input(id.extend({ resolved: z.enum(["fixed", "dismissed"]).nullable() }))
		.output(knowledgeReviewSchema)
		.handler(({ context, input }) => knowledgeReview.resolve(context.user.id, input)),
	factGroups: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts/groups",
			tags: ["Career"],
			operationId: "listCareerFactGroups",
			summary: "List career fact groups",
			description:
				"Every group that has facts or settings, and the facts in no group: how many are switched on and off, the size of the shared switched-on ones, and how each group was last switched. Groups are paths such as experience/acme; counts are per exact group, not including subgroups.",
		})
		.input(z.object({}).optional())
		.output(z.array(factGroupOutput))
		.handler(({ context }) => careerService.factGroups(context.user.id)),
	setFactGroupStatus: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/groups/status",
			tags: ["Career"],
			operationId: "setCareerFactGroupStatus",
			summary: "Switch a career fact group on or off",
			description:
				"Switches every fact in the group on or off, and every group under it unless subgroups is false. Facts added to the group later start the same way. The group goes in the body because its path can contain slashes.",
		})
		.input(
			z.object({
				group: factGroupSchema,
				status: factSwitchSchema,
				subgroups: z.boolean().default(true).describe("Include every group under this one."),
			}),
		)
		.output(updatedOutput)
		.handler(({ context, input }) => careerService.setFactGroupStatus(context.user.id, input)),
	saveFactGroup: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/facts/groups",
			tags: ["Career"],
			operationId: "saveCareerFactGroup",
			summary: "Make a career fact group private, or set how its new facts start",
			description:
				"private: a private group's facts, subgroups included, never reach the AI provider, whatever their own switches say, unless an application includes the group (see PUT /career/overrides). status: how facts added to the group later start, without switching any fact it already holds; subgroups with their own setting keep it. Give either or both.",
		})
		.input(
			z
				.object({
					group: factGroupSchema,
					private: z.boolean().optional(),
					status: factSwitchSchema
						.optional()
						.describe("How facts added to the group later start. Facts already in it don't change."),
				})
				.refine((input) => input.private !== undefined || input.status !== undefined, {
					message: "Give private, status or both.",
				}),
		)
		.output(z.object({ group: z.string(), private: z.boolean(), status: factSwitchSchema.nullable() }))
		.handler(({ context, input }) => careerService.saveFactGroup(context.user.id, input)),
	overrides: protectedProcedure
		.route({
			method: "GET",
			path: "/career/overrides",
			tags: ["Career"],
			operationId: "listCareerFactOverrides",
			summary: "List an application's Knowledge overrides",
			description: "The groups and facts this application includes or excludes on top of the global switches.",
		})
		.input(applicationInput)
		.output(z.array(careerFactOverrideSchema))
		.handler(({ context, input }) => careerService.overrides(context.user.id, input.applicationId)),
	saveOverride: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/overrides",
			tags: ["Career"],
			operationId: "saveCareerFactOverride",
			summary: "Include or exclude Knowledge for one application",
			description:
				"Includes a group (with its subgroups) or a fact for one application, even if it's switched off or private, or excludes one it would otherwise get. Nothing is copied. Give a group or a fact id, not both; a new choice for the same target replaces the old one. An override for a fact wins over one for its group.",
		})
		.input(
			applicationInput.extend({
				group: factGroupSchema.optional(),
				factId: z.string().min(1).optional(),
				mode: overrideModeSchema,
			}),
		)
		.output(careerFactOverrideSchema)
		.handler(({ context, input }) => careerService.saveOverride(context.user.id, input)),
	deleteOverride: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/overrides/{id}",
			tags: ["Career"],
			operationId: "deleteCareerFactOverride",
			summary: "Remove a Knowledge override",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteOverride(context.user.id, input.id)),
	correctFact: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/{id}/corrections",
			tags: ["Career"],
			operationId: "correctCareerFact",
			summary: "Atomically correct a fact's text, type or scope",
			description:
				"Requires the reviewed text, category and scope. Rejects changed or forgotten facts and unavailable application scopes without saving any correction.",
		})
		.input(careerFactCorrectionSchema)
		.output(z.void())
		.handler(async ({ context, input }) => {
			await careerService.updateFact(context.user.id, input);
		}),
	forgetFact: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/facts/{id}",
			tags: ["Career"],
			operationId: "forgetCareerFact",
			summary: "Forget a career fact",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.forgetFact(context.user.id, input.id)),
	stories: protectedProcedure
		.route({
			method: "GET",
			path: "/career/stories",
			tags: ["Career"],
			operationId: "listCareerStories",
			summary: "List career stories",
		})
		.input(careerScopeSchema)
		.output(z.array(careerStorySchema))
		.handler(({ context, input }) => careerService.stories({ userId: context.user.id, ...input })),
	saveStory: protectedProcedure
		.route({
			method: "POST",
			path: "/career/stories",
			tags: ["Career"],
			operationId: "saveCareerStory",
			summary: "Save a career story",
		})
		.input(careerStoryInputSchema.extend({ id: z.string().optional() }))
		.output(careerStorySchema)
		.handler(({ context, input: { id, ...input } }) => careerService.saveStory(context.user.id, input, id)),
	deleteStory: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/stories/{id}",
			tags: ["Career"],
			operationId: "deleteCareerStory",
			summary: "Delete a career story",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteStory(context.user.id, input.id)),
	savedItems: protectedProcedure
		.route({
			method: "GET",
			path: "/career/saved",
			tags: ["Career"],
			operationId: "listCareerSavedItems",
			summary: "List saved career work",
			description:
				"Lists all saved work by default, or one application. Use scope=shared without an applicationId for standalone practice attempts.",
		})
		.input(
			z
				.object({
					applicationId: z.string().min(1).optional(),
					scope: z.enum(["all", "shared"]).optional(),
					kind: z.enum(["fit", "briefing", "practice", "debrief", "answers", "reply", "offer"]).optional(),
				})
				.refine((input) => input.scope !== "shared" || !input.applicationId, {
					message: "Shared work has no application.",
					path: ["applicationId"],
				}),
		)
		.output(z.array(savedItemOutput))
		.handler(({ context, input }) =>
			careerService.savedItems({
				userId: context.user.id,
				...input,
				...(input.scope === "shared" ? { applicationId: null } : {}),
			}),
		),
	createOffer: protectedProcedure
		.route({
			method: "POST",
			path: "/career/offers",
			tags: ["Career"],
			operationId: "createCareerOffer",
			summary: "Save manually entered offer terms",
		})
		.input(careerOfferInputSchema)
		.output(savedItemSchema.nullable())
		.handler(({ context, input }) => careerService.createOffer(context.user.id, input)),
	updateOffer: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/offers/{id}",
			tags: ["Career"],
			operationId: "updateCareerOffer",
			summary: "Correct saved offer terms",
			description:
				"Corrects saved terms, or saves a new version when newVersion is true. `expected` is the copy being corrected; concurrent changes conflict. Supply the same newId and payload when retrying a new version after a lost response; a deleted version cannot be recreated by retrying.",
		})
		.input(
			id.extend({
				terms: offerTermsSchema,
				expected: offerTermsSchema,
				newVersion: z.boolean().optional(),
				newId: z.uuid().optional(),
			}),
		)
		.output(savedItemSchema)
		.handler(({ context, input }) =>
			careerService.updateOffer(context.user.id, input.id, input.terms, input.expected, input.newVersion, input.newId),
		),
	deleteSavedItem: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/saved/{id}",
			tags: ["Career"],
			operationId: "deleteCareerSavedItem",
			summary: "Delete saved career work",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteSavedItem(context.user.id, input.id)),
	generate: protectedProcedure
		.use(aiRequestRateLimit)
		.route({
			method: "POST",
			path: "/career/generate",
			tags: ["Career"],
			operationId: "generateCareerWork",
			summary: "Generate AI work for an application",
			description:
				"Asks the default AI connection for one structured piece of work for an application (fit check, briefing, practice feedback, debrief review, employer message, answer draft). Everything but answer drafts is saved. Practice with a shared story may use a null applicationId; other tasks require an application.",
		})
		.input(
			applicationInput
				.extend({
					applicationId: z.string().min(1).nullable(),
					locale: z.string().max(20).default("en-US"),
					task: generateTaskSchema,
				})
				.refine(
					(input) =>
						input.applicationId !== null ||
						(input.task.task === "practice" && Boolean(input.task.storyId) && !input.task.interviewId),
					{ message: "Choose an application, or a shared story to practice.", path: ["applicationId"] },
				),
		)
		.output(
			z.object({
				item: savedItemSchema.nullable(),
				answer: z
					.object({
						text: z.string(),
						factIds: z.array(z.string()),
						note: z.string().nullable().default(null),
						aiOperationIds: aiOperationIdsSchema.optional(),
					})
					.nullable(),
			}),
		)
		// The same request from a second tab joins the run in progress rather than paying for a second one.
		.handler(({ context, input, signal }) =>
			joinInFlight(JSON.stringify([context.user.id, input.applicationId, input.locale, input.task]), signal, (shared) =>
				generateCareer({ userId: context.user.id, ...input, signal: shared }),
			),
		),
	applyReply: protectedProcedure
		.route({
			method: "POST",
			path: "/career/saved/{id}/apply",
			tags: ["Career"],
			operationId: "applyCareerReply",
			summary: "Apply suggested changes from a message",
		})
		.input(
			id.extend({
				changes: z.array(z.number().int().min(0)).max(4),
				/** Present when the user confirmed "Mark as applied" inline, so the receipt and stage move commit together. */
				submission: z
					.object({
						answers: careerWorkspaceSchema.shape.answers,
						expectedAnswers: careerWorkspaceSchema.shape.answers,
						expectedDocuments: z.object({
							resumeId: z.string().nullable(),
							coverLetterId: z.string().nullable(),
						}),
					})
					.optional(),
			}),
		)
		.output(
			z.object({
				stages: savedStagesSchema.describe(
					"The stage this call saved, with its stage-write ID. Empty on repeats or when no stage changed.",
				),
			}),
		)
		.handler(({ context, input }) =>
			careerService.applyReply(context.user.id, input.id, input.changes, input.submission),
		),
	fitEvidence: protectedProcedure
		.route({
			method: "GET",
			path: "/career/fit-evidence/{applicationId}",
			tags: ["Career"],
			operationId: "getCareerFitEvidence",
			summary: "Check whether Fit has usable evidence",
		})
		.input(applicationInput)
		.output(z.object({ usable: z.boolean() }))
		.handler(async ({ context, input }) => ({
			usable: hasFitEvidence(await careerService.context({ userId: context.user.id, ...input })),
		})),

	undoReply: protectedProcedure
		.route({
			method: "POST",
			path: "/career/saved/{id}/undo",
			tags: ["Career"],
			operationId: "undoCareerReply",
			summary: "Undo changes applied from a message",
			description:
				"Restores the application fields the changes set and removes the offer they saved, while nothing has changed them since. Sent document versions stay recorded.",
		})
		.input(id)
		.output(z.object({ stages: savedStagesSchema }))
		.handler(({ context, input }) => careerService.undoReply(context.user.id, input.id)),
	workspace: protectedProcedure
		.route({
			method: "GET",
			path: "/career/workspace/{applicationId}",
			tags: ["Career"],
			operationId: "getCareerWorkspace",
			summary: "Get an application workspace",
		})
		.input(applicationInput)
		.output(careerWorkspaceSchema)
		.handler(({ context, input }) => careerService.workspace(context.user.id, input.applicationId)),
	saveWorkspace: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/workspace/{applicationId}",
			tags: ["Career"],
			operationId: "saveCareerWorkspace",
			summary: "Save an application workspace",
		})
		.input(
			applicationInput
				.extend(careerWorkspaceSchema.omit({ submissionReview: true }).partial().shape)
				.extend({ expected: careerWorkspaceSchema.omit({ submissionReview: true }).partial() }),
		)
		.output(careerWorkspaceSchema)
		.handler(({ context, input: { applicationId, expected, ...patch } }) =>
			careerService.saveWorkspace(context.user.id, applicationId, patch, expected),
		),
	deleteWorkspaceAnswer: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/workspace/{applicationId}/answers/{id}",
			tags: ["Career"],
			operationId: "deleteCareerWorkspaceAnswer",
			summary: "Remove one unchanged workspace answer",
			description:
				"Removes only the answer matching the supplied previous value. Other answers, workspace fields and submitted history remain unchanged. Repeating an already completed removal is safe.",
		})
		.input(
			applicationInput.extend({ id: z.string().min(1).max(64), expected: careerWorkspaceSchema.shape.answers.element }),
		)
		.output(careerWorkspaceSchema)
		.handler(({ context, input }) =>
			careerService.deleteWorkspaceAnswer(context.user.id, input.applicationId, input.id, input.expected),
		),
	submitApplication: protectedProcedure
		.route({
			method: "POST",
			path: "/career/workspace/{applicationId}/submit",
			tags: ["Career"],
			operationId: "submitCareerApplication",
			summary: "Mark an application as submitted",
		})
		.input(
			applicationInput.extend({
				answers: careerWorkspaceSchema.shape.answers,
				expectedAnswers: careerWorkspaceSchema.shape.answers,
				expectedDocuments: z
					.object({ resumeId: z.string().nullable(), coverLetterId: z.string().nullable() })
					.optional(),
			}),
		)
		.output(
			z.object({
				stages: savedStagesSchema.describe(
					"The stage this call saved on submission, with its stage-write ID. Empty on accepted retries.",
				),
			}),
		)
		.handler(({ context, input }) =>
			careerService.submitApplication(
				context.user.id,
				input.applicationId,
				input.answers,
				input.expectedAnswers,
				input.expectedDocuments,
			),
		),
	snapshotAnswers: protectedProcedure
		.route({
			method: "POST",
			path: "/career/workspace/{applicationId}/answers",
			tags: ["Career"],
			operationId: "snapshotCareerAnswers",
			summary: "Save the answers sent with an application",
			description:
				"Saves unchanged pre-submission answers as sent. Rejects later workspace edits; use submitCareerApplication to record answers and submission atomically.",
		})
		.input(applicationInput)
		.output(z.void())
		.handler(({ context, input }) => careerService.snapshotAnswers(context.user.id, input.applicationId)),
};
