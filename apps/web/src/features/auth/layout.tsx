import { Link, Outlet } from "@tanstack/react-router";
import { Wordmark } from "@reactive-resume/ui/components/wordmark";
import { LandingBackground } from "@/features/homepage/background";

/** The homepage's desk (grain and window light, without its scroll scenes) with the logomark leading back home. */
export function AuthLayout() {
	return (
		<div className="relative isolate min-h-svh">
			<LandingBackground />

			<div className="xs:px-0 relative mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-y-6 px-4 py-8">
				<Link to="/" className="mb-3 self-center rounded-sm p-1 transition-opacity hover:opacity-80">
					{/* The wordmark's accessible name, the app name, names the link. */}
					<Wordmark variant="stacked" height={104} className="[view-transition-name:auth-brand]" />
				</Link>

				<Outlet />
			</div>
		</div>
	);
}
