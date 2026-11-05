import type { DbOrTx } from "@reactive-resume/db/client";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@reactive-resume/db/schema";
import { careerWorkspaceSchema, EMPTY_WORKSPACE } from "@reactive-resume/schema/career";

/**
 * Copies the workspace's written answers into Saved as an "Application answers" item: what was sent with it. Skips
 * when none are written or when the application already has one. Callers hold the application row in the same
 * transaction and decide when it was sent.
 */
export async function snapshotSentAnswers(client: DbOrTx, userId: string, applicationId: string): Promise<void> {
	const [existing] = await client
		.select({ id: schema.careerArtifact.id })
		.from(schema.careerArtifact)
		.where(
			and(
				eq(schema.careerArtifact.applicationId, applicationId),
				eq(schema.careerArtifact.userId, userId),
				sql`${schema.careerArtifact.data}->>'kind' = 'answers'`,
			),
		);
	if (existing) return;
	const [workspace] = await client
		.select({ data: schema.careerWorkspace.data })
		.from(schema.careerWorkspace)
		.where(and(eq(schema.careerWorkspace.applicationId, applicationId), eq(schema.careerWorkspace.userId, userId)));
	const answers = careerWorkspaceSchema
		.parse({ ...EMPTY_WORKSPACE, ...workspace?.data })
		.answers.filter((answer) => answer.answer.trim());
	if (!answers.length) return;
	await client.insert(schema.careerArtifact).values({
		userId,
		applicationId,
		interviewId: null,
		title: "Application answers",
		data: { kind: "answers", answers },
		evidence: { factIds: [...new Set(answers.flatMap((answer) => answer.factIds))], storyIds: [] },
		inputVersion: createHash("sha256").update(JSON.stringify(answers)).digest("hex"),
	});
}
