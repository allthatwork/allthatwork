import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { m } from "motion/react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { PAGE_CLASS } from "@/components/layout/page";
import { D2, EASE } from "@/libs/motion";

export const Route = createFileRoute("/dashboard/career")({
	component: CareerLayout,
});

type Place = {
	to:
		| "/dashboard/career"
		| "/dashboard/career/coach/{-$conversationId}"
		| "/dashboard/career/knowledge/facts"
		| "/dashboard/career/offers";
	match: string;
	icon: IconName;
	label: string;
};

/** Career: Today, Coach, Knowledge and Offers under one header. The selected place's pill slides between them. */
function CareerLayout() {
	const matchRoute = useMatchRoute();
	const places: Place[] = [
		{ to: "/dashboard/career", match: "/dashboard/career/", icon: "tray", label: t`Today` },
		{
			to: "/dashboard/career/coach/{-$conversationId}",
			match: "/dashboard/career/coach",
			icon: "sparkle",
			label: t`Coach`,
		},
		{
			to: "/dashboard/career/knowledge/facts",
			match: "/dashboard/career/knowledge",
			icon: "books",
			label: t`Knowledge`,
		},
		{ to: "/dashboard/career/offers", match: "/dashboard/career/offers", icon: "scales", label: t`Offers` },
	];
	const current = places.find((place) => matchRoute({ to: place.match, fuzzy: place.match !== "/dashboard/career/" }));

	return (
		<div className={cn(PAGE_CLASS, "flex min-h-svh flex-col gap-6")}>
			<header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 [view-transition-name:career-header]">
				<div className="grid min-w-0 gap-1">
					<h1 className="font-display text-[30px] leading-9 font-medium">
						<Trans>Career</Trans>
					</h1>
					<p className="text-sm text-ink-2">
						<Trans>Plan your search, keep your evidence in one place, and decide between offers.</Trans>
					</p>
				</div>
				<nav
					aria-label={t`Career`}
					className="-mx-4 flex max-w-[100vw] [scrollbar-width:none] overflow-x-auto px-4 sm:mx-0 sm:px-0"
				>
					<div className="flex shrink-0 gap-0.5 rounded-[9px] bg-sunken p-[3px]">
						{places.map((place) => {
							const selected = place === current;
							return (
								<Link
									key={place.to}
									to={place.to}
									aria-current={selected ? "page" : undefined}
									className={cn(
										"touch-target relative flex h-[30px] items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium transition-colors duration-quick",
										selected ? "text-ink" : "text-ink-2 hover:text-ink",
									)}
								>
									{selected && (
										<m.span
											layoutId="career-place"
											transition={{ duration: D2, ease: EASE }}
											className="absolute inset-0 rounded-sm bg-raised shadow-e1"
										/>
									)}
									<Icon name={place.icon} size={18} className="relative" />
									<span className="relative">{place.label}</span>
								</Link>
							);
						})}
					</div>
				</nav>
			</header>
			<Outlet />
		</div>
	);
}
