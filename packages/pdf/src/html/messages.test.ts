import { describe, expect, it } from "vite-plus/test";
import { APP_NAME } from "@reactive-resume/utils/brand";
import { webPageMessages } from "./messages";

describe("webPageMessages", () => {
	it("names this instance's product in the footer credit, in English and in translations", () => {
		expect(webPageMessages("en-US").credit).toBe(`Made with ${APP_NAME}`);
		for (const locale of ["de-DE", "fr-FR", "ar-SA"]) {
			const { credit } = webPageMessages(locale);
			expect(credit, locale).toContain(APP_NAME);
			expect(credit, locale).not.toContain("Reactive Resume");
		}
	});
});
