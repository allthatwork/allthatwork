import { BudgetMeter } from "./budget";
import { KnowledgeFrame } from "./frame";
import { GroupsCard } from "./groups";
import { ReviewCard } from "./review";
import { DuplicatesCard, StoriesCard } from "./upkeep";

/** Curate: what the AI sees of your Knowledge, and the upkeep that keeps it right. */
export function CuratePage() {
	return (
		<KnowledgeFrame current="curate">
			<div className="flex flex-col">
				<BudgetMeter showSettingsLink />
				<GroupsCard />
				<StoriesCard />
				<DuplicatesCard />
				<ReviewCard />
			</div>
		</KnowledgeFrame>
	);
}
