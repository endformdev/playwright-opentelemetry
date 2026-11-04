/**
 * The first Playwright version whose screencast frames carry the browser's
 * presentation timestamp (1.61) and viewport size (1.60), and whose browsers
 * report new contexts (1.60).
 *
 * From this version, screenshots only come from the fixture's screencast
 * capture: tests without the fixture get none. Before it, the fixture
 * captures nothing and the reporter reads screenshots from Playwright's
 * trace.zip (see reporter/legacy/). Once the peer dependency requires this
 * version, delete this module and that legacy path.
 */
export const SCREENCAST_SCREENSHOTS_MIN_PLAYWRIGHT_VERSION = "1.61.0";

/** Whether this Playwright version's screencast can provide screenshots. */
export function supportsScreencastScreenshots(
	playwrightVersion: string,
): boolean {
	const version = parseVersion(playwrightVersion);
	const minimum = parseVersion(SCREENCAST_SCREENSHOTS_MIN_PLAYWRIGHT_VERSION);
	if (!version || !minimum) {
		return false;
	}
	for (let index = 0; index < minimum.length; index++) {
		if (version[index] !== minimum[index]) {
			return version[index] > minimum[index];
		}
	}
	return true;
}

/**
 * Major, minor and patch of a version such as "1.61.0" or "1.61.0-next".
 * Prereleases count as their release: 1.61.0-next already has the API.
 */
function parseVersion(version: string): [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	return match
		? [Number(match[1]), Number(match[2]), Number(match[3])]
		: undefined;
}
