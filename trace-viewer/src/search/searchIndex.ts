import uFuzzy from "@leeoniya/ufuzzy";
import type { Span } from "../trace-data-loader/exportToSpans";
import { normalizeKey, normalizeQuery } from "./normalizers";

export interface IndexedAttribute {
	spanId: string;
	key: string;
	value: string;
	searchText: string;
}

export interface SearchMatch {
	spanId: string;
	spanName: string;
	spanTitle: string;
	key: string;
	value: string;
	searchText: string;
	ranges: [number, number][];
}

export function buildSearchIndex(spans: Span[]): IndexedAttribute[] {
	const index: IndexedAttribute[] = [];

	for (const span of spans) {
		for (const [key, value] of Object.entries(span.attributes)) {
			const normalizedKey = normalizeKey(key);
			const valueStr = String(value);
			const searchText = `${normalizedKey} ${valueStr}`.toLowerCase();

			index.push({
				spanId: span.id,
				key,
				value: valueStr,
				searchText,
			});
		}

		// Index special fields: kind, name, title, serviceName
		// These are searchable but don't have separate key-value display
		const specialFields = [
			{ key: "kind", value: span.kind },
			{ key: "name", value: span.name },
			{ key: "title", value: span.title },
			{ key: "serviceName", value: span.serviceName },
		];

		for (const { key, value } of specialFields) {
			const normalizedKey = normalizeKey(key);
			const searchText = `${normalizedKey} ${value}`.toLowerCase();

			index.push({
				spanId: span.id,
				key,
				value,
				searchText,
			});
		}
	}

	return index;
}

/**
 * Searches the index using uFuzzy and returns matches ordered by relevance.
 */
export function searchSpans(
	index: IndexedAttribute[],
	haystack: string[],
	query: string,
	spans: Span[],
): SearchMatch[] {
	const normalizedQuery = normalizeQuery(query);

	if (!normalizedQuery) {
		return [];
	}

	// Configure uFuzzy for good fuzzy matching
	const uf = new uFuzzy({
		intraMode: 1, // Enable fuzzy matching within words
		intraIns: 1, // Allow insertions
		intraSub: 1, // Allow substitutions
		intraTrn: 1, // Allow transpositions
		intraDel: 1, // Allow deletions
	});

	const idxs = uf.filter(haystack, normalizedQuery);

	if (!idxs || idxs.length === 0) {
		return [];
	}

	const info = uf.info(idxs, haystack, normalizedQuery);
	const order = uf.sort(info, haystack, normalizedQuery);

	const spansMap = new Map(spans.map((s) => [s.id, s]));

	const matches: SearchMatch[] = [];

	for (const orderIdx of order) {
		const idx = idxs[orderIdx];
		const indexedAttr = index[idx];
		const span = spansMap.get(indexedAttr.spanId);

		if (!span) continue;

		// Get highlight ranges - convert flat array to tuples
		// uFuzzy returns ranges as [start1, end1, start2, end2, ...]
		const flatRanges = info.ranges[orderIdx];
		const ranges: [number, number][] = [];
		for (let i = 0; i < flatRanges.length; i += 2) {
			ranges.push([flatRanges[i], flatRanges[i + 1]]);
		}

		matches.push({
			spanId: indexedAttr.spanId,
			spanName: span.name,
			spanTitle: span.title,
			key: indexedAttr.key,
			value: indexedAttr.value,
			searchText: indexedAttr.searchText,
			ranges,
		});
	}

	return matches;
}

export function buildHaystack(index: IndexedAttribute[]): string[] {
	return index.map((attr) => attr.searchText);
}
