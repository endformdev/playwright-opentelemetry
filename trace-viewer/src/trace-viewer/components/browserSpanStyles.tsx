import Braces from "lucide-solid/icons/braces";
import Brush from "lucide-solid/icons/brush";
import Code from "lucide-solid/icons/code";
import File from "lucide-solid/icons/file";
import FileText from "lucide-solid/icons/file-text";
import Film from "lucide-solid/icons/film";
import Image from "lucide-solid/icons/image";
import Type from "lucide-solid/icons/type";

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

export function getResourceDisplayName(span: Span): string {
	const urlPath = span.attributes["url.path"];
	if (typeof urlPath === "string") {
		const segments = urlPath.split("/").filter(Boolean);
		return segments[segments.length - 1] || urlPath;
	}
	return span.title;
}

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

export function getResourceColor(resourceType: ResourceType): string {
	// chrome devtools style colors
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
