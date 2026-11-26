const warnings = new Set<string>();

/** Warns once per worker: the same fallback applies to every test. */
export function warnOnce(key: string, message: string): void {
	if (warnings.has(key)) {
		return;
	}
	warnings.add(key);
	console.warn(message);
}
