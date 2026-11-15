import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";

// All That Work doesn't build or ship upstream's native app (FORK.md, "Mobile app excluded").
it("keeps the native app out of the pnpm workspace", async () => {
	const workspace = await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
	const lockfile = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");

	expect(workspace).toContain('- "!apps/mobile"');
	expect(workspace).toMatch(/^allowUnusedPatches: true$/m);
	expect(lockfile, "Run pnpm install to drop the native app from the lockfile.").not.toMatch(
		/^ {2}(apps\/mobile|packages\/forme-native):$/m,
	);
});
