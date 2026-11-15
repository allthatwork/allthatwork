import type { Palette, ResolvedTheme } from "@/libs/theme";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { cn } from "@reactive-resume/utils/style";
import { useTheme } from "@/features/theme/provider";
import { paletteMap } from "@/libs/theme";

const PALETTES: Palette[] = ["cobalt", "original"];

type PreviewColors = { bg: string; sunken: string; line: string; ink: string; ink3: string; accent: string };

// Each palette's own tokens (globals.css), so a tile shows that palette whichever one is applied.
const PREVIEWS = {
	cobalt: {
		light: { bg: "#F6F8FA", sunken: "#EEF1F4", line: "#D1D9E0", ink: "#1F2328", ink3: "#59636E", accent: "#0969DA" },
		dark: { bg: "#0D1117", sunken: "#010409", line: "#30363D", ink: "#F0F6FC", ink3: "#9198A1", accent: "#1F6FEB" },
	},
	original: {
		light: { bg: "#F8F7F3", sunken: "#F0EFEB", line: "#DFDEDA", ink: "#1C1B15", ink3: "#6D6C65", accent: "#0067E0" },
		dark: { bg: "#100F0C", sunken: "#0B0A08", line: "#2C2B27", ink: "#EFEEEB", ink3: "#979590", accent: "#4D9FFF" },
	},
} satisfies Record<Palette, Record<ResolvedTheme, PreviewColors>>;

/** Cobalt and Original as two tiles with a small preview in the current appearance; the choice applies at once. */
export function PaletteTiles() {
	const { i18n } = useLingui();
	const { palette, setPalette, resolvedTheme } = useTheme();

	return (
		<fieldset className="mt-3 grid gap-3 sm:grid-cols-2">
			<legend className="sr-only">{t`Palette`}</legend>
			{PALETTES.map((option) => {
				const checked = palette === option;
				const colors = PREVIEWS[option][resolvedTheme];
				return (
					<label
						key={option}
						className={cn(
							// The theme tiles' look (Calm): a raised tile with an inset hairline, accent-soft with a 2px ring when chosen.
							"grid cursor-pointer gap-2.5 rounded-lg bg-raised p-3 shadow-[inset_0_0_0_1px_var(--line-2)] transition-[background-color,box-shadow] duration-quick hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-accent",
							checked && "bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)] hover:bg-accent-soft",
						)}
					>
						<input
							type="radio"
							name="palette"
							value={option}
							className="sr-only"
							checked={checked}
							onChange={() => setPalette(option)}
						/>
						<PalettePreview colors={colors} />
						<span className="grid gap-0.5 px-0.5">
							<span className="text-sm/5 font-semibold text-ink">{i18n.t(paletteMap[option].name)}</span>
							<span className="text-[13px]/[18px] text-ink-3">{i18n.t(paletteMap[option].description)}</span>
						</span>
					</label>
				);
			})}
		</fieldset>
	);
}

type PalettePreviewProps = { colors: PreviewColors };

/** A sidebar, two lines of text and a button, drawn in the palette's colors. */
function PalettePreview({ colors }: PalettePreviewProps) {
	return (
		<span
			aria-hidden="true"
			className="flex h-16 overflow-hidden rounded-md border"
			style={{ backgroundColor: colors.bg, borderColor: colors.line }}
		>
			<span className="w-1/5 border-e" style={{ backgroundColor: colors.sunken, borderColor: colors.line }} />
			<span className="flex flex-1 flex-col gap-1.5 p-2.5">
				<span className="h-1.5 w-1/3 rounded-full" style={{ backgroundColor: colors.ink }} />
				<span className="h-1.5 w-1/2 rounded-full opacity-70" style={{ backgroundColor: colors.ink3 }} />
				<span className="mt-auto h-3.5 w-10 self-end rounded-full" style={{ backgroundColor: colors.accent }} />
			</span>
		</span>
	);
}
