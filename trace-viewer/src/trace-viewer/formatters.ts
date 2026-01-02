export function formatDuration(ms: number): string {
	if (ms < 1) {
		return `${(ms * 1000).toFixed(0)}µs`;
	}
	if (ms < 1000) {
		return `${ms.toFixed(1)}ms`;
	}
	if (ms < 60000) {
		return `${(ms / 1000).toFixed(2)}s`;
	}
	const minutes = Math.floor(ms / 60000);
	const seconds = ((ms % 60000) / 1000).toFixed(1);
	return `${minutes}m ${seconds}s`;
}

export function formatAttributeValue(value: string | number | boolean): string {
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (typeof value === "number") {
		return String(value);
	}
	// Truncate very long strings
	if (value.length > 200) {
		return `${value.slice(0, 200)}...`;
	}
	return value;
}
