import type { eventWithTime } from "@rrweb/types";

export interface RrwebTraceManifest {
	version: 1;
	recordings: RrwebRecordingManifest[];
	recordingOptions?: Record<string, unknown>;
	warnings?: string[];
}

export interface RrwebRecordingManifest {
	id: string;
	pageId: string;
	startTime: number;
	endTime: number;
	eventCount: number;
	initialUrl?: string;
	segments: RrwebSegmentManifest[];
	warnings?: string[];
}

export interface RrwebSegmentManifest {
	file: string;
	startTime: number;
	endTime: number;
	eventCount: number;
	hasFullSnapshot: boolean;
}

export interface RrwebRecording {
	id: string;
	pageId: string;
	startTime: number;
	endTime: number;
	initialUrl?: string;
	events: eventWithTime[];
	warnings?: string[];
}

export interface RrwebTrace {
	recordings: RrwebRecording[];
	warnings?: string[];
}

export const EMPTY_RRWEB_TRACE: RrwebTrace = { recordings: [] };

export function parseRrwebManifest(json: unknown): RrwebTraceManifest {
	if (
		!isRecord(json) ||
		json.version !== 1 ||
		!Array.isArray(json.recordings)
	) {
		throw new Error(
			"Invalid rrweb manifest: expected { version: 1, recordings }",
		);
	}

	return {
		version: 1,
		recordings: json.recordings.map(parseRecordingManifest),
		recordingOptions: isRecord(json.recordingOptions)
			? json.recordingOptions
			: undefined,
		warnings: isStringArray(json.warnings) ? json.warnings : undefined,
	};
}

export function parseRrwebEvents(json: unknown, file: string): eventWithTime[] {
	if (!Array.isArray(json) || !json.every(isRrwebEventWithTime)) {
		throw new Error(`Invalid rrweb segment ${file}: expected eventWithTime[]`);
	}
	return json;
}

function parseRecordingManifest(value: unknown): RrwebRecordingManifest {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.pageId !== "string" ||
		typeof value.startTime !== "number" ||
		typeof value.endTime !== "number" ||
		typeof value.eventCount !== "number" ||
		!Array.isArray(value.segments)
	) {
		throw new Error("Invalid rrweb manifest recording");
	}

	return {
		id: value.id,
		pageId: value.pageId,
		startTime: value.startTime,
		endTime: value.endTime,
		eventCount: value.eventCount,
		initialUrl:
			typeof value.initialUrl === "string" ? value.initialUrl : undefined,
		segments: value.segments.map(parseSegmentManifest),
		warnings: isStringArray(value.warnings) ? value.warnings : undefined,
	};
}

function parseSegmentManifest(value: unknown): RrwebSegmentManifest {
	if (
		!isRecord(value) ||
		typeof value.file !== "string" ||
		typeof value.startTime !== "number" ||
		typeof value.endTime !== "number" ||
		typeof value.eventCount !== "number" ||
		typeof value.hasFullSnapshot !== "boolean"
	) {
		throw new Error("Invalid rrweb manifest segment");
	}

	return {
		file: value.file,
		startTime: value.startTime,
		endTime: value.endTime,
		eventCount: value.eventCount,
		hasFullSnapshot: value.hasFullSnapshot,
	};
}

function isRrwebEventWithTime(value: unknown): value is eventWithTime {
	return (
		isRecord(value) &&
		typeof value.type === "number" &&
		typeof value.timestamp === "number"
	);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
