import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth";
import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { accountAuth, auth } from "@reactive-resume/auth/config";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { applicationProfileRecordSchema } from "@reactive-resume/schema/application-profile";
import { applicationPipelineSchema } from "@reactive-resume/schema/applications/lanes";
import { applicationViewSchema } from "@reactive-resume/schema/applications/views";
import { boardPaySchema } from "@reactive-resume/schema/boards";
import {
	aiLimitsSchema,
	careerProfileDataSchema,
	careerWorkspaceDataSchema,
	discoverySourceSchema,
	knowledgeReviewSchema,
	submissionReviewSchema,
} from "@reactive-resume/schema/career";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { accountBackupLimits, accountUploadSkipReasons } from "@reactive-resume/utils/account-zip";
import { APP_NAME } from "@reactive-resume/utils/brand";
import { localeSchema } from "@reactive-resume/utils/locale";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import { protectedProcedure, publicProcedure } from "../../context";
import { accountImportDto } from "../../dto/account-import";
import { applicationDto } from "../../dto/application";
import {
	savedItemSchema,
	reviewedAnswerSchema,
	careerFactSchema,
	careerNotificationSchema,
	careerScheduleSchema,
	careerStorySchema,
} from "../../dto/career";
import { directoryDto } from "../../dto/directory";
import { resumeDto } from "../../dto/resume";
import { accountRateLimit } from "../../middleware/rate-limit";
import { accountImportService } from "../account-import/service";
import { authService } from "./service";

const accountProcedure = protectedProcedure.use(accountRateLimit).use(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof APIError && error.statusCode < 500) {
			throw new ORPCError(error.body?.code ?? "BAD_REQUEST", {
				status: error.statusCode,
				message: error.message,
				cause: error,
			});
		}
		throw error;
	}
});

// Sessions last a week; a key that never expires, or deleting the account, needs a sign-in from the last day.
const RECENT_SIGN_IN_MS = 24 * 60 * 60 * 1000;

async function assertRecentSignIn(headers: Headers | undefined) {
	const session = headers ? await auth.api.getSession({ headers, query: { disableCookieCache: true } }) : null;
	const signedInAt = session ? new Date(session.session.createdAt).getTime() : 0;
	if (Date.now() - signedInAt > RECENT_SIGN_IN_MS)
		throw new ORPCError("FORBIDDEN", { message: "For your security, sign out and sign in again, then try again." });
}

export const authRouter = {
	getProfile: accountProcedure
		.route({
			method: "GET",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "getProfile",
			summary: "Get your profile",
			description:
				"Returns only the authenticated user's profile, timezone and interface language (null until an app reports one). No secrets are included.",
		})
		.input(z.object({}).optional())
		.output(
			createSelectSchema(schema.user)
				.pick({
					id: true,
					name: true,
					username: true,
					displayUsername: true,
					image: true,
					email: true,
					emailVerified: true,
					timezone: true,
				})
				.extend({ locale: localeSchema.nullable() }),
		)
		.handler(({ context }) => authService.getProfile(context.user.id)),

	updateProfile: accountProcedure
		.route({
			method: "PATCH",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "updateProfile",
			summary: "Update your profile",
			description:
				"Updates only the authenticated user's name, username, image, timezone, or interface language. The language picks the language of account emails. Usernames must be unique.",
		})
		.input(
			z.object({
				name: z.string().trim().min(1).max(64).optional(),
				username: z
					.string()
					.trim()
					.min(3)
					.max(64)
					.regex(/^[a-z0-9._-]+$/)
					.optional(),
				image: z.url().nullable().optional(),
				timezone: timezoneSchema.optional(),
				locale: localeSchema.optional(),
			}),
		)
		.output(z.object({ status: z.boolean() }))
		.handler(({ context, input }) =>
			accountAuth.updateProfile(context.user, {
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.username !== undefined ? { username: input.username } : {}),
				...(input.image !== undefined ? { image: input.image } : {}),
				...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
				...(input.locale !== undefined ? { locale: input.locale } : {}),
			}),
		),

	apiKeys: {
		list: accountProcedure
			.route({
				method: "GET",
				path: "/auth/api-keys",
				tags: ["Authentication"],
				operationId: "listApiKeys",
				summary: "List your API keys",
				description: "Lists only the authenticated user's API-key metadata. Key secrets are never returned.",
			})
			.input(z.object({}).optional())
			.output(
				z.object({
					apiKeys: z.array(
						createSelectSchema(schema.apikey)
							.pick({
								id: true,
								name: true,
								start: true,
								prefix: true,
								enabled: true,
								createdAt: true,
								updatedAt: true,
								expiresAt: true,
								lastRequest: true,
							})
							.extend({ permissions: z.record(z.string(), z.array(z.string())).nullable() }),
					),
					total: z.number(),
				}),
			)
			.handler(({ context }) => accountAuth.listApiKeys(context.user)),

		delete: accountProcedure
			.route({
				method: "DELETE",
				path: "/auth/api-keys/{keyId}",
				tags: ["Authentication"],
				operationId: "deleteApiKey",
				summary: "Delete your API key",
				description: "Revokes an API key belonging to the authenticated user.",
			})
			.input(z.object({ keyId: z.string().min(1) }))
			.output(z.object({ success: z.boolean() }))
			.handler(({ context, input }) => accountAuth.deleteApiKey(context.user, input.keyId)),
	},

	connections: {
		list: accountProcedure
			.route({
				method: "GET",
				path: "/auth/connections",
				tags: ["Authentication"],
				operationId: "listConnectedApplications",
				summary: "List connected applications",
				description:
					"Lists the applications you allowed through OAuth, newest first, with their registered names and granted scopes.",
			})
			.input(z.object({}).optional())
			.output(
				z.object({
					connections: z.array(
						z.object({
							id: z.string(),
							clientId: z.string(),
							clientName: z.string().nullable(),
							scopes: z.array(z.string()),
							createdAt: z.date().nullable(),
						}),
					),
				}),
			)
			.handler(async ({ context }) => ({ connections: await accountAuth.listConnections(context.user) })),

		delete: accountProcedure
			.route({
				method: "DELETE",
				path: "/auth/connections/{id}",
				tags: ["Authentication"],
				operationId: "deleteConnectedApplication",
				summary: "Disconnect an application",
				description:
					"Disconnects an application you allowed through OAuth. Its tokens stop working at once; to use it again, connect it from the application.",
			})
			.input(z.object({ id: z.string().min(1) }))
			.output(z.object({ success: z.boolean() }))
			.handler(async ({ context, input }) => {
				if (!(await accountAuth.revokeConnection(context.user, input.id)))
					throw new ORPCError("NOT_FOUND", { message: "No connected application with that ID." });
				return { success: true };
			}),
	},

	providers: {
		list: publicProcedure
			.route({
				method: "GET",
				path: "/auth/providers",
				tags: ["Authentication"],
				operationId: "listAuthProviders",
				summary: "List authentication providers",
				description: `Returns a list of all authentication providers enabled on this ${APP_NAME} instance, along with their display names. Possible providers include password-based credentials, Apple, Google, GitHub, LinkedIn, and custom OAuth. No authentication required.`,
				successDescription: "A map of enabled authentication provider identifiers to their display names.",
			})
			.input(z.object({}).optional())
			.output(
				z.partialRecord(
					z.enum(["credential", "passkey", "apple", "google", "github", "linkedin", "custom"]),
					z.string(),
				),
			)
			.handler(() => authService.providers.list()),
	},

	createApiKey: protectedProcedure
		.route({
			method: "POST",
			path: "/auth/api-keys",
			tags: ["Authentication"],
			operationId: "createScopedApiKey",
			summary: "Create an API key",
			description:
				"Create a read-only or full-access API key. Requires a browser session; keys and OAuth tokens cannot create credentials.",
		})
		.input(
			z.object({
				name: z.string().trim().min(1).max(64),
				expiresIn: z.number().int().positive().nullable(),
				access: z.enum(["read", "full"]),
			}),
		)
		.output(z.object({ key: z.string() }))
		.handler(async ({ context, input }) => {
			if (context.authentication?.method !== "session")
				throw new ORPCError("FORBIDDEN", { message: "Create API keys from Settings in a web browser." });
			await assertRecentSignIn(context.reqHeaders);
			const result = await auth.api.createApiKey({
				body: {
					userId: context.user.id,
					name: input.name,
					expiresIn: input.expiresIn,
					permissions: { api: input.access === "read" ? ["read"] : ["read", "write", "delete"] },
				},
			});
			return { key: result.key };
		}),

	setPassword: accountProcedure
		.route({
			// Session only: keys and OAuth tokens can't add a password.
			spec: (operation) => ({ ...operation, security: [{ cookieAuth: [] }] }),
			method: "POST",
			path: "/auth/password",
			tags: ["Authentication"],
			operationId: "setPassword",
			summary: "Set a password",
			description:
				"Adds a password to an account that signs in another way (a social account or passkey). Unlike a password reset, it keeps other devices signed in and keeps API keys, passkeys and connected apps. Requires a recent browser session.",
		})
		.input(z.object({ newPassword: z.string().min(8).max(64) }))
		.output(z.void())
		.handler(async ({ context, input }) => {
			if (context.authentication?.method !== "session")
				throw new ORPCError("FORBIDDEN", { message: "Set a password from Settings in a web browser." });
			if (env.FLAG_DISABLE_EMAIL_AUTH)
				throw new ORPCError("FORBIDDEN", { message: "Password sign-in is turned off on this server." });
			await assertRecentSignIn(context.reqHeaders);
			await auth.api.setPassword({
				body: { newPassword: input.newPassword },
				headers: context.reqHeaders ?? new Headers(),
			});
		}),

	exportData: protectedProcedure
		.use(accountRateLimit)
		.route({
			method: "GET",
			path: "/auth/account/export",
			tags: ["Authentication"],
			operationId: "exportAccountData",
			summary: "Export user account data",
			description:
				"Returns the authenticated user's profile, documents and version histories, applications, Career records and feedback. Set includeUploads to include bounded base64 bytes for files referenced by exported records, with explicit omissions; external URLs are not fetched. Secrets such as password hashes, tokens and API keys are never included.",
			successDescription: "The user's exported account data.",
		})
		.input(z.object({ includeUploads: z.union([z.boolean(), z.literal("")]).optional() }).optional())
		.output(
			z.object({
				exportedAt: z.string(),
				uploads: z
					.object({
						files: z
							.array(
								z.object({ key: z.string(), base64: z.string().max(Math.ceil(accountBackupLimits.fileBytes / 3) * 4) }),
							)
							.max(accountBackupLimits.files),
						skipped: z.array(z.object({ key: z.string(), reason: z.enum(accountUploadSkipReasons) })),
					})
					.optional(),
				applicationProfile: applicationProfileRecordSchema.nullable().optional(),
				user: createSelectSchema(schema.user)
					.pick({
						id: true,
						name: true,
						email: true,
						username: true,
						displayUsername: true,
						image: true,
						timezone: true,
						locale: true,
						resumePages: true,
						noReplyDays: true,
						interviewReminders: true,
						emailVerified: true,
						createdAt: true,
						updatedAt: true,
					})
					.extend({
						applicationsLayout: z
							.record(z.string(), z.unknown())
							.nullable()
							.describe("How the Applications screen is laid out: List columns, Board column width and sort."),
					}),
				resumes: z.array(
					resumeDto.getById.output
						.omit({ hasPassword: true, applicationId: true })
						.extend({ slugChosen: z.boolean().describe("The owner chose the public address.") }),
				),
				coverLetters: z.array(coverLetterSchema),
				documentVersions: z
					.object({
						// Preserve historical JSON verbatim; current document parsing can normalize old snapshots.
						resumes: z.array(
							createSelectSchema(schema.resumeVersion, { data: z.record(z.string(), z.unknown()) }).omit({
								userId: true,
							}),
						),
						letters: z.array(
							createSelectSchema(schema.coverLetterVersion, { data: z.record(z.string(), z.unknown()) }).omit({
								userId: true,
							}),
						),
					})
					.optional(),
				applications: z.array(
					applicationDto.getById.output.extend({
						submittedAt: z
							.date()
							.nullable()
							.describe(
								"First recorded submission time, retained after later stage changes; null when no submission is recorded.",
							),
					}),
				),
				applicationViews: z
					.array(applicationViewSchema)
					.describe("Saved views of the Applications screen: filters, sort and List columns."),
				directory: z.object({
					companies: z.array(directoryDto.company.output.shape.company),
					contacts: directoryDto.contacts.output,
					employment: directoryDto.contact.output.shape.employment,
					notes: directoryDto.contact.output.shape.notes,
					boards: z
						.array(
							z.object({
								companyId: z.string(),
								ats: z.string(),
								region: z.string(),
								slug: z.string(),
								source: z.string(),
								confirmedAt: z.coerce.date(),
							}),
						)
						.describe("Job boards watched for Directory companies."),
				}),
				applicationPipeline: applicationPipelineSchema,
				aiContentReports: z.array(createSelectSchema(schema.aiContentReport)),
				career: z.object({
					aiRequests: z.array(createSelectSchema(schema.aiRequest).omit({ userId: true })).optional(),
					writingReviews: z
						.array(
							createSelectSchema(schema.resumeWritingReview, {
								passages: z.array(z.object({ id: z.string(), where: z.string(), text: z.string() })).nullable(),
								review: z.record(z.string(), z.unknown()).nullable(),
							}).omit({ userId: true, requestGeneration: true }),
						)
						.optional(),
					profile: careerProfileDataSchema,
					aiLimits: aiLimitsSchema.partial().nullable().describe("Settings → AI limits; null uses the defaults."),
					reviewedAnswers: z.array(reviewedAnswerSchema),
					facts: z.array(careerFactSchema.omit({ usedBy: true, company: true })),
					stories: z.array(careerStorySchema),
					artifacts: z.array(savedItemSchema),
					schedules: z.array(careerScheduleSchema),
					notifications: z.array(careerNotificationSchema),
					threads: z.array(createSelectSchema(schema.agentThread)),
					messages: z.array(
						createSelectSchema(schema.agentMessage, {
							// Preserve historical SDK/tool message fields in their original export form.
							uiMessage: z.record(z.string(), z.unknown()),
						}),
					),
					attachments: z.array(createSelectSchema(schema.agentAttachment)),
					opportunities: z.array(
						createSelectSchema(schema.careerOpportunity, {
							pay: z.array(boardPaySchema),
							discoverySource: discoverySourceSchema.nullable(),
						}),
					),
					jobs: z.array(createSelectSchema(schema.careerJob)),
					transcripts: z.array(createSelectSchema(schema.careerTranscript)),
					workspaces: z.array(
						createSelectSchema(schema.careerWorkspace, {
							data: careerWorkspaceDataSchema,
							submissionReview: submissionReviewSchema.nullable(),
						}),
					),
					factGroups: z.array(createSelectSchema(schema.careerFactGroup)),
					factOverrides: z.array(createSelectSchema(schema.careerFactOverride)),
					review: knowledgeReviewSchema.nullable(),
				}),
				feedback: z
					.object({
						links: z.array(
							createSelectSchema(schema.feedbackLink, { snapshot: z.record(z.string(), z.unknown()) }).omit({
								userId: true,
							}),
						),
						comments: z.array(createSelectSchema(schema.feedbackComment).omit({ userId: true })),
						events: z.array(createSelectSchema(schema.feedbackEvent).omit({ userId: true })),
					})
					.optional(),
			}),
		)
		.handler(({ context, input, signal }) => {
			const bindings = [context.reqHeaders.get("x-account-id"), context.rpcItemAccountId];
			if (bindings.some((id) => id && id !== context.user.id))
				throw new ORPCError("CONFLICT", { message: "This export belongs to another account. Reload and try again." });
			return authService.exportData({
				userId: context.user.id,
				includeUploads: input?.includeUploads === true,
				signal,
			});
		}),

	importPreview: protectedProcedure
		.use(accountRateLimit)
		.route({
			method: "GET",
			path: "/auth/account/imports/preview",
			tags: ["Authentication"],
			operationId: "previewAccountImport",
			summary: "Count what an account import could replace",
			description:
				"Returns how many records the authenticated user has in each import area, so a client can say what replacing an area deletes. Requires authentication.",
			successDescription: "Counts per import area.",
		})
		.input(z.object({}).optional())
		.output(accountImportDto.preview.output)
		.handler(({ context }) => accountImportService.preview(context.user.id)),

	importData: protectedProcedure
		.use(accountRateLimit)
		.route({
			method: "POST",
			path: "/auth/account/imports",
			tags: ["Authentication"],
			operationId: "importAccountData",
			summary: "Import one area of an account export",
			description:
				'Imports one area (documents, applications, knowledge, jobSearch, coach or settings) of an "Export everything" archive from Reactive Resume or All That Work into the authenticated account. Send the areas in that order and pass the ids each one returns to the next. Records get new ids; public resumes come in private; schedules come in switched off. In replace mode the area\'s existing records are deleted first, in the same transaction. Requires authentication.',
			successDescription: "What was added and skipped, and the new ids.",
		})
		.input(accountImportDto.run.input)
		.output(accountImportDto.run.output)
		.handler(({ context, input }) => accountImportService.run(context.user.id, input)),

	deleteAccount: protectedProcedure
		.route({
			spec: (operation) => ({ ...operation, security: [{ cookieAuth: [] }] }),
			method: "DELETE",
			path: "/auth/account",
			tags: ["Authentication"],
			operationId: "deleteAccount",
			summary: "Delete user account",
			description:
				"Permanently deletes the authenticated user's account, including all resumes, uploaded files (profile pictures, screenshots, PDFs), and associated data. This action is irreversible. Requires a browser session; keys and OAuth tokens cannot delete accounts.",
			successDescription: "The user account and all associated data have been successfully deleted.",
		})
		.input(z.object({}).optional())
		.output(z.void())
		.handler(async ({ context }) => {
			if (context.authentication?.method !== "session")
				throw new ORPCError("FORBIDDEN", { message: "Delete your account from Settings in a web browser." });
			await assertRecentSignIn(context.reqHeaders);
			await authService.deleteAccount({ userId: context.user.id });
		}),
};
