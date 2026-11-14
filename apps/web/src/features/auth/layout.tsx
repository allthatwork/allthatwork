import { Outlet } from "@tanstack/react-router";
import { Wordmark } from "@reactive-resume/ui/components/wordmark";

export function AuthLayout() {
	return (
		<div className="xs:px-0 mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-y-6 px-4 py-8">
			<Wordmark variant="stacked" height={104} className="mb-4 self-center [view-transition-name:auth-brand]" />

			<Outlet />
		</div>
	);
}
