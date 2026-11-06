import { protectedProcedure } from "../../context";
import { boardsDto } from "../../dto/boards";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { boardsService } from "./service";

const tags = ["Job boards"];

export const boardsRouter = {
	company: protectedProcedure
		.route({
			method: "GET",
			path: "/directory/companies/{companyId}/boards",
			tags,
			operationId: "companyJobBoards",
			summary: "List a company's job boards",
			description:
				"The Greenhouse, Ashby and Lever boards this account watches for a Directory company, and boards its applications' posting links point at that aren't watched yet.",
		})
		.input(boardsDto.company.input)
		.output(boardsDto.company.output)
		.handler(({ input, context }) => boardsService.company(context.user.id, input.companyId)),
	fromLink: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/companies/{companyId}/boards/from-link",
			tags,
			operationId: "jobBoardsFromLink",
			summary: "Find job boards from a careers link",
			description:
				"Reads a pasted board, posting or careers page link and returns the boards it points at, each read once to show its name and open roles. A link that leads to no Greenhouse, Ashby or Lever board, or that can't be opened, is saved as the company's jobs link (careersUrl) instead, which can't be watched.",
		})
		.input(boardsDto.fromLink.input)
		.output(boardsDto.fromLink.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => boardsService.fromLink(context.user.id, input.companyId, input.link)),
	guess: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/companies/{companyId}/boards/guess",
			tags,
			operationId: "guessJobBoards",
			summary: "Guess a company's job board",
			description:
				"Tries board names made from the company's name on Greenhouse, Ashby and Lever. A guess can land on an unrelated company's board, so confirm one before watching it. Nothing is saved.",
		})
		.input(boardsDto.guess.input)
		.output(boardsDto.guess.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => boardsService.guess(context.user.id, input.companyId)),
	watch: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/companies/{companyId}/boards",
			tags,
			operationId: "watchJobBoard",
			summary: "Watch a company's job board",
			description:
				"Confirms a board for a company. Its open roles that pass the Preferences screen land in New roles once; after that, board checks bring only roles first seen later. The company's saved jobs link (careersUrl) is cleared.",
		})
		.input(boardsDto.watch.input)
		.output(boardsDto.watch.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => boardsService.watch(context.user.id, input)),
	unwatch: protectedProcedure
		.route({
			method: "DELETE",
			path: "/directory/boards/{id}",
			tags,
			operationId: "unwatchJobBoard",
			summary: "Stop watching a job board",
		})
		.input(boardsDto.unwatch.input)
		.output(boardsDto.unwatch.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => boardsService.unwatch(context.user.id, input.id)),
	suggestions: protectedProcedure
		.route({
			method: "GET",
			path: "/directory/boards/suggestions",
			tags,
			operationId: "jobBoardSuggestions",
			summary: "Companies worth watching",
			description:
				"Companies with contacts and no watched board, most contacts first. Where a posting link on file names the board, its matching open roles are counted.",
		})
		.input(boardsDto.suggestions.input)
		.output(boardsDto.suggestions.output)
		.handler(({ context }) => boardsService.suggestions(context.user.id)),
};
