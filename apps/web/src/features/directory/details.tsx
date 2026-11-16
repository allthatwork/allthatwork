import type { RouterOutput } from "@/libs/orpc/client";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";
import { factLabelClassName, factRowClassName } from "@/features/applications/components/detail/sheet-parts";
import { useConfirm } from "@/hooks/use-confirm";

type Contact = RouterOutput["directory"]["contact"]["contact"];

type DeleteActionProps = {
	/** The button's label, and the dialog's delete button. */
	label: string;
	title: string;
	description: string;
	/** The dialog's other button: what it keeps. */
	keep: string;
	onDelete: () => Promise<unknown>;
};

/** A permanent delete: one click asks in a dialog that names what goes, and a failed delete shows under the button. */
export function DeleteAction({ label, title, description, keep, onDelete }: DeleteActionProps) {
	const confirm = useConfirm();
	const mutation = useMutation({ mutationFn: onDelete });
	const ask = async () => {
		if (!(await confirm(title, { description, confirmText: label, cancelText: keep, variant: "danger" }))) return;
		mutation.mutate();
	};
	return (
		<div className="grid justify-items-start gap-2">
			<Button variant="secondary" disabled={mutation.isPending} onClick={() => void ask()}>
				{label}
			</Button>
			{mutation.isError && (
				<p role="alert" className="text-sm text-danger-text">
					{mutation.error.message}
				</p>
			)}
		</div>
	);
}

type FactProps = { label: string; children: ReactNode };
/** A labelled row, as in an application's About the job. Values stack and wrap rather than widen the page. */
function Fact({ label, children }: FactProps) {
	return (
		<div className={cn(factRowClassName, "items-baseline py-1.5")}>
			<dt className={factLabelClassName}>{label}</dt>
			<dd className="grid min-w-0 justify-items-start gap-1 [overflow-wrap:anywhere]">{children}</dd>
		</div>
	);
}

const linkClassName = "max-w-full text-accent-text underline-offset-2 hover:underline";

type ContactDetailsProps = { contact: Contact };
/** A contact's details as labelled rows, named like the Edit contact form's fields. Empty ones are left out. */
export function ContactDetails({ contact }: ContactDetailsProps) {
	return (
		<dl className="grid pt-6">
			{contact.profileLinks.length > 0 && (
				<Fact label={t`Profile links`}>
					{contact.profileLinks.map((url) => (
						<a key={url} href={url} target="_blank" rel="noreferrer" className={linkClassName}>
							{url}
						</a>
					))}
				</Fact>
			)}
			{contact.emails.length > 0 && (
				<Fact label={t`Email addresses`}>
					{contact.emails.map((email) => (
						<a key={email} href={`mailto:${email}`} className={linkClassName}>
							{email}
						</a>
					))}
				</Fact>
			)}
			{contact.phones.length > 0 && (
				<Fact label={t`Phone numbers`}>
					{contact.phones.map((phone) => (
						<a key={phone} href={`tel:${phone}`} className={linkClassName}>
							{phone}
						</a>
					))}
				</Fact>
			)}
			{contact.tags.length > 0 && <Fact label={t`Tags`}>{contact.tags.join(" · ")}</Fact>}
			{contact.relationship && (
				<Fact label={t`How you know them`}>
					<p className="whitespace-pre-wrap">{contact.relationship}</p>
				</Fact>
			)}
			{contact.notes && (
				<Fact label={t`Notes`}>
					<p className="whitespace-pre-wrap">{contact.notes}</p>
				</Fact>
			)}
			{contact.connectedOn && <Fact label={t`Connected on`}>{contact.connectedOn}</Fact>}
			<Fact label={t`Last contacted`}>
				{contact.lastContactedAt ? new Date(contact.lastContactedAt).toISOString().slice(0, 10) : t`Not recorded`}
			</Fact>
		</dl>
	);
}
