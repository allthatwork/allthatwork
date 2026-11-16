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
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { CompanyBoards, WatchSuggestions } from "./boards";
import { ContactDetails, DeleteAction } from "./details";
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
import { FilterBar, FilterField } from "@/components/calm/filter-bar";
import { List, ListRow } from "@/components/calm/list-row";
import { Page, PageBody, RootHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { StageDot } from "@/components/calm/stage-dot";
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
		<Page>
			{/* Full width (fork), like Documents and Applications. */}
			<PageBody className="grid max-w-none content-start gap-6">
				<div>
					<RootHeader
						title={<Trans>Directory</Trans>}
						subtitle={<Trans>Your companies and contacts, across every application.</Trans>}
					/>
					<Tabs
						value={tab}
						onValueChange={(value) =>
							void navigate({ to: "/dashboard/directory", search: { tab: value as "companies" | "contacts" } })
						}
						className="mt-5"
					>
						<TabsList variant="line" aria-label={t`Directory`} className="w-full justify-start">
							<TabsTrigger value="companies">
								<Trans>Companies</Trans>
							</TabsTrigger>
							<TabsTrigger value="contacts">
								<Trans>Contacts</Trans>
							</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>
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
			</PageBody>
		</Page>
	);
}

type FieldProps = { label: string; hint?: string | undefined; children: ReactNode };
function Field({ label, hint, children }: FieldProps) {
	const id = useId();
	return (
		<div className="grid content-start gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			{isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
				? cloneElement(children, { id, ...(hint ? { "aria-describedby": `${id}-hint` } : {}) })
				: children}
			{hint && (
				<p id={`${id}-hint`} className="text-[13px]/[18px] text-ink-3">
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
			<div role="alert" className="grid justify-items-start gap-2 text-sm">
				<p>
					<Trans>Could not load the directory.</Trans>
				</p>
				<Button variant="secondary" onClick={retry}>
					<Trans>Try again</Trans>
				</Button>
			</div>
		);
	return pending ? (
		<p role="status" className="text-sm text-ink-3">
			<Trans>Loading…</Trans>
		</p>
	) : null;
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
	const mobile = useBreakpoint() === "mobile";
	return (
		<FilterBar className="flex-nowrap pt-0">
			<FilterField
				label={label}
				icon="magnifying-glass"
				placeholder={mobile ? t`Search` : placeholder}
				value={search}
				onChange={(event) => onSearch(event.target.value)}
				className="min-w-0 flex-1 max-sm:w-auto sm:w-80 sm:flex-none"
			/>
			<Button onClick={onAdd} aria-label={add}>
				<Icon name="plus" />
				<span className="sm:hidden">
					<Trans>Add</Trans>
				</span>
				<span className="hidden sm:inline">{add}</span>
			</Button>
			{count && <span className="ms-auto hidden text-sm text-ink-3 sm:inline">{count}</span>}
			{children}
		</FilterBar>
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
				<p className="text-sm text-ink-3">
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
							<Icon name="dots-three" size={20} />
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
				<p className="text-sm text-ink-3">
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
		<section className="grid max-w-(--content-max) content-start">
			<div className="grid gap-1">
				<div className="flex items-center gap-3">
					<CompanyLogo key={company.website} name={company.name} website={company.website} size="md" />
					<h2 className="min-w-0 flex-1 truncate t-page-title">{company.name}</h2>
					<Button variant="secondary" onClick={() => setEditing(true)}>
						<Trans>Edit company</Trans>
					</Button>
				</div>
				{company.website && (
					<a
						href={company.website}
						target="_blank"
						rel="noreferrer"
						className="ms-[52px] w-fit text-sm text-accent-text underline-offset-2 hover:underline"
					>
						{domain ?? company.website}
					</a>
				)}
			</div>
			{company.notes && <p className="max-w-prose pt-4 t-body whitespace-pre-wrap text-ink-2">{company.notes}</p>}
			<SectionHeading
				note={contacts.length}
				action={
					<button type="button" onClick={() => setAdding(true)}>
						<Trans>Add contact</Trans>
					</button>
				}
			>
				<Trans>Contacts</Trans>
			</SectionHeading>
			{contacts.length > 0 ? (
				<ul className="border-t border-line">
					{shown.map((contact) => (
						<li key={contact.id} className="border-b border-line last:border-b-0">
							<ContactRow contact={contact} showCompany={false} />
						</li>
					))}
					{hidden > 0 && (
						<li>
							<button
								type="button"
								className="h-9 px-2.5 text-sm font-medium text-accent-text underline-offset-4 hover:underline"
								onClick={() => setAllContacts(true)}
							>
								{hidden === 1 ? t`Show 1 more` : t`Show ${hidden} more`}
							</button>
						</li>
					)}
				</ul>
			) : (
				<p className="text-sm text-ink-3">
					<Trans>No contacts at this company yet.</Trans>
				</p>
			)}
			<SectionHeading note={applications.length}>
				<Trans>Applications</Trans>
			</SectionHeading>
			{applications.length > 0 ? (
				<List tight cap>
					{applications.map((row) => (
						<ListRow
							key={row.id}
							render={<Link to="/dashboard/applications/$applicationId/{-$tab}" params={{ applicationId: row.id }} />}
							title={row.role}
							value={<Stage status={row.status} />}
							trailing={
								<span className="w-16 text-end text-[13px]/[18px] text-ink-3 tabular-nums">{shortDate(row.at)}</span>
							}
						/>
					))}
				</List>
			) : (
				<p className="text-sm text-ink-3">
					<Trans>No applications at this company yet.</Trans>
				</p>
			)}
			<CompanyBoards companyId={company.id} companyName={company.name} />
			<div className="pt-8">
				<DeleteAction
					label={t`Delete company`}
					title={t`Delete “${company.name}”?`}
					description={t`Its contacts and applications are kept, without their link to this company. Applications keep the company's name.`}
					keep={t`Keep company`}
					onDelete={async () => {
						await client.directory.deleteCompany({ id });
						await onDeleted();
						await refresh();
					}}
				/>
			</div>
			<CompanyEditor open={editing} company={company} onClose={() => setEditing(false)} />
			<ContactEditor open={adding} companyId={id} onClose={() => setAdding(false)} />
		</section>
	);
}

type StageProps = { status: string };
/** The application's stage as Calm writes it: its dot and its name. */
function Stage({ status }: StageProps) {
	const stage = (APPLICATION_STATUSES as readonly string[]).includes(status) ? (status as ApplicationStatus) : null;
	return stage ? <StageDot status={stage} /> : <span>{status}</span>;
}

type ApplicationLinkProps = { application: { id: string; company: string; role: string; status: string } };
function ApplicationLink({ application }: ApplicationLinkProps) {
	return (
		<Link
			to="/dashboard/applications/$applicationId/{-$tab}"
			params={{ applicationId: application.id }}
			className="w-fit [overflow-wrap:anywhere] underline-offset-2 hover:underline"
		>
			<span className="font-medium text-ink">{application.role}</span>
			<span className="text-ink-3"> · {application.company}</span>
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
		<section className="grid max-w-(--content-max) content-start">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<h2 className="t-page-title [overflow-wrap:anywhere]">{contact.name}</h2>
					<p className="text-sm text-ink-2">{contact.position}</p>
					{company && (
						<Link
							to="/dashboard/directory"
							search={{ tab: "companies", company: company.id }}
							className="w-fit text-sm text-accent-text underline-offset-2 hover:underline"
						>
							{company.name}
						</Link>
					)}
					{contact.lookingForWork && (
						<Badge variant="accent" className="w-fit">
							<Trans>Looking for work</Trans>
						</Badge>
					)}
				</div>
				<Button variant="secondary" onClick={() => setEditing(true)}>
					<Trans>Edit contact</Trans>
				</Button>
			</div>
			<ContactDetails contact={contact} />
			{employment.length > 0 && (
				<>
					<SectionHeading>
						<Trans>Company history</Trans>
					</SectionHeading>
					<List tight cap>
						{employment.map((row) => (
							<ListRow
								key={row.id}
								title={
									<>
										{[row.position, row.companyName].filter(Boolean).join(" · ")}
										{(row.startedOn || row.endedOn) && (
											<span className="font-normal text-ink-3 tabular-nums">
												{` (${row.startedOn ?? "?"} – ${row.endedOn ?? "?"})`}
											</span>
										)}
									</>
								}
							/>
						))}
					</List>
				</>
			)}
			<SectionHeading>
				<Trans>Timeline</Trans>
			</SectionHeading>
			<div className="grid gap-3">
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
				{timeline.length > 0 && (
					<ul className="border-t border-line">
						{timeline.map((row) => (
							<li key={row.id} className="grid gap-2 border-b border-line py-3 text-sm last:border-b-0">
								<time className="text-[13px]/[18px] text-ink-3" dateTime={new Date(row.at).toISOString()}>
									{format(row.at, { dateStyle: "medium", timeStyle: "short" })}
								</time>
								{row.content}
								{row.note && (
									<DeleteAction
										label={t`Delete note`}
										title={t`Delete this note?`}
										description={t`The note is deleted for good.`}
										keep={t`Keep note`}
										onDelete={async () => {
											await client.directory.deleteNote({ id: row.id });
											await refresh();
										}}
									/>
								)}
							</li>
						))}
					</ul>
				)}
				{!timeline.length && (
					<p className="text-sm text-ink-3">
						<Trans>Notes, linked applications, and interviews will appear here.</Trans>
					</p>
				)}
			</div>
			<div className="pt-8">
				<DeleteAction
					label={t`Delete contact`}
					title={t`Delete “${contact.name}”?`}
					description={t`Their notes and company history go with them, and they are removed from the applications and interviews they are linked to.`}
					keep={t`Keep contact`}
					onDelete={async () => {
						await client.directory.deleteContact({ id });
						await onDeleted();
						await refresh();
					}}
				/>
			</div>
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
			<DialogContent closeLabel={t`Close`}>
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
			<div className="flex justify-end pt-2">
				<Button type="submit" disabled={save.isPending || !name.trim()}>
					<Trans>Save</Trans>
				</Button>
			</div>
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
			<DialogContent closeLabel={t`Close`} className="sm:max-w-[560px]">
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
				<NativeSelect value={draft.companyId} onChange={(event) => set("companyId", event.target.value)}>
					<option value="">{t`No company`}</option>
					{companies.data &&
						groupCompanies(companies.data, i18n.locale)
							.flatMap((group) => group.items)
							.map((row) => (
								<option key={row.id} value={row.id}>
									{row.name}
								</option>
							))}
				</NativeSelect>
			</Field>
			<Field label={t`Position`}>
				<Input maxLength={300} value={draft.position} onChange={(event) => set("position", event.target.value)} />
			</Field>
			<Label className="w-fit cursor-pointer text-sm leading-5 font-normal text-ink">
				<Checkbox checked={draft.lookingForWork} onCheckedChange={(checked) => set("lookingForWork", checked)} />
				<Trans>Looking for work</Trans>
			</Label>
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
			<div className="flex justify-end pt-2">
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
			</div>
		</form>
	);
}
