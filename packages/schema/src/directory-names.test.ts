import { describe, expect, it } from "vitest";
import {
	cleanImportedText,
	contactNames,
	contactSortKey,
	directoryLetter,
	groupCompanies,
	groupContacts,
	sortContacts,
} from "./directory-names";

describe("cleanImportedText", () => {
	it("removes emoji, skin tones, joiners and variation selectors", () => {
		expect(cleanImportedText("🚀 Dana")).toBe("Dana");
		expect(cleanImportedText("Dana 👋🏽")).toBe("Dana");
		expect(cleanImportedText("👩‍💻 Dana")).toBe("Dana");
		expect(cleanImportedText("Dana ❤️ Code")).toBe("Dana Code");
		expect(cleanImportedText("Dana 🇺🇸")).toBe("Dana");
	});
	it("removes decorative symbols and keeps credentials' letters", () => {
		expect(cleanImportedText("Marek MBA, MST, CTP®")).toBe("Marek MBA, MST, CTP");
		expect(cleanImportedText("Acme™ Labs")).toBe("Acme Labs");
		expect(cleanImportedText("© Northwind")).toBe("Northwind");
		expect(cleanImportedText("★ Staff Engineer ✓")).toBe("Staff Engineer");
	});
	it("turns fancy letters into plain ones", () => {
		expect(cleanImportedText("𝗝𝗼𝗵𝗻")).toBe("John");
		expect(cleanImportedText("Ｊｏｈｎ")).toBe("John");
	});
	it("keeps letters in any script, accents, digits and punctuation", () => {
		expect(cleanImportedText("Zoë O'Brien-Núñez")).toBe("Zoë O'Brien-Núñez");
		expect(cleanImportedText("Lee (Kim)")).toBe("Lee (Kim)");
		expect(cleanImportedText("Menon, PMP")).toBe("Menon, PMP");
		expect(cleanImportedText("John A.")).toBe("John A.");
		expect(cleanImportedText("山田 太郎")).toBe("山田 太郎");
		expect(cleanImportedText("Иван")).toBe("Иван");
		expect(cleanImportedText("Level 3 Engineer")).toBe("Level 3 Engineer");
	});
	it("collapses spaces and trims", () => {
		expect(cleanImportedText("  Mary   Ann ")).toBe("Mary Ann");
	});
	it("keeps the original when cleaning would empty the field", () => {
		expect(cleanImportedText("🚀🚀")).toBe("🚀🚀");
		expect(cleanImportedText(" ★ ")).toBe("★");
	});
});

describe("contactNames", () => {
	it("builds the full name from first and last", () => {
		expect(contactNames({ firstName: " Jan ", lastName: "de Vries" })).toEqual({
			firstName: "Jan",
			lastName: "de Vries",
			name: "Jan de Vries",
		});
		expect(contactNames({ firstName: "Teodora", lastName: "" })).toMatchObject({ name: "Teodora" });
	});
	it("stores a lone name as the first name", () => {
		expect(contactNames({ name: "Casey Nguyen" })).toEqual({
			firstName: "Casey Nguyen",
			lastName: "",
			name: "Casey Nguyen",
		});
	});
	it("prefers first and last name over a name", () => {
		expect(contactNames({ name: "Ignored", firstName: "Jan", lastName: "Kowalski" })).toMatchObject({
			name: "Jan Kowalski",
		});
	});
	it("keeps the other part on a partial update, and nothing changes without names", () => {
		const current = { firstName: "Jan", lastName: "Kowalski" };
		expect(contactNames({ lastName: "Nowak" }, current)).toMatchObject({ firstName: "Jan", name: "Jan Nowak" });
		expect(contactNames({}, current)).toBeNull();
		expect(contactNames({ name: "Jan Nowak" }, current)).toEqual({
			firstName: "Jan Nowak",
			lastName: "",
			name: "Jan Nowak",
		});
	});
	it("gives an empty name when there's none, for callers to reject", () => {
		expect(contactNames({})?.name).toBe("");
		expect(contactNames({ firstName: " ", lastName: "" })?.name).toBe("");
	});
});

describe("contactSortKey", () => {
	it("leaves out credentials after a comma and parenthesized parts", () => {
		expect(contactSortKey("Menon, PMP")).toBe("Menon");
		expect(contactSortKey("Marek MBA, MST, CTP")).toBe("Marek MBA");
		expect(contactSortKey("Lee (Kim)")).toBe("Lee");
		expect(contactSortKey("(Kim) Lee")).toBe("Lee");
		expect(contactSortKey("de Vries ")).toBe("de Vries");
		expect(contactSortKey("")).toBe("");
		expect(contactSortKey("(Kim)")).toBe("");
	});
});

describe("directoryLetter", () => {
	it("files accented letters under their base letter", () => {
		expect(directoryLetter("Émile")).toBe("E");
		expect(directoryLetter("Ølsen")).toBe("O");
		expect(directoryLetter("Łukasz")).toBe("L");
		expect(directoryLetter("de Vries")).toBe("D");
	});
	it("skips leading emoji, symbols and punctuation", () => {
		expect(directoryLetter("🚀 Rivera")).toBe("R");
		expect(directoryLetter("★Acme")).toBe("A");
		expect(directoryLetter("'Abbas")).toBe("A");
	});
	it("files digits and other scripts under #", () => {
		expect(directoryLetter("3M")).toBe("#");
		expect(directoryLetter("山田")).toBe("#");
		expect(directoryLetter("Иванов")).toBe("#");
		expect(directoryLetter("")).toBe("#");
	});
});

const person = (firstName: string, lastName: string) => ({
	firstName,
	lastName,
	name: [firstName, lastName].filter(Boolean).join(" "),
});

describe("groupContacts", () => {
	it("sorts by last name then first name, ignoring case and accents", () => {
		const rows = [
			person("Lena", "Costa"),
			person("Brianna", "chu"),
			person("Marcus", "Cole"),
			person("Anna", "Ćole"),
			person("Claire", "Dubois"),
			person("Jan", "de Vries"),
		];
		expect(sortContacts(rows, "en").map((row) => row.name)).toEqual([
			"Brianna chu",
			"Anna Ćole",
			"Marcus Cole",
			"Lena Costa",
			"Jan de Vries",
			"Claire Dubois",
		]);
	});
	it("groups under letters, then #, then no last name by first name", () => {
		const groups = groupContacts(
			[
				person("Teodora", ""),
				person("Sam Rivera", ""),
				person("Taro", "山田"),
				person("Priya", "Menon, PMP"),
				person("Émile", "Zola"),
				person("Andrés", "Molina"),
				person("Kim", "(Lee)"),
			],
			"en",
		);
		expect(groups.map((group) => [group.key, group.items.map((row) => row.firstName)])).toEqual([
			["M", ["Priya", "Andrés"]],
			["Z", ["Émile"]],
			["#", ["Taro"]],
			["none", ["Kim", "Sam Rivera", "Teodora"]],
		]);
	});
	it("orders numbers naturally", () => {
		expect(sortContacts([person("A", "Agent 10"), person("B", "Agent 9")], "en").map((row) => row.firstName)).toEqual([
			"B",
			"A",
		]);
	});
});

describe("groupCompanies", () => {
	it("sorts by name and files digits under #", () => {
		const groups = groupCompanies(
			[{ name: "kestrel Data" }, { name: "3M" }, { name: "Bluepeak" }, { name: "Brightline" }, { name: "Ásgard" }],
			"en",
		);
		expect(groups.map((group) => [group.key, group.items.map((row) => row.name)])).toEqual([
			["A", ["Ásgard"]],
			["B", ["Bluepeak", "Brightline"]],
			["K", ["kestrel Data"]],
			["#", ["3M"]],
		]);
	});
});
