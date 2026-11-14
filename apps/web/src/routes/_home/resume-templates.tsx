import { createFileRoute } from "@tanstack/react-router";
import { TemplateGallery } from "@/features/templates/gallery";
import { getTemplatesMeta } from "@/libs/seo";

export const Route = createFileRoute("/_home/resume-templates")({
	component: TemplateGallery,
	head: () => {
		const { title, description } = getTemplatesMeta();
		return { meta: [{ title }, { name: "description", content: description }] };
	},
});
