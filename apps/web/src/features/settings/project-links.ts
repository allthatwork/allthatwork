import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { APP_REPOSITORY_URL } from "@reactive-resume/utils/brand";

const githubUrl = APP_REPOSITORY_URL;

/**
 * The project's own pages, under Settings on desktop and as rows on the phone's Settings root: the fork's own links
 * (where to read up, see the code, report a problem), then the project it's built on. No donation link (FORK.md).
 */
export const getProjectLinks = (): { href: string; label: string; icon: IconName }[] => [
	{ href: `${githubUrl}/tree/main/docs`, label: t`Docs`, icon: "book-open" },
	{ href: githubUrl, label: t`Source`, icon: "code" },
	{ href: `${githubUrl}/issues`, label: t`Report a bug`, icon: "bug" },
	{
		href: "https://github.com/reactive-resume/reactive-resume",
		label: t`Evolved from Reactive Resume`,
		icon: "git-merge",
	},
];
