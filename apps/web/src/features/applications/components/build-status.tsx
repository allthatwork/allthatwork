import type { ApplicationSummary } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { useApplicationActions } from "../use-application-actions";

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

type BuildStatusControlProps = {
	application: Pick<ApplicationSummary, "id" | "role" | "company" | "targetingBuildStatus">;
	/** `compact` (the default) for list cells and board cards; `default` beside other values, as Calm's 18px checkbox. */
	size?: "compact" | "default";
	className?: string;
};

/**
 * Where building a targeted resume package stands:
 * - `null` or `"build"`: a checkbox labeled Build that queues or unqueues the application in one click.
 * - `"building"`, `"built"`, `"failed"`: a read-only status icon and label.
 */
export function BuildStatusControl({ application, size = "compact", className }: BuildStatusControlProps) {
	const { setBuildStatus } = useApplicationActions();
	const status = application.targetingBuildStatus;
	const compact = size === "compact";
	// Compact is the caption size of badges; the default reads like the values around it.
	const text = compact ? "gap-1 text-xs font-medium" : "gap-1.5 text-sm/5";
	const iconSize = compact ? 14 : 16;

	if (status === "building") {
		return (
			<span
				title={t`Resume build in progress`}
				className={cn("inline-flex items-center", text, "text-warn-text", className)}
			>
				<Icon name="circle-notch" size={iconSize} className="animate-spin" />
				<Trans>Building</Trans>
			</span>
		);
	}

	if (status === "built") {
		return (
			<span
				title={t`Resume package built`}
				className={cn("inline-flex items-center", text, "text-success-text", className)}
			>
				<Icon name="check-circle" filled size={iconSize} />
				<Trans>Built</Trans>
			</span>
		);
	}

	if (status === "failed") {
		return (
			<span
				title={t`Resume build failed or stopped`}
				className={cn("inline-flex items-center", text, "text-danger-text", className)}
			>
				<Icon name="x-circle" filled size={iconSize} />
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
				"group/build relative inline-flex cursor-pointer items-center select-none",
				compact ? "gap-1.5 text-xs font-medium" : "touch-target gap-2 text-sm/5",
				queued
					? compact
						? "text-accent-text"
						: "text-ink"
					: compact
						? "text-ink-3 hover:text-ink"
						: "text-ink-2 hover:text-ink",
				className,
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"grid shrink-0 place-items-center border-[1.5px] transition-colors duration-quick",
					compact ? "size-3.5 rounded-[5px]" : "size-[18px] rounded-xs",
					queued
						? "border-accent bg-accent text-on-accent"
						: "border-control-border bg-raised group-hover/build:border-ink-2",
				)}
			>
				{queued && <Icon name="check" size={compact ? 10 : 13} />}
			</span>
			<Trans>Build</Trans>
		</button>
	);
}
