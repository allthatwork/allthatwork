import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import type { ReactNode, Ref } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { Sheet, SheetContent, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { cn } from "@reactive-resume/utils/style";
import { VIEWS_LABEL_ATTRIBUTE } from "../../use-tab-labels";

/** The value the menu's radio uses for All applications; view ids never look like it. */
const ALL = "__all__";

export type ViewsMenuProps = {
	views: readonly ApplicationView[];
	/** The view that's on, or null for All applications. */
	active: ApplicationView | null;
	/** The screen differs from the view that's on. */
	edited: boolean;
	/** How many applications a view's filters match now; null is All applications. */
	countOf: (view: ApplicationView | null) => number;
	/** Picks a view, or All applications (null), which leaves the view. */
	onPick: (view: ApplicationView | null) => void;
	onUpdate: () => void;
	onDiscard: () => void;
	onSaveNew: () => void;
	onManage: () => void;
};

type ViewsButtonProps = ViewsMenuProps & {
	phone: boolean;
	/** The button's outer box, for the title row's measuring. */
	ref?: Ref<HTMLSpanElement>;
};

type MenuItemsProps = ViewsMenuProps & { large?: boolean; close: () => void };

/** All applications and the views as radio rows, with counts and the default's star. */
function ViewChoices({ views, active, countOf, onPick, large = false, close }: MenuItemsProps) {
	const row = (value: string, name: string, count: number, isDefault: boolean) => (
		// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the radio inside the label is the control
		<label
			key={value}
			className={cn(
				"flex cursor-pointer items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-hover",
				large ? "py-2.5 text-[15px]" : "py-1.5",
			)}
		>
			<RadioGroupItem value={value} />
			<span className="flex min-w-0 items-center gap-1.5">
				<span className="truncate">{name}</span>
				{isDefault && (
					<span title={t`A new tab opens with this view`} className="inline-flex shrink-0 text-warn-text">
						<Icon name="star" filled size={13} />
					</span>
				)}
			</span>
			<span className="ms-auto shrink-0 font-mono text-xs text-ink-3 tabular-nums">{count}</span>
		</label>
	);

	return (
		<RadioGroup
			aria-label={t`Views`}
			value={active?.id ?? ALL}
			onValueChange={(value) => {
				onPick(views.find((view) => view.id === value) ?? null);
				close();
			}}
			className="gap-0"
		>
			{row(ALL, t`All applications`, countOf(null), false)}
			{views.map((view) => row(view.id, view.name, countOf(view), view.isDefault))}
		</RadioGroup>
	);
}

type ActionProps = {
	icon: "check" | "arrow-counter-clockwise" | "plus" | "sliders-horizontal";
	strong?: boolean;
	large?: boolean;
	onClick: () => void;
	children: ReactNode;
};

function Action({ icon, strong = false, large = false, onClick, children }: ActionProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-md px-2 text-start transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent",
				large ? "py-2.5 text-[15px]" : "py-1.5",
				strong ? "font-semibold text-accent-text" : "text-ink",
			)}
		>
			<Icon name={icon} size={14} className={cn("shrink-0", strong ? "text-accent-text" : "text-ink-3")} />
			<span className="min-w-0 truncate">{children}</span>
		</button>
	);
}

/** Update and Discard when edited, then Save as new view and Manage views (once there are views). */
function ViewActions({
	views,
	active,
	edited,
	onUpdate,
	onDiscard,
	onSaveNew,
	onManage,
	large = false,
	close,
}: MenuItemsProps) {
	const run = (action: () => void) => () => {
		close();
		action();
	};
	const name = active?.name ?? "";
	return (
		<>
			{active && edited && (
				<>
					<Action icon="check" strong large={large} onClick={run(onUpdate)}>
						<Trans>Update “{name}”</Trans>
					</Action>
					<Action icon="arrow-counter-clockwise" large={large} onClick={run(onDiscard)}>
						<Trans>Discard changes</Trans>
					</Action>
					<div className="my-1.5 h-px bg-line" />
				</>
			)}
			<Action icon="plus" large={large} onClick={run(onSaveNew)}>
				<Trans>Save as new view…</Trans>
			</Action>
			{views.length > 0 && (
				<Action icon="sliders-horizontal" large={large} onClick={run(onManage)}>
					<Trans>Manage views…</Trans>
				</Action>
			)}
		</>
	);
}

const NO_VIEWS_HINT = () =>
	t`Save the filters, sort and columns you use often as a view, and come back to them in one click.`;

/**
 * "Views" with a bookmark by the tabs. With a view on it turns blue like a set filter, "View: Ready to apply", adds
 * "(edited)" when the screen differs from the view, and gets an × that leaves the view. It opens the views menu: a
 * popover, or a bottom sheet on phones, where the button shows just the name.
 */
export function ViewsButton({ phone, ref, ...menu }: ViewsButtonProps) {
	const [open, setOpen] = useState(false);
	const close = () => setOpen(false);
	const { active, edited } = menu;
	const name = active?.name ?? "";

	const label = active ? (
		<span {...{ [VIEWS_LABEL_ATTRIBUTE]: "" }} className="min-w-0 truncate">
			{phone ? (
				<span className="font-semibold">{name}</span>
			) : (
				<Trans>
					View: <span className="font-semibold">{name}</span>
				</Trans>
			)}
			{edited && (
				<span className="opacity-85">
					{" "}
					<Trans>(edited)</Trans>
				</span>
			)}
		</span>
	) : (
		<Trans>Views</Trans>
	);

	const boxClass = cn(
		"inline-flex min-w-0 shrink items-center rounded-lg border text-[13px] whitespace-nowrap transition-colors duration-quick",
		active ? "border-transparent bg-accent-soft text-accent-text" : "border-line-2 bg-raised text-ink hover:bg-hover",
		open && "border-accent ring-1 ring-accent",
		phone ? "h-9 max-w-[190px]" : "h-8 max-w-[280px]",
	);
	const triggerClass = cn(
		"inline-flex h-full min-w-0 items-center gap-1.5 rounded-lg ps-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent",
		active && !phone ? "pe-1" : "pe-2",
	);
	const triggerContent = (
		<>
			<Icon
				name="bookmark-simple"
				filled={Boolean(active)}
				size={15}
				className={cn("shrink-0", active ? "text-accent-text" : "text-ink-2")}
			/>
			{label}
			{(!active || phone) && (
				<Icon name="caret-down" size={13} className={cn("shrink-0", active ? "text-accent-text" : "text-ink-3")} />
			)}
		</>
	);
	const items = { ...menu, close };

	if (phone) {
		return (
			<>
				<span ref={ref} className={boxClass}>
					<button
						type="button"
						className={triggerClass}
						title={active ? name : undefined}
						aria-label={active ? t`View: ${name}` : undefined}
						onClick={() => setOpen(true)}
					>
						{triggerContent}
					</button>
				</span>
				<Sheet open={open} onOpenChange={setOpen}>
					<SheetContent side="bottom" showCloseButton={false} className="gap-0">
						<div className="flex items-baseline justify-between border-b border-line px-4 pt-1.5 pb-2.5">
							<SheetTitle className="font-sans text-[17px] leading-6 font-bold">
								<Trans>Views</Trans>
							</SheetTitle>
							<span className="text-[13px] text-ink-3">
								<Trans>filters, sort and columns</Trans>
							</span>
						</div>
						<div className="overflow-y-auto px-2 pt-1.5 pb-2">
							<ViewChoices {...items} large />
							{menu.views.length === 0 && <p className="mx-2 mt-1.5 mb-1 text-[13px] text-ink-3">{NO_VIEWS_HINT()}</p>}
						</div>
						<div className="border-t border-line px-2 pt-1.5 pb-[calc(22px+env(safe-area-inset-bottom))]">
							<ViewActions {...items} large />
						</div>
					</SheetContent>
				</Sheet>
			</>
		);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<span ref={ref} className={boxClass}>
				<PopoverTrigger className={triggerClass} title={active ? name : undefined}>
					{triggerContent}
				</PopoverTrigger>
				{active && (
					<button
						type="button"
						aria-label={t`Leave the view`}
						title={t`Leave the view`}
						onClick={() => menu.onPick(null)}
						className="me-1.5 grid size-[18px] shrink-0 place-items-center rounded transition-colors hover:bg-hover"
					>
						<Icon name="x" size={12} />
					</button>
				)}
			</span>
			<PopoverContent align="start" sideOffset={6} className="w-[300px] gap-0 p-1.5">
				<div className="flex items-baseline justify-between gap-2 px-2 pt-1 pb-1.5 text-xs font-medium whitespace-nowrap text-ink-3">
					<Trans>Views</Trans>
					<span className="font-normal">
						<Trans>filters, sort and columns</Trans>
					</span>
				</div>
				<ViewChoices {...items} />
				{menu.views.length === 0 && <p className="mx-2 mt-1.5 mb-1.5 text-xs text-ink-3">{NO_VIEWS_HINT()}</p>}
				<div className="my-1.5 h-px bg-line" />
				<ViewActions {...items} />
			</PopoverContent>
		</Popover>
	);
}
