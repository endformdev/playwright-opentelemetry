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
import type { ResourceType } from "./browserResourceStyles";

export {
	getResourceColor,
	getResourceDisplayName,
	getResourceType,
	type ResourceType,
} from "./browserResourceStyles";

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
