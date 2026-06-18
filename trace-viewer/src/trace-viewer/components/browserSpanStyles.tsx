import Braces from "lucide-solid/icons/braces";
import Brush from "lucide-solid/icons/brush";
import Code from "lucide-solid/icons/code";
import File from "lucide-solid/icons/file";
import FileText from "lucide-solid/icons/file-text";
import Film from "lucide-solid/icons/film";
import Image from "lucide-solid/icons/image";
import PanelTop from "lucide-solid/icons/panel-top";
import Type from "lucide-solid/icons/type";

import type { JSX } from "solid-js";
import type { Span } from "../../trace-data-loader/exportToSpans";

export type ResourceType =
	| "page"
	| "route"
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
		if (getResourceType(span) === "page" || getResourceType(span) === "route") {
			return urlPath;
		}

		const segments = urlPath.split("/").filter(Boolean);
		return segments[segments.length - 1] || urlPath;
	}
	return span.title;
}

export function getResourceType(span: Span): ResourceType {
	if (span.attributes["browser.resource.type"] === "page") {
		return "page";
	}
	if (span.attributes["browser.resource.type"] === "route") {
		return "route";
	}

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
		page: "#7484f5", // Soft periwinkle
		route: "#5b6ee1", // Indigo
		document: "#4285f4", // Blue
		stylesheet: "#34a853", // Green
		image: "#9c27b0", // Purple
		script: "#e2b429",
		fetch: "#eb7820",
		font: "#0fa599", // Teal
		media: "#09a1c7", // Teal
		other: "#808080", // Gray
	};
	return colors[resourceType];
}

export function getResourceIcon(
	resourceType: ResourceType,
	size = 14,
): JSX.Element {
	const iconProps = { size, class: "flex-shrink-0" };
	switch (resourceType) {
		case "page":
		case "route":
			return <PanelTop {...iconProps} />;
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
