import { type Accessor, createSignal } from "solid-js";

/** Which parts of the trace viewer are shown. Persisted per browser. */
export interface ViewerSettings {
	stepViewer: boolean;
	filmstrip: boolean;
	steps: boolean;
	browser: boolean;
	external: boolean;
}

export type ViewerSettingKey = keyof ViewerSettings;

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
	stepViewer: true,
	filmstrip: true,
	steps: true,
	browser: true,
	external: true,
};

export const VIEWER_SETTING_LABELS: Record<ViewerSettingKey, string> = {
	stepViewer: "Step viewer",
	filmstrip: "Screenshot filmstrip",
	steps: "Steps timeline",
	browser: "Browser spans",
	external: "External spans",
};

const STORAGE_KEY = "trace-viewer-settings";

export function parseViewerSettings(stored: string | null): ViewerSettings {
	if (!stored) return DEFAULT_VIEWER_SETTINGS;
	try {
		const parsed: unknown = JSON.parse(stored);
		if (typeof parsed !== "object" || parsed === null) {
			return DEFAULT_VIEWER_SETTINGS;
		}
		const settings = { ...DEFAULT_VIEWER_SETTINGS };
		for (const key of Object.keys(settings) as ViewerSettingKey[]) {
			const value = (parsed as Record<string, unknown>)[key];
			if (typeof value === "boolean") settings[key] = value;
		}
		return settings;
	} catch {
		return DEFAULT_VIEWER_SETTINGS;
	}
}

export function createViewerSettings(): {
	settings: Accessor<ViewerSettings>;
	setSetting: (key: ViewerSettingKey, value: boolean) => void;
} {
	const [settings, setSettings] = createSignal(
		parseViewerSettings(readStoredSettings()),
	);

	const setSetting = (key: ViewerSettingKey, value: boolean) => {
		const next = { ...settings(), [key]: value };
		setSettings(next);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Storage can be unavailable (private mode, quota); keep in memory.
		}
	};

	return { settings, setSetting };
}

function readStoredSettings(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}
