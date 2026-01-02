export function normalizeKey(key: string): string {
	return key.replace(/[._]/g, " ").toLowerCase();
}

export function normalizeQuery(query: string): string {
	return query
		.replace(/:/g, "") // Remove colons
		.replace(/\s+/g, " ") // Collapse whitespace
		.trim()
		.toLowerCase();
}
