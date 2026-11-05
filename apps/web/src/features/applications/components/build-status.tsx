import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { useApplicationActions } from "../use-application-actions";

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

type BuildStatusControlProps = {
	application: Pick<Application, "id" | "role" | "company" | "targetingBuildStatus">;
	className?: string;
};

/**
 * Where building a targeted resume package stands:
 * - `null` or `"build"`: a checkbox labeled Build that queues or unqueues the application in one click.
 * - `"building"`, `"built"`, `"failed"`: a read-only status icon and label.
 */
export function BuildStatusControl({ application, className }: BuildStatusControlProps) {
	const { setBuildStatus } = useApplicationActions();
	const status = application.targetingBuildStatus;

	if (status === "building") {
		return (
			<span
				title={t`Resume build in progress`}
				className={cn("inline-flex items-center gap-1 text-[11px] font-medium text-warn-text", className)}
			>
				<Icon name="circle-notch" size={13} className="animate-spin" />
				<Trans>Building</Trans>
			</span>
		);
	}

	if (status === "built") {
		return (
			<span
				title={t`Resume package built`}
				className={cn(
					"inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400",
					className,
				)}
			>
				<Icon name="check-circle" filled size={13} />
				<Trans>Built</Trans>
			</span>
		);
	}

	if (status === "failed") {
		return (
			<span
				title={t`Resume build failed or stopped`}
				className={cn("inline-flex items-center gap-1 text-[11px] font-medium text-danger-text", className)}
			>
				<Icon name="x-circle" filled size={13} />
				<Trans>Failed</Trans>
			</span>
		);
	}

	const queued = status === "build";
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={queued}
			aria-label={t`Build resume for ${application.role} at ${application.company}`}
			title={queued ? t`Queued for build (click to unqueue)` : t`Queue for resume build`}
			data-slot="button"
			onClick={(event) => {
				stop(event);
				setBuildStatus(application, queued ? null : "build");
			}}
			onPointerDown={stop}
			className={cn(
				"group/build inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium select-none",
				queued ? "text-accent-text" : "text-ink-3 hover:text-ink",
				className,
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"grid size-[13px] shrink-0 place-items-center rounded-[3.5px] border-[1.5px] transition-colors duration-quick",
					queued ? "border-accent bg-accent text-on-accent" : "border-ink-3 group-hover/build:border-ink",
				)}
			>
				{queued && <Icon name="check" size={10} />}
			</span>
			<Trans>Build</Trans>
		</button>
	);
}
