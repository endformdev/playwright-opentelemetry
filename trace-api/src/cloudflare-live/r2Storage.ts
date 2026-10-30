import type { TraceStorage } from "../storage/s3";
import type { LiveTraceBucket } from "./createLiveTraceApi";

/**
 * TraceStorage backed by an R2 bucket binding, for Workers that serve static
 * traces next to live ones.
 */
export function createR2Storage(bucket: LiveTraceBucket): TraceStorage {
	return {
		async put(path, data, contentType) {
			await bucket.put(path, data, { httpMetadata: { contentType } });
		},
		async get(path) {
			const object = await bucket.get(path);
			return object ? object.arrayBuffer() : null;
		},
		async head(path) {
			return (await bucket.head(path)) !== null;
		},
		async list(prefix) {
			const keys: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await bucket.list({ prefix, cursor });
				keys.push(...page.objects.map((object) => object.key));
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
			return keys.sort();
		},
	};
}
