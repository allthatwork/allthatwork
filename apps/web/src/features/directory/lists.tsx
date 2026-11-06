import type { RouterOutput } from "@/libs/orpc/client";
import type { DirectoryGroup, DirectoryGroupKey } from "@reactive-resume/schema/directory-names";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { contactSortKey, DIRECTORY_LETTERS } from "@reactive-resume/schema/directory-names";
import { cn } from "@reactive-resume/utils/style";
import { JobsButton, jobsLink, WatchBox } from "./watch";
import { useCareerTime } from "@/features/career/shared";

type Contact = RouterOutput["directory"]["contacts"][number];
type Company = RouterOutput["directory"]["companies"][number];

const groupLabel = (key: DirectoryGroupKey) => (key === "none" ? t`No last name` : key);

type GroupedListProps<T> = {
	label: string;
	groups: DirectoryGroup<T>[];
	/** Column headings, shown above the first group at desktop width. */
	head?: ReactNode;
	rowKey: (item: T) => string;
	renderRow: (item: T) => ReactNode;
};

/**
 * A Directory list: rows under letter headers that stay pinned while scrolling, with an A to Z rail beside it. A click
 * on a letter scrolls to its group; letters with nobody are greyed out. Contacts with no last name come last.
 */
export function GroupedList<T>({ label, groups, head, rowKey, renderRow }: GroupedListProps<T>) {
	const id = useId();
	const present = new Set(groups.map((group) => group.key));
	const jump = (key: DirectoryGroupKey) =>
		document.getElementById(`${id}-${key}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_0.875rem] items-start gap-1.5 sm:grid-cols-[minmax(0,1fr)_1rem] sm:gap-2">
			<div aria-label={label} role="region" className="overflow-clip rounded-md border border-line">
				{head}
				{groups.map((group) => (
					<section
						key={group.key}
						id={`${id}-${group.key}`}
						aria-labelledby={`${id}-${group.key}-label`}
						className="scroll-mt-2 border-t border-line first-of-type:border-t-0"
					>
						<h3
							id={`${id}-${group.key}-label`}
							className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-line bg-sunken px-2.5 py-1 text-[13px] font-bold"
						>
							{groupLabel(group.key)}
							<span className="text-xs font-normal text-ink-3">{group.items.length}</span>
						</h3>
						<ul>
							{group.items.map((item) => (
								<li key={rowKey(item)} className="border-b border-line last:border-b-0">
									{renderRow(item)}
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
			<nav
				aria-label={t`Jump to a letter`}
				className="sticky top-2 grid content-start gap-px pt-0.5 text-center text-[9px] leading-[1.35] font-bold sm:text-[10px]"
			>
				{DIRECTORY_LETTERS.map((letter) =>
					present.has(letter) ? (
						<button
							key={letter}
							type="button"
							aria-label={t`Jump to ${letter}`}
							className="rounded-xs text-accent-text hover:bg-sunken"
							onClick={() => jump(letter)}
						>
							{letter}
						</button>
					) : (
						<span key={letter} aria-hidden="true" className="font-normal text-line-2">
							{letter}
						</span>
					),
				)}
			</nav>
		</div>
	);
}

/** Up to two initials: first and last name's, or the first and last word's of a one-part name. */
export function initials(contact: Pick<Contact, "firstName" | "lastName" | "name">) {
	const letter = (value: string) => /\p{L}|\p{N}/u.exec(value)?.[0]?.toUpperCase() ?? "";
	const last = contactSortKey(contact.lastName);
	if (last) return `${letter(contact.firstName)}${letter(last)}`;
	const words = (contact.firstName || contact.name).split(/\s+/).filter((word) => letter(word));
	return `${letter(words[0] ?? "")}${words.length > 1 ? letter(words.at(-1) ?? "") : ""}`;
}

type ContactNameProps = { contact: Pick<Contact, "firstName" | "lastName" | "name"> };
/** The name as written, with the part it sorts by in bold ("Priya **Menon**, PMP"). */
export function ContactName({ contact }: ContactNameProps) {
	const last = contact.lastName.trim();
	if (!last) return <>{contact.name}</>;
	const key = contactSortKey(last);
	const [bold, rest] = key && last.startsWith(key) ? [key, last.slice(key.length)] : [last, ""];
	return (
		<>
			{contact.firstName && `${contact.firstName} `}
			<b className="font-bold">{bold}</b>
			{rest}
		</>
	);
}

function LookingForWork() {
	return (
		<span className="me-1.5 inline-flex rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent-text">
			<Trans>Looking for work</Trans>
		</span>
	);
}

/** "Oct 9", with the year when it isn't this year. */
function useShortDate() {
	const { format } = useCareerTime();
	// This year, read once: dates in it leave the year out.
	const [year] = useState(() => new Date().getFullYear());
	return (value: Date | string | null) =>
		value
			? format(value, {
					month: "short",
					day: "numeric",
					...(new Date(value).getFullYear() === year ? {} : { year: "numeric" }),
				})
			: "—";
}

const CONTACT_COLUMNS = "sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,9rem)_5.5rem]";
const COMPANY_CONTACT_COLUMNS = "sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_5.5rem]";
const COMPANY_COLUMNS = "sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_9.5rem_3rem]";

type ListHeadProps = { columns: string; children: ReactNode };
function ListHead({ columns, children }: ListHeadProps) {
	return (
		<div
			aria-hidden="true"
			className={cn(
				"hidden h-7 items-center gap-3 border-b border-line bg-sunken px-2.5 text-[11px] tracking-[0.04em] text-ink-3 uppercase sm:grid",
				columns,
			)}
		>
			{children}
		</div>
	);
}

export function ContactsHead() {
	return (
		<ListHead columns={CONTACT_COLUMNS}>
			<span>
				<Trans>Name</Trans>
			</span>
			<span>
				<Trans>Position</Trans>
			</span>
			<span>
				<Trans>Company</Trans>
			</span>
			<span className="text-end">
				<Trans>Last contact</Trans>
			</span>
		</ListHead>
	);
}

type ContactRowProps = {
	contact: Contact;
	/** Shown and linked in its own column; left out on a company's page. */
	company?: { id: string; name: string } | null | undefined;
	showCompany?: boolean;
};

/**
 * One contact: initials, the name, the position with "Looking for work" at its start, the company, and the last
 * contact date. The whole row opens the contact; the company opens the company. Two short lines on a phone.
 */
export function ContactRow({ contact, company, showCompany = true }: ContactRowProps) {
	const shortDate = useShortDate();
	const position = (
		<>
			{contact.lookingForWork && <LookingForWork />}
			{contact.position}
		</>
	);
	return (
		<div
			className={cn(
				"relative grid gap-0.5 px-2.5 py-1.5 text-[13px] hover:bg-sunken sm:min-h-[34px] sm:items-center sm:gap-3 sm:py-1",
				showCompany ? CONTACT_COLUMNS : COMPANY_CONTACT_COLUMNS,
			)}
		>
			<span className="flex min-w-0 items-center gap-2">
				<span
					aria-hidden="true"
					className="hidden size-[22px] shrink-0 place-items-center rounded-full border border-line bg-sunken text-[10px] font-bold text-ink-2 sm:grid"
				>
					{initials(contact)}
				</span>
				<Link
					to="/dashboard/directory"
					search={{ tab: "contacts", contact: contact.id }}
					className="truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-accent"
				>
					<ContactName contact={contact} />
				</Link>
			</span>
			{/* Phone: position and company on one muted line. */}
			<span className="truncate text-ink-2 sm:hidden">
				{position}
				{showCompany && company && (contact.position ? ` · ${company.name}` : company.name)}
			</span>
			<span className="hidden truncate text-ink-2 sm:block">{position}</span>
			{showCompany && (
				<span className="hidden min-w-0 sm:block">
					{company ? (
						<Link
							to="/dashboard/directory"
							search={{ tab: "companies", company: company.id }}
							className="relative z-1 block truncate text-accent-text hover:underline"
						>
							{company.name}
						</Link>
					) : (
						<span className="text-ink-3">
							<Trans>No company</Trans>
						</span>
					)}
				</span>
			)}
			<span className="hidden text-end text-ink-2 tabular-nums sm:block">{shortDate(contact.lastContactedAt)}</span>
		</div>
	);
}

export function CompaniesHead() {
	return (
		<ListHead columns={COMPANY_COLUMNS}>
			<span>
				<Trans>Company</Trans>
			</span>
			<span className="text-end">
				<Trans>Contacts</Trans>
			</span>
			<span className="text-end">
				<Trans>Applications</Trans>
			</span>
			<span>
				<Trans>Jobs</Trans>
			</span>
			<span className="text-center">
				<Trans>Watch</Trans>
			</span>
		</ListHead>
	);
}

const hostname = (website: string | null) => {
	if (!website) return null;
	try {
		return new URL(website).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
};

type CompanyRowProps = { company: Company };

/**
 * One company: logo, name and domain, contact and application counts, Jobs (the open count and Jobs ↗) and the Watch
 * box. The row opens the company; Jobs ↗ and the box don't. On a phone, two lines with the box at the right: the open
 * count and Jobs ↗ first, then the counts, leaving out zeros.
 */
export function CompanyRow({ company }: CompanyRowProps) {
	const domain = hostname(company.website);
	const jobs = jobsLink(company);
	const open = jobs && jobs.count !== null ? t`${jobs.count} open` : "";
	const counts = [
		company.contactCount === 1 ? t`1 contact` : company.contactCount ? t`${company.contactCount} contacts` : "",
		company.applicationCount === 1
			? t`1 application`
			: company.applicationCount
				? t`${company.applicationCount} applications`
				: "",
	].filter(Boolean);
	const phoneLine: { key: string; node: ReactNode }[] = [
		...(open ? [{ key: "open", node: open }] : []),
		...(jobs
			? [
					{
						key: "jobs",
						node: (
							<a href={jobs.url} target="_blank" rel="noopener noreferrer" className="relative z-1 text-accent-text">
								{t`Jobs`} ↗
							</a>
						),
					},
				]
			: []),
		...counts.map((text) => ({ key: text, node: text })),
	];
	return (
		<div
			className={cn(
				"relative grid grid-cols-[minmax(0,1fr)_1.5rem] gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-[13px] hover:bg-sunken sm:min-h-[34px] sm:items-center sm:gap-3 sm:py-1",
				COMPANY_COLUMNS,
			)}
		>
			<span className="flex min-w-0 items-center gap-2">
				<CompanyLogo name={company.name} website={company.website} size="sm" />
				<Link
					to="/dashboard/directory"
					search={{ tab: "companies", company: company.id }}
					className="truncate font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-accent"
				>
					{company.name}
				</Link>
				{domain && <span className="hidden truncate text-ink-3 sm:inline">{domain}</span>}
			</span>
			{phoneLine.length > 0 && (
				<span className="col-start-1 row-start-2 truncate text-ink-2 sm:hidden">
					{phoneLine.map((part, index) => (
						<span key={part.key}>
							{index > 0 && " · "}
							{part.node}
						</span>
					))}
				</span>
			)}
			<span className="hidden text-end text-ink-2 tabular-nums sm:block">{company.contactCount}</span>
			<span className="hidden text-end text-ink-2 tabular-nums sm:block">{company.applicationCount}</span>
			<span className="hidden min-w-0 items-center gap-1.5 whitespace-nowrap sm:flex">
				{jobs ? (
					<>
						{open && <span className="ms-auto text-ink-2 tabular-nums">{open}</span>}
						<JobsButton url={jobs.url} className={open ? undefined : "ms-auto"} />
					</>
				) : (
					<span className="text-ink-3">—</span>
				)}
			</span>
			<span className="col-start-2 row-span-2 row-start-1 flex items-center justify-center sm:col-start-auto sm:row-span-1 sm:row-start-auto">
				<WatchBox company={company} />
			</span>
		</div>
	);
}

type CompanyLogoProps = { name: string; website: string | null; size?: "sm" | "md" | "lg" };
const LOGO_SIZES = {
	sm: { box: "size-5 rounded-[5px] text-[10px]", px: 20 },
	md: { box: "size-8 rounded-[7px] text-sm", px: 32 },
	lg: { box: "size-10 rounded-lg", px: 40 },
};

/** The company's favicon, or its first letter while there's none. */
export function CompanyLogo({ name, website, size = "lg" }: CompanyLogoProps) {
	const [failed, setFailed] = useState<string | null>(null);
	const { box, px } = LOGO_SIZES[size];
	let icon: string | null = null;
	try {
		icon = website ? new URL("/favicon.ico", website).href : null;
	} catch {
		icon = null;
	}
	return (
		<span
			className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-sunken font-semibold", box)}
			aria-hidden="true"
		>
			{name.slice(0, 1).toUpperCase()}
			{icon && failed !== icon && (
				<img
					src={icon}
					alt=""
					width={px}
					height={px}
					loading="lazy"
					referrerPolicy="no-referrer"
					className="absolute inset-0 size-full bg-sunken object-contain p-0.5"
					onError={() => setFailed(icon)}
				/>
			)}
		</span>
	);
}

export { hostname, useShortDate };
