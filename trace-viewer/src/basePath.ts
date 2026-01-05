/**
 * Returns the base path for the application.
 * Set via VITE_TRACE_VIEWER_BASE environment variable at build time.
 * Always returns an absolute path with trailing slash.
 *
 * Examples:
 * - VITE_TRACE_VIEWER_BASE="/" -> "/"
 * - VITE_TRACE_VIEWER_BASE="/trace-viewer" -> "/trace-viewer/"
 */
export function getBasePath(): string {
	const base = import.meta.env.VITE_TRACE_VIEWER_BASE ?? "/";
	return base.endsWith("/") ? base : `${base}/`;
}

export function resolveBasePath(path: string): string {
	const base = getBasePath();
	// Ensure base ends with /
	const normalizedBase = base.endsWith("/") ? base : `${base}/`;
	// Ensure path doesn't start with / since we're appending to base
	const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
	return `${normalizedBase}${normalizedPath}`;
}
