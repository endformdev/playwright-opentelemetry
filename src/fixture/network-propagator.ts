import type { Route } from "@playwright/test";

export interface PlaywrightFixturePropagatorOptions {
	testId: string;
	outputDir: string;
	route: Route;
}

export async function playwrightFixturePropagator({
	route,
	testId,
	outputDir,
}: PlaywrightFixturePropagatorOptions) {
	return route.continue();
}
