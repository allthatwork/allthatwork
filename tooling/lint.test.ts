import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("..", import.meta.url));

function lint(directory: string) {
	const result = spawnSync(
		process.execPath,
		[join(root, "node_modules/vite-plus/bin/vp"), "lint", "--format=json", directory],
		{ cwd: root, encoding: "utf8" },
	);
	const diagnostics = JSON.parse(result.stdout).diagnostics as { code: string; filename: string }[];
	return { status: result.status, diagnostics };
}

it("blocks private workspace paths in imports, re-exports, and dynamic imports", () => {
	const directory = mkdtempSync(join(tmpdir(), "reactive-resume-lint-"));
	try {
		const sources = [
			"@reactive-resume/schema/src/resume/data",
			"../../packages/schema/src/resume/data",
			"packages/schema/resume/data",
		];
		let index = 0;
		for (const source of sources) {
			for (const statement of [
				`import "${source}";`,
				`export { value } from "${source}";`,
				`export * from "${source}";`,
				`export type { Value } from "${source}";`,
				`export const load = () => import("${source}");`,
			]) {
				writeFileSync(join(directory, `${index++}.ts`), statement);
			}
		}
		writeFileSync(
			join(directory, "public.ts"),
			'export { resumeDataSchema } from "@reactive-resume/schema/resume/data";',
		);
		const { status, diagnostics } = lint(directory);
		const restricted = diagnostics.filter((diagnostic) => diagnostic.code === "eslint(no-restricted-imports)");
		expect(status).toBe(1);
		expect(new Set(restricted.map((diagnostic) => diagnostic.filename)).size).toBe(index);
		expect(diagnostics.some((diagnostic) => diagnostic.filename.endsWith("public.ts"))).toBe(false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it("allows only type imports from the server API in mobile code", () => {
	const directory = mkdtempSync(join(root, "apps/mobile/lint-fixture-"));
	try {
		writeFileSync(join(directory, "runtime.ts"), 'export { default as router } from "@reactive-resume/api/routers";');
		writeFileSync(
			join(directory, "types.ts"),
			'export type { default as Router } from "@reactive-resume/api/routers";',
		);
		const { status, diagnostics } = lint(directory);
		expect(status).toBe(1);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			code: "eslint(no-restricted-imports)",
			filename: expect.stringContaining("runtime.ts"),
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
