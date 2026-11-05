import type { RouterOutput } from "@/libs/orpc/client";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { cloneElement, isValidElement, useId, useState } from "react";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { companyFieldsSchema, contactFieldsSchema } from "@reactive-resume/schema/directory";
import { contactFullName, groupCompanies, groupContacts, sortContacts } from "@reactive-resume/schema/directory-names";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@reactive-resume/ui/components/alert-dialog";
import { Button } from "@reactive-resume/ui/components/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { useIsMobile } from "@reactive-resume/ui/hooks/use-mobile";
import { cn } from "@reactive-resume/utils/style";
import { CompanyBoards, WatchSuggestions } from "./boards";
import {
	CompaniesHead,
	CompanyLogo,
	CompanyRow,
	ContactRow,
	ContactsHead,
	GroupedList,
	hostname,
	useShortDate,
} from "./lists";
import { getStageLabel } from "@/features/applications/stages";
import { useCareerTime } from "@/features/career/shared";
import { client, orpc } from "@/libs/orpc/client";

type Company = RouterOutput["directory"]["company"]["company"];
type Contact = RouterOutput["directory"]["contacts"][number];
type DirectorySearch = {
	tab?: "companies" | "contacts" | undefined;
	company?: string | undefined;
	contact?: string | undefined;
};
type DirectoryPageProps = DirectorySearch;

export function DirectoryPage({ tab = "companies", company, contact }: DirectoryPageProps) {
	const navigate = useNavigate();
	return (
		<div className="mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-8">
			<header className="grid gap-3">
				<h1 className="font-display text-3xl font-medium">
					<Trans>Directory</Trans>
				</h1>
				<p className="text-sm text-ink-2">
					<Trans>Your companies and contacts, across every application.</Trans>
				</p>
				<nav aria-label={t`Directory`} className="flex gap-4 border-b border-line pb-3">
					<Link
						to="/dashboard/directory"
						search={{ tab: "companies" }}
						aria-current={tab === "companies" ? "page" : undefined}
						className={tab === "companies" ? "font-semibold text-accent-text" : "text-ink-2"}
					>
						<Trans>Companies</Trans>
					</Link>
					<Link
						to="/dashboard/directory"
						search={{ tab: "contacts" }}
						aria-current={tab === "contacts" ? "page" : undefined}
						className={tab === "contacts" ? "font-semibold text-accent-text" : "text-ink-2"}
					>
						<Trans>Contacts</Trans>
					</Link>
				</nav>
			</header>
			{contact ? (
				<ContactPage
					key={contact}
					id={contact}
					onDeleted={() => navigate({ to: "/dashboard/directory", search: { tab: "contacts" } })}
				/>
			) : company ? (
				<CompanyPage
					key={company}
					id={company}
					onDeleted={() => navigate({ to: "/dashboard/directory", search: { tab: "companies" } })}
				/>
			) : tab === "companies" ? (
				<CompaniesList />
			) : (
				<ContactsList />
			)}
		</div>
	);
}

type FieldProps = { label: string; hint?: string | undefined; children: ReactNode };
function Field({ label, hint, children }: FieldProps) {
	const id = useId();
	return (
		<div className="grid content-start gap-1.5 text-sm">
			<label htmlFor={id} className="font-medium">
				{label}
			</label>
			{isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
				? cloneElement(children, { id, ...(hint ? { "aria-describedby": `${id}-hint` } : {}) })
				: children}
			{hint && (
				<p id={`${id}-hint`} className="-mt-0.5 text-xs text-ink-3">
					{hint}
				</p>
			)}
		</div>
	);
}

type LoadStateProps = { pending: boolean; error: boolean; retry: () => void };
function LoadState({ pending, error, retry }: LoadStateProps) {
	if (error)
		return (
			<div role="alert" className="grid justify-items-start gap-2">
				<p>
					<Trans>Could not load the directory.</Trans>
				</p>
				<Button variant="secondary" onClick={retry}>
					<Trans>Try again</Trans>
				</Button>
			</div>
		);
	return pending ? (
		<p role="status" className="text-ink-2">
			<Trans>Loading…</Trans>
		</p>
	) : null;
}

type DeleteActionProps = { label: string; onDelete: () => Promise<unknown> };
function DeleteAction({ label, onDelete }: DeleteActionProps) {
	const [armed, setArmed] = useState(false);
	const mutation = useMutation({ mutationFn: onDelete });
	return (
		<div className="grid justify-items-start gap-2">
			{armed ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm">
						<Trans>This permanently deletes the selected records.</Trans>
					</span>
					<Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
						{label}
					</Button>
					<Button variant="ghost" onClick={() => setArmed(false)}>
						<Trans>Cancel</Trans>
					</Button>
				</div>
			) : (
				<Button variant="secondary" onClick={() => setArmed(true)}>
					{label}
				</Button>
			)}
			{mutation.isError && (
				<p role="alert" className="text-sm text-danger-text">
					{mutation.error.message}
				</p>
			)}
		</div>
	);
}

function useRefreshDirectory() {
	const cache = useQueryClient();
	return async () => {
		await Promise.all([
			cache.invalidateQueries({ queryKey: orpc.directory.key() }),
			cache.invalidateQueries({ queryKey: orpc.applications.key() }),
		]);
	};
}

type ToolbarProps = {
	search: string;
	onSearch: (value: string) => void;
	label: string;
	placeholder: string;
	add: string;
	onAdd: () => void;
	count?: string | undefined;
	children?: ReactNode;
};
/** Search, the add button, the total, and (contacts) a ⋯ menu. Shorter labels on a phone. */
function Toolbar({ search, onSearch, label, placeholder, add, onAdd, count, children }: ToolbarProps) {
	const mobile = useIsMobile();
	return (
		<div className="flex items-center gap-2">
			<Input
				className="min-w-0 flex-1 sm:max-w-xs"
				aria-label={label}
				placeholder={mobile ? t`Search` : placeholder}
				value={search}
				onChange={(event) => onSearch(event.target.value)}
			/>
			<Button onClick={onAdd} aria-label={add}>
				<span className="sm:hidden">
					<Trans>Add</Trans>
				</span>
				<span className="hidden sm:inline">{add}</span>
			</Button>
			{count && <span className="ms-auto hidden text-sm text-ink-3 sm:inline">{count}</span>}
			{children}
		</div>
	);
}

function CompaniesList() {
	const { i18n } = useLingui();
	const [search, setSearch] = useState("");
	const [adding, setAdding] = useState(false);
	const query = useQuery(orpc.directory.companies.queryOptions({ input: {} }));
	const rows = query.data?.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()));
	const total = query.data?.length ?? 0;
	return (
		<section className="grid gap-3">
			<Toolbar
				search={search}
				onSearch={setSearch}
				label={t`Search companies`}
				placeholder={t`Search companies`}
				add={t`Add company`}
				onAdd={() => setAdding(true)}
				count={query.data ? (total === 1 ? t`1 company` : t`${total} companies`) : undefined}
			/>
			{!search && <WatchSuggestions />}
			<LoadState pending={query.isPending} error={query.isError} retry={() => void query.refetch()} />
			{rows?.length === 0 && (
				<p className="text-ink-2">
					<Trans>No companies found. Add a company or track an application to get started.</Trans>
				</p>
			)}
			{!!rows?.length && (
				<GroupedList
					label={t`Companies`}
					groups={groupCompanies(rows, i18n.locale)}
					head={<CompaniesHead />}
					rowKey={(row) => row.id}
					renderRow={(row) => <CompanyRow company={row} />}
				/>
			)}
			<CompanyEditor open={adding} onClose={() => setAdding(false)} />
		</section>
	);
}

function ContactsList() {
	const { i18n } = useLingui();
	const [search, setSearch] = useState("");
	const [adding, setAdding] = useState(false);
	const [erasing, setErasing] = useState(false);
	const query = useQuery(orpc.directory.contacts.queryOptions({ input: {} }));
	const companies = useQuery(orpc.directory.companies.queryOptions({ input: {} }));
	const byId = new Map(companies.data?.map((row) => [row.id, row]));
	const companyOf = (row: Contact) => (row.companyId ? byId.get(row.companyId) : undefined);
	const rows = query.data?.filter((row) =>
		`${row.name} ${row.position} ${companyOf(row)?.name ?? ""} ${row.tags.join(" ")}`
			.toLowerCase()
			.includes(search.toLowerCase()),
	);
	const total = query.data?.length ?? 0;
	return (
		<section className="grid gap-3">
			<Toolbar
				search={search}
				onSearch={setSearch}
				label={t`Search contacts`}
				placeholder={t`Search contacts, companies, or tags`}
				add={t`Add contact`}
				onAdd={() => setAdding(true)}
				count={query.data ? (total === 1 ? t`1 contact` : t`${total} contacts`) : undefined}
			>
				{total > 0 && (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="secondary" size="icon" aria-label={t`More actions`} className="ms-auto sm:ms-0" />
							}
						>
							<Icon name="dots-three" size={18} />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem variant="destructive" onClick={() => setErasing(true)}>
								<Trans>Delete all contacts</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</Toolbar>
			<LoadState
				pending={query.isPending || companies.isPending}
				error={query.isError || companies.isError}
				retry={() => {
					void query.refetch();
					void companies.refetch();
				}}
			/>
			{rows?.length === 0 && (
				<p className="text-ink-2">
					<Trans>No contacts found. People added from applications and interviews also appear here.</Trans>
				</p>
			)}
			{!!rows?.length && companies.data && (
				<GroupedList
					label={t`Contacts`}
					groups={groupContacts(rows, i18n.locale)}
					head={<ContactsHead />}
					rowKey={(row) => row.id}
					renderRow={(row) => <ContactRow contact={row} company={companyOf(row)} />}
				/>
			)}
			<ContactEditor open={adding} onClose={() => setAdding(false)} />
			<DeleteAllContacts open={erasing} total={total} onClose={() => setErasing(false)} />
		</section>
	);
}

type DeleteAllContactsProps = { open: boolean; total: number; onClose: () => void };
function DeleteAllContacts({ open, total, onClose }: DeleteAllContactsProps) {
	const refresh = useRefreshDirectory();
	const erase = useMutation({
		mutationFn: () => client.directory.deleteAllContacts({ confirm: true }),
		onSuccess: async () => {
			await refresh();
			onClose();
		},
	});
	return (
		<AlertDialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Delete all contacts?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						{total === 1
							? t`This permanently deletes 1 contact, its notes and history, and removes it from your applications' contacts and interviews' participants. Companies and applications stay.`
							: t`This permanently deletes ${total} contacts, their notes and history, and removes them from your applications' contacts and interviews' participants. Companies and applications stay.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{erase.isError && (
					<p role="alert" className="text-sm text-danger-text">
						{erase.error.message}
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction variant="danger" loading={erase.isPending} onClick={() => erase.mutate()}>
						<Trans>Delete all contacts</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

type DetailProps = { id: string; onDeleted: () => Promise<void> };
/** A company's page shows this many contacts before Show more. */
const COMPANY_CONTACTS_SHOWN = 5;

function CompanyPage({ id, onDeleted }: DetailProps) {
	const { i18n } = useLingui();
	const shortDate = useShortDate();
	const query = useQuery(orpc.directory.company.queryOptions({ input: { id } }));
	const [editing, setEditing] = useState(false);
	const [adding, setAdding] = useState(false);
	const [allContacts, setAllContacts] = useState(false);
	const refresh = useRefreshDirectory();
	if (!query.data)
		return <LoadState pending={query.isPending} error={query.isError} retry={() => void query.refetch()} />;
	const { company, applications } = query.data;
	const contacts = sortContacts(query.data.contacts, i18n.locale);
	const shown = allContacts ? contacts : contacts.slice(0, COMPANY_CONTACTS_SHOWN);
	const hidden = contacts.length - shown.length;
	const domain = hostname(company.website);
	return (
		<section className="grid gap-6">
			<div className="grid gap-1">
				<div className="flex items-center gap-2.5">
					<CompanyLogo key={company.website} name={company.name} website={company.website} size="md" />
					<h2 className="min-w-0 flex-1 truncate font-display text-2xl font-medium">{company.name}</h2>
					<Button variant="secondary" onClick={() => setEditing(true)}>
						<Trans>Edit company</Trans>
					</Button>
				</div>
				{company.website && (
					<a
						href={company.website}
						target="_blank"
						rel="noreferrer"
						className="ms-[42px] w-fit text-sm text-accent-text hover:underline"
					>
						{domain ?? company.website}
					</a>
				)}
			</div>
			{company.notes && <p className="text-sm whitespace-pre-wrap">{company.notes}</p>}
			<div className="grid gap-2">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-bold">
						<Trans>Contacts</Trans> <span className="font-normal text-ink-3">{contacts.length}</span>
					</h3>
					<Button size="sm" onClick={() => setAdding(true)}>
						<Trans>Add contact</Trans>
					</Button>
				</div>
				{contacts.length > 0 ? (
					<ul className="overflow-clip rounded-md border border-line">
						{shown.map((contact) => (
							<li key={contact.id} className="border-b border-line last:border-b-0">
								<ContactRow contact={contact} showCompany={false} />
							</li>
						))}
						{hidden > 0 && (
							<li>
								<button
									type="button"
									className="px-2.5 py-1.5 text-[13px] text-accent-text underline-offset-4 hover:underline"
									onClick={() => setAllContacts(true)}
								>
									{hidden === 1 ? t`Show 1 more` : t`Show ${hidden} more`}
								</button>
							</li>
						)}
					</ul>
				) : (
					<p className="text-sm text-ink-2">
						<Trans>No contacts at this company yet.</Trans>
					</p>
				)}
			</div>
			<div className="grid gap-2">
				<h3 className="text-sm font-bold">
					<Trans>Applications</Trans> <span className="font-normal text-ink-3">{applications.length}</span>
				</h3>
				{applications.length > 0 ? (
					<ul className="overflow-clip rounded-md border border-line">
						{applications.map((row) => (
							<li
								key={row.id}
								className="relative grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3 border-b border-line px-2.5 py-1.5 text-[13px] last:border-b-0 hover:bg-sunken"
							>
								<Link
									to="/dashboard/applications/$applicationId/{-$tab}"
									params={{ applicationId: row.id }}
									className="truncate font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-accent"
								>
									{row.role}
								</Link>
								<StagePill status={row.status} />
								<span className="text-end text-ink-2 tabular-nums">{shortDate(row.at)}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-ink-2">
						<Trans>No applications at this company yet.</Trans>
					</p>
				)}
			</div>
			<CompanyBoards companyId={company.id} />
			<DeleteAction
				label={t`Delete company`}
				onDelete={async () => {
					await client.directory.deleteCompany({ id });
					await onDeleted();
					await refresh();
				}}
			/>
			<CompanyEditor open={editing} company={company} onClose={() => setEditing(false)} />
			<ContactEditor open={adding} companyId={id} onClose={() => setAdding(false)} />
		</section>
	);
}

type StagePillProps = { status: string };
function StagePill({ status }: StagePillProps) {
	const stage = (APPLICATION_STATUSES as readonly string[]).includes(status) ? (status as ApplicationStatus) : null;
	return (
		<span
			className={cn(
				"rounded-full px-1.5 py-px text-[11px] font-semibold whitespace-nowrap",
				stage === "closed" ? "bg-sunken text-ink-2" : "bg-accent-soft text-accent-text",
			)}
		>
			{stage ? getStageLabel(stage) : status}
		</span>
	);
}

type ApplicationLinkProps = { application: { id: string; company: string; role: string; status: string } };
function ApplicationLink({ application }: ApplicationLinkProps) {
	return (
		<Link
			to="/dashboard/applications/$applicationId/{-$tab}"
			params={{ applicationId: application.id }}
			className="rounded-lg border border-line p-3 text-sm hover:bg-sunken"
		>
			<span className="font-medium">{application.role}</span>
			<span className="text-ink-2"> · {application.company}</span>
		</Link>
	);
}

function ContactPage({ id, onDeleted }: DetailProps) {
	const { format } = useCareerTime();
	const query = useQuery(orpc.directory.contact.queryOptions({ input: { id } }));
	const [editing, setEditing] = useState(false);
	const [note, setNote] = useState("");
	const refresh = useRefreshDirectory();
	const addNote = useMutation({
		mutationFn: () => client.directory.addNote({ id, text: note }),
		onSuccess: async () => {
			setNote("");
			await refresh();
		},
	});
	if (!query.data)
		return <LoadState pending={query.isPending} error={query.isError} retry={() => void query.refetch()} />;
	const { contact, company, employment, notes, applications, interviews } = query.data;
	const timeline = [
		...notes.map((row) => ({
			id: row.id,
			at: row.at,
			content: <p className="whitespace-pre-wrap">{row.text}</p>,
			note: true,
		})),
		...applications.map((row) => ({
			id: `application:${row.id}`,
			at: row.at,
			content: <ApplicationLink application={row} />,
			note: false,
		})),
		...interviews.map((row) => ({
			id: `interview:${row.entryId}`,
			at: row.at,
			content: (
				<div className="grid gap-2">
					<p>
						<Trans>Interview</Trans>
						{row.contextRole && ` · ${row.contextRole}`}
					</p>
					<ApplicationLink application={row} />
				</div>
			),
			note: false,
		})),
	].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	return (
		<section className="grid gap-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<h2 className="font-display text-2xl font-medium">{contact.name}</h2>
					<p className="text-ink-2">{contact.position}</p>
					{company && (
						<Link
							to="/dashboard/directory"
							search={{ tab: "companies", company: company.id }}
							className="text-accent-text hover:underline"
						>
							{company.name}
						</Link>
					)}
					{contact.lookingForWork && (
						<p className="text-sm text-accent-text">
							<Trans>Looking for work</Trans>
						</p>
					)}
				</div>
				<Button variant="secondary" onClick={() => setEditing(true)}>
					<Trans>Edit contact</Trans>
				</Button>
			</div>
			<div className="grid gap-2 text-sm">
				{contact.profileLinks.map((url) => (
					<a
						key={url}
						href={url}
						target="_blank"
						rel="noreferrer"
						className="break-all text-accent-text hover:underline"
					>
						{url}
					</a>
				))}
				{contact.emails.map((email) => (
					<a key={email} href={`mailto:${email}`} className="text-accent-text">
						{email}
					</a>
				))}
				{contact.phones.map((phone) => (
					<a key={phone} href={`tel:${phone}`} className="text-accent-text">
						{phone}
					</a>
				))}
				{contact.tags.length > 0 && <p>{contact.tags.join(" · ")}</p>}
				{contact.relationship && <p className="whitespace-pre-wrap">{contact.relationship}</p>}
				{contact.notes && <p className="whitespace-pre-wrap">{contact.notes}</p>}
				{contact.connectedOn && (
					<p>
						<Trans>Connected on</Trans>: {contact.connectedOn}
					</p>
				)}
				<p>
					<Trans>Last contacted</Trans>:{" "}
					{contact.lastContactedAt ? new Date(contact.lastContactedAt).toISOString().slice(0, 10) : t`Not recorded`}
				</p>
			</div>
			{employment.length > 0 && (
				<div className="grid gap-2">
					<h3 className="text-lg font-semibold">
						<Trans>Company history</Trans>
					</h3>
					{employment.map((row) => (
						<p key={row.id} className="text-sm">
							{[row.position, row.companyName].filter(Boolean).join(" · ")}
							{(row.startedOn || row.endedOn) && ` (${row.startedOn ?? "?"} – ${row.endedOn ?? "?"})`}
						</p>
					))}
				</div>
			)}
			<div className="grid gap-3">
				<h3 className="text-lg font-semibold">
					<Trans>Timeline</Trans>
				</h3>
				<form
					className="grid justify-items-start gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						addNote.mutate();
					}}
				>
					<Textarea
						aria-label={t`Add a note`}
						placeholder={t`Add a note`}
						value={note}
						onChange={(event) => setNote(event.target.value)}
						maxLength={20_000}
					/>
					<Button type="submit" disabled={!note.trim() || addNote.isPending}>
						<Trans>Add note</Trans>
					</Button>
					{addNote.isError && (
						<p role="alert" className="text-sm text-danger-text">
							{addNote.error.message}
						</p>
					)}
				</form>
				{timeline.map((row) => (
					<div key={row.id} className="grid gap-2 border-l-2 border-line pl-4 text-sm">
						<time className="text-xs text-ink-3" dateTime={new Date(row.at).toISOString()}>
							{format(row.at, { dateStyle: "medium", timeStyle: "short" })}
						</time>
						{row.content}
						{row.note && (
							<DeleteAction
								label={t`Delete note`}
								onDelete={async () => {
									await client.directory.deleteNote({ id: row.id });
									await refresh();
								}}
							/>
						)}
					</div>
				))}
				{!timeline.length && (
					<p className="text-sm text-ink-2">
						<Trans>Notes, linked applications, and interviews will appear here.</Trans>
					</p>
				)}
			</div>
			<DeleteAction
				label={t`Delete contact`}
				onDelete={async () => {
					await client.directory.deleteContact({ id });
					await onDeleted();
					await refresh();
				}}
			/>
			<ContactEditor open={editing} contact={contact} onClose={() => setEditing(false)} />
		</section>
	);
}

type CompanyEditorProps = { open: boolean; company?: Company | undefined; onClose: () => void };
function CompanyEditor({ open, company, onClose }: CompanyEditorProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{company ? t`Edit company` : t`Add company`}</DialogTitle>
				</DialogHeader>
				{open && <CompanyForm company={company} onClose={onClose} />}
			</DialogContent>
		</Dialog>
	);
}
type CompanyFormProps = { company: Company | undefined; onClose: () => void };
function CompanyForm({ company, onClose }: CompanyFormProps) {
	const [name, setName] = useState(company?.name ?? "");
	const [website, setWebsite] = useState(company?.website ?? "");
	const [notes, setNotes] = useState(company?.notes ?? "");
	const refresh = useRefreshDirectory();
	const save = useMutation({
		mutationFn: () => {
			const fields = companyFieldsSchema.parse({
				name,
				website: website.trim() || null,
				notes,
				sources: company?.sources ?? [],
			});
			return company
				? client.directory.updateCompany({ id: company.id, ...fields })
				: client.directory.createCompany(fields);
		},
		onSuccess: async () => {
			await refresh();
			onClose();
		},
	});
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<Field label={t`Name`}>
				<Input required maxLength={300} value={name} onChange={(event) => setName(event.target.value)} />
			</Field>
			<Field label={t`Website`}>
				<Input
					type="url"
					maxLength={2048}
					value={website}
					onChange={(event) => setWebsite(event.target.value)}
					placeholder="https://example.com"
				/>
			</Field>
			<Field label={t`Notes`}>
				<Textarea maxLength={20_000} value={notes} onChange={(event) => setNotes(event.target.value)} />
			</Field>
			{save.isError && (
				<p role="alert" className="text-sm text-danger-text">
					{save.error.message}
				</p>
			)}
			<Button type="submit" disabled={save.isPending || !name.trim()}>
				<Trans>Save</Trans>
			</Button>
		</form>
	);
}

type ContactEditorProps = {
	open: boolean;
	contact?: Contact | undefined;
	companyId?: string | undefined;
	onClose: () => void;
};
function ContactEditor({ open, contact, companyId, onClose }: ContactEditorProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{contact ? t`Edit contact` : t`Add contact`}</DialogTitle>
				</DialogHeader>
				{open && <ContactForm contact={contact} companyId={companyId} onClose={onClose} />}
			</DialogContent>
		</Dialog>
	);
}
const lines = (value: string) => [
	...new Set(
		value
			.split(/\r?\n/)
			.map((row) => row.trim())
			.filter(Boolean),
	),
];
type ContactFormProps = { contact: Contact | undefined; companyId: string | undefined; onClose: () => void };
function ContactForm({ contact, companyId, onClose }: ContactFormProps) {
	const { i18n } = useLingui();
	const companies = useQuery(orpc.directory.companies.queryOptions({ input: {} }));
	const [draft, setDraft] = useState({
		firstName: contact?.firstName ?? "",
		lastName: contact?.lastName ?? "",
		companyId: contact?.companyId ?? companyId ?? "",
		position: contact?.position ?? "",
		profileLinks: contact?.profileLinks.join("\n") ?? "",
		emails: contact?.emails.join("\n") ?? "",
		phones: contact?.phones.join("\n") ?? "",
		tags: contact?.tags.join("\n") ?? "",
		notes: contact?.notes ?? "",
		relationship: contact?.relationship ?? "",
		connectedOn: contact?.connectedOn ?? "",
		lastContactedAt: contact?.lastContactedAt ? new Date(contact.lastContactedAt).toISOString().slice(0, 10) : "",
		lookingForWork: contact?.lookingForWork ?? false,
	});
	const refresh = useRefreshDirectory();
	const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
		setDraft((current) => ({ ...current, [key]: value }));
	const save = useMutation({
		mutationFn: () => {
			const fields = contactFieldsSchema.parse({
				...draft,
				companyId: draft.companyId || null,
				profileLinks: lines(draft.profileLinks),
				emails: lines(draft.emails),
				phones: lines(draft.phones),
				tags: lines(draft.tags),
				connectedOn: draft.connectedOn || null,
				lastContactedAt: draft.lastContactedAt ? `${draft.lastContactedAt}T12:00:00Z` : null,
				sources: contact?.sources ?? [],
				lastImportedAt: contact?.lastImportedAt ?? null,
			});
			return contact
				? client.directory.updateContact({ id: contact.id, ...fields })
				: client.directory.createContact(fields);
		},
		onSuccess: async () => {
			await refresh();
			onClose();
		},
	});
	const multi = (key: "profileLinks" | "emails" | "phones" | "tags", label: string) => (
		<Field label={label}>
			<Textarea
				rows={2}
				value={draft[key]}
				onChange={(event) => set(key, event.target.value)}
				placeholder={t`One per line`}
			/>
		</Field>
	);
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field label={t`First name`}>
					<Input
						maxLength={200}
						autoComplete="off"
						value={draft.firstName}
						onChange={(event) => set("firstName", event.target.value)}
					/>
				</Field>
				<Field label={t`Last name`} hint={t`Contacts are sorted and grouped by it.`}>
					<Input
						maxLength={200}
						autoComplete="off"
						value={draft.lastName}
						onChange={(event) => set("lastName", event.target.value)}
					/>
				</Field>
			</div>
			<Field label={t`Company`}>
				<select
					className="h-9 rounded-md border border-line bg-surface px-3"
					value={draft.companyId}
					onChange={(event) => set("companyId", event.target.value)}
				>
					<option value="">{t`No company`}</option>
					{companies.data &&
						groupCompanies(companies.data, i18n.locale)
							.flatMap((group) => group.items)
							.map((row) => (
								<option key={row.id} value={row.id}>
									{row.name}
								</option>
							))}
				</select>
			</Field>
			<Field label={t`Position`}>
				<Input maxLength={300} value={draft.position} onChange={(event) => set("position", event.target.value)} />
			</Field>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={draft.lookingForWork}
					onChange={(event) => set("lookingForWork", event.target.checked)}
				/>
				<Trans>Looking for work</Trans>
			</label>
			{multi("profileLinks", t`Profile links`)}
			{multi("emails", t`Email addresses`)}
			{multi("phones", t`Phone numbers`)}
			{multi("tags", t`Tags`)}
			<Field label={t`How you know them`}>
				<Textarea
					maxLength={2000}
					value={draft.relationship}
					onChange={(event) => set("relationship", event.target.value)}
				/>
			</Field>
			<Field label={t`Notes`}>
				<Textarea maxLength={20_000} value={draft.notes} onChange={(event) => set("notes", event.target.value)} />
			</Field>
			<div className="grid grid-cols-2 gap-3">
				<Field label={t`Connected on`}>
					<Input type="date" value={draft.connectedOn} onChange={(event) => set("connectedOn", event.target.value)} />
				</Field>
				<Field label={t`Last contacted`}>
					<Input
						type="date"
						value={draft.lastContactedAt}
						onChange={(event) => set("lastContactedAt", event.target.value)}
					/>
				</Field>
			</div>
			{save.isError && (
				<p role="alert" className="text-sm text-danger-text">
					{save.error.message}
				</p>
			)}
			<Button
				type="submit"
				disabled={
					save.isPending ||
					!contactFullName(draft.firstName, draft.lastName) ||
					companies.isPending ||
					companies.isError
				}
			>
				<Trans>Save</Trans>
			</Button>
		</form>
	);
}
