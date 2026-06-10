import type { Entry, FileEntry } from "@zip.js/zip.js";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import {
	mergeOtlpExports,
	parseOtlpExport,
	type OtlpExport,
} from "../trace-data-loader";
import {
	EMPTY_RRWEB_TRACE,
	parseRrwebEvents,
	parseRrwebManifest,
	type RrwebRecording,
	type RrwebTrace,
} from "./rrwebRecording";

export interface TraceZipData {
	traceData: OtlpExport;
	rrweb: RrwebTrace;
}

export async function loadTraceZipData(zip: Blob): Promise<TraceZipData> {
	const zipReader = new ZipReader(new BlobReader(zip));
	try {
		const entries = await zipReader.getEntries();
		const files = entries.filter(isFileEntry);
		return {
			traceData: await loadOtlpTraceData(files),
			rrweb: await loadRrwebTrace(files),
		};
	} finally {
		await zipReader.close();
	}
}

export async function loadRrwebZipData(zip: Blob): Promise<RrwebTrace> {
	const zipReader = new ZipReader(new BlobReader(zip));
	try {
		return await loadRrwebTrace(
			(await zipReader.getEntries()).filter(isFileEntry),
		);
	} finally {
		await zipReader.close();
	}
}

async function loadOtlpTraceData(files: FileEntry[]): Promise<OtlpExport> {
	const traceFiles = files.filter(
		(entry) =>
			entry.filename.startsWith("traces/") && entry.filename.endsWith(".json"),
	);
	if (traceFiles.length === 0) {
		throw new Error("Trace ZIP does not contain any traces/*.json files");
	}

	const payloads = await Promise.all(
		traceFiles.map(async (entry) =>
			parseOtlpExport(JSON.parse(await readText(entry))),
		),
	);
	return mergeOtlpExports(payloads);
}

async function loadRrwebTrace(files: FileEntry[]): Promise<RrwebTrace> {
	const manifestEntry = files.find(
		(entry) => entry.filename === "rrweb/manifest.json",
	);
	if (!manifestEntry) {
		return EMPTY_RRWEB_TRACE;
	}

	const manifest = parseRrwebManifest(
		JSON.parse(await readText(manifestEntry)),
	);
	const recordings: RrwebRecording[] = [];
	for (const recording of manifest.recordings) {
		const events = (
			await Promise.all(
				recording.segments.map(async (segment) => {
					const entry = files.find((file) => file.filename === segment.file);
					if (!entry) {
						throw new Error(`rrweb segment not found: ${segment.file}`);
					}
					return parseRrwebEvents(
						JSON.parse(await readText(entry)),
						segment.file,
					);
				}),
			)
		).flat();
		events.sort((a, b) => a.timestamp - b.timestamp);
		recordings.push({
			id: recording.id,
			pageId: recording.pageId,
			startTime: events[0]?.timestamp ?? recording.startTime,
			endTime: events.at(-1)?.timestamp ?? recording.endTime,
			initialUrl: recording.initialUrl,
			events,
			warnings: recording.warnings,
		});
	}

	recordings.sort((a, b) => a.startTime - b.startTime);
	return { recordings, warnings: manifest.warnings };
}

async function readText(entry: FileEntry): Promise<string> {
	return entry.getData(new TextWriter());
}

function isFileEntry(entry: Entry): entry is FileEntry {
	return !entry.directory;
}
