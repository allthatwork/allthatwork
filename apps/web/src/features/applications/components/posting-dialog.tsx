import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { postingReadReceipt } from "@reactive-resume/schema/applications/posting-source";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { Chip } from "@/components/calm/filter-bar";
import { useNow } from "@/features/career/shared";

type ViewPostingButtonProps = { application: Application; size?: "default" | "sm"; className?: string };

/**
 * "View posting": opens the saved posting in a dialog, or the posting's page when only a link was saved. Renders
 * nothing when there is neither. The detail sheet and the workspace header both use it, so they behave the same.
 */
export function ViewPostingButton({ application, size = "default", className }: ViewPostingButtonProps) {
	const [open, setOpen] = useState(false);
	if (!application.sourceUrl && !application.jobDescription) return null;

	if (application.sourceUrl && !application.jobDescription) {
		return (
			<a
				href={application.sourceUrl}
				target="_blank"
				rel="noreferrer"
				className={cn(buttonVariants({ variant: "secondary", size }), className)}
			>
				<Icon name="file-text" size={size === "sm" ? 16 : 18} />
				<Trans>View posting</Trans>
				<Icon name="arrow-square-out" size={14} className="text-ink-3" />
			</a>
		);
	}

	return (
		<>
			<Button variant="secondary" size={size} className={className} onClick={() => setOpen(true)}>
				<Icon name="file-text" size={size === "sm" ? 16 : 18} />
				<Trans>View posting</Trans>
			</Button>
			<PostingDialog application={application} open={open} onOpenChange={setOpen} />
		</>
	);
}

type PostingDialogProps = { application: Application; open: boolean; onOpenChange: (open: boolean) => void };

/** The saved posting: its link, what it asks for, and its text. */
function PostingDialog({ application, open, onOpenChange }: PostingDialogProps) {
	const now = useNow();
	const { i18n } = useLingui();
	const receipt = postingReadReceipt(application.postingSource, i18n.locale, now.getTime());
	const readAt = receipt?.readAt;
	const sourceHost = receipt?.sourceHost ?? t`the posting page`;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent closeLabel={t`Close`} className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{application.role} · {application.company}
					</DialogTitle>
					<DialogDescription>
						{application.sourceUrl ? (
							<a
								href={application.sourceUrl}
								target="_blank"
								rel="noreferrer"
								className="text-accent-text hover:underline"
							>
								{application.sourceUrl}
							</a>
						) : (
							<Trans>The posting saved with this application.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>
				{application.postingSource && (
					<p className="text-xs text-ink-3">
						{application.postingSource.method === "paste" ? (
							<Trans>Pasted description</Trans>
						) : readAt ? (
							<Trans>
								Read {readAt} from {sourceHost}. The employer may have changed it since.
							</Trans>
						) : (
							<Trans>The employer may have changed it since.</Trans>
						)}
					</p>
				)}
				{(application.postingSource?.truncated || application.postingSource?.completeness === "incomplete") && (
					<p className="text-xs text-warn-text" role="alert">
						<Trans>This saved description is clipped or incomplete. Review before preparing documents.</Trans>
					</p>
				)}
				{application.requirements.length > 0 && (
					<section aria-labelledby="posting-requirements" className="grid gap-2">
						<h3 id="posting-requirements" className="text-[13px]/[18px] font-medium text-ink-2">
							<Trans>What it asks for</Trans>
						</h3>
						<ul className="flex flex-wrap gap-1.5">
							{application.requirements.map((requirement) => (
								<Chip
									key={requirement}
									variant="ctx"
									render={<li />}
									className="h-auto min-h-[26px] max-w-full shrink py-1 whitespace-normal"
								>
									{requirement}
								</Chip>
							))}
						</ul>
					</section>
				)}
				{application.jobDescription && (
					<p className="text-sm leading-6 whitespace-pre-wrap text-ink-2">{application.jobDescription}</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
