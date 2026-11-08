import { aiRouter } from "./ai";
import { crudRouter } from "./crud";
import { viewsRouter } from "./views";

export const applicationsRouter = {
	list: crudRouter.list,
	getById: crudRouter.getById,
	create: crudRouter.create,
	import: crudRouter.import,
	update: crudRouter.update,
	attachDocument: crudRouter.attachDocument,
	removeDocument: crudRouter.removeDocument,
	updateQuestion: crudRouter.updateQuestion,
	addNote: crudRouter.addNote,
	addInterview: crudRouter.addInterview,
	updateInterview: crudRouter.updateInterview,
	updateTimelineEntry: crudRouter.updateTimelineEntry,
	deleteTimelineEntry: crudRouter.deleteTimelineEntry,
	delete: crudRouter.delete,
	bulkUpdate: crudRouter.bulkUpdate,
	bulkDelete: crudRouter.bulkDelete,
	stats: crudRouter.stats,
	tags: crudRouter.tags,
	ai: aiRouter,
	views: viewsRouter,
};
