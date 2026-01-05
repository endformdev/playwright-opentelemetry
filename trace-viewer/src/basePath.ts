/**
 * Detects the base path of the application at runtime.
 * Always returns a path with a trailing slash.
 *
 * If the app is served from /trace-viewer/index.html, this returns '/trace-viewer/'
 * If served from root, returns '/'
 */
export function getBasePath(): string {
	// In browser, detect from current location
	if (typeof window !== "undefined") {
		// Get the path without any query params or hash
		const path = window.location.pathname;

		let basePath: string;

		// Find the last segment that looks like a file or the root
		// If path ends with / or /index.html, that's our base
		if (path.endsWith("/")) {
			basePath = path;
		} else if (path.endsWith("/index.html")) {
			basePath = path.slice(0, -"index.html".length);
		} else if (document.baseURI) {
			// For any other path (e.g., /trace-viewer/some-route), we need to determine
			// where the app is mounted. Since we're using Vite's base: './', we can
			// detect the base from where the script was loaded from using document.baseURI
			const baseUrl = new URL(document.baseURI);
			basePath = baseUrl.pathname;
		} else {
			// Fallback: assume we're at the directory containing the current path
			const lastSlash = path.lastIndexOf("/");
			if (lastSlash > 0) {
				basePath = path.slice(0, lastSlash + 1);
			} else {
				basePath = "/";
			}
		}

		// Ensure the base path always ends with a trailing slash
		// This is required for service worker scope registration
		return basePath.endsWith("/") ? basePath : `${basePath}/`;
	}

	return "/";
}

export function resolveBasePath(path: string): string {
	const base = getBasePath();
	// Ensure base ends with /
	const normalizedBase = base.endsWith("/") ? base : `${base}/`;
	// Ensure path doesn't start with / since we're appending to base
	const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
	return `${normalizedBase}${normalizedPath}`;
}
