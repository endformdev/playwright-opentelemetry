import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

test("expected failing step trace", async () => {
	test.fail();

	await test.step("Failing checkout step", async () => {
		expect("submitted").toBe("confirmed");
	});
});
