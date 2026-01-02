import {
	Braces,
	Brush,
	Code,
	File,
	FileText,
	Film,
	Image,
	Type,
} from "lucide-solid";
import type { JSX } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";

export type ResourceType =
	| "document"
	| "stylesheet"
	| "image"
	| "script"
	| "fetch"
	| "font"
	| "media"
	| "other";

/**
 * Extract display name from browser span (last segment of URL path).
 */
export function getResourceDisplayName(span: Span): string {
	const urlPath = span.attributes["url.path"];
	if (typeof urlPath === "string") {
		const segments = urlPath.split("/").filter(Boolean);
		return segments[segments.length - 1] || urlPath;
	}
	return span.title;
}

/**
 * Determine resource type from span attributes.
 */
export function getResourceType(span: Span): ResourceType {
	const resourceType = span.attributes["http.resource.type"];
	if (typeof resourceType === "string") {
		switch (resourceType) {
			case "document":
				return "document";
			case "stylesheet":
				return "stylesheet";
			case "image":
				return "image";
			case "script":
				return "script";
			case "fetch":
			case "xhr":
				return "fetch";
			case "font":
				return "font";
			case "media":
				return "media";
			default:
				return "other";
		}
	}
	return "other";
}

/**
 * Get Chrome DevTools-style color for resource type.
 */
export function getResourceColor(resourceType: ResourceType): string {
	const colors: Record<ResourceType, string> = {
		document: "#4285f4", // Blue
		stylesheet: "#34a853", // Green
		image: "#9c27b0", // Purple
		script: "#f5a623", // Orange
		fetch: "#fbbc04", // Yellow
		font: "#ea4335", // Red
		media: "#00bcd4", // Teal
		other: "#9e9e9e", // Gray
	};
	return colors[resourceType];
}

/**
 * Get Lucide icon for resource type.
 */
export function getResourceIcon(
	resourceType: ResourceType,
	size = 14,
): JSX.Element {
	const iconProps = { size, class: "flex-shrink-0" };
	switch (resourceType) {
		case "document":
			return <FileText {...iconProps} />;
		case "stylesheet":
			return <Brush {...iconProps} />;
		case "image":
			return <Image {...iconProps} />;
		case "script":
			return <Code {...iconProps} />;
		case "fetch":
			return <Braces {...iconProps} />;
		case "font":
			return <Type {...iconProps} />;
		case "media":
			return <Film {...iconProps} />;
		case "other":
			return <File {...iconProps} />;
	}
}
