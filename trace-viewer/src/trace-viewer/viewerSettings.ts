import { type Accessor, createSignal } from "solid-js";

/**
 * What the step viewer shows above its controls: one big screenshot of the
 * moment, or a filmstrip with a row of frames per page.
 */
export type PlayerScreen = "big-screen" | "filmstrip";

export const PLAYER_SCREENS: readonly PlayerScreen[] = [
	"big-screen",
	"filmstrip",
];

export const PLAYER_SCREEN_LABELS: Record<PlayerScreen, string> = {
	"big-screen": "Big screen",
	filmstrip: "Filmstrip",
};

/** Which parts of the trace viewer are shown, and how. Persisted per browser. */
export interface ViewerSettings {
	stepViewer: boolean;
	steps: boolean;
	browser: boolean;
	external: boolean;
	playerScreen: PlayerScreen;
}

export type ViewerSettingKey = keyof ViewerSettings;

/** The settings that show or hide a section of the viewer */
export type ViewerSectionKey = {
	[Key in ViewerSettingKey]: ViewerSettings[Key] extends boolean ? Key : never;
}[ViewerSettingKey];

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
	stepViewer: true,
	steps: true,
	browser: true,
	external: true,
	playerScreen: "big-screen",
};

export const VIEWER_SETTING_LABELS: Record<ViewerSectionKey, string> = {
	stepViewer: "Step viewer",
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
		const values = parsed as Record<string, unknown>;
		const settings = { ...DEFAULT_VIEWER_SETTINGS };
		for (const key of Object.keys(
			VIEWER_SETTING_LABELS,
		) as ViewerSectionKey[]) {
			const value = values[key];
			if (typeof value === "boolean") settings[key] = value;
		}
		const screen = PLAYER_SCREENS.find((name) => name === values.playerScreen);
		if (screen) settings.playerScreen = screen;
		return settings;
	} catch {
		return DEFAULT_VIEWER_SETTINGS;
	}
}

export type SetViewerSetting = <Key extends ViewerSettingKey>(
	key: Key,
	value: ViewerSettings[Key],
) => void;

/**
 * @param initial Settings chosen for this page load (e.g. by the URL). They
 * are used instead of the saved settings, and later changes are kept in
 * memory only, so they never overwrite the settings saved in the browser.
 */
export function createViewerSettings(initial?: ViewerSettings): {
	settings: Accessor<ViewerSettings>;
	setSetting: SetViewerSetting;
} {
	const [settings, setSettings] = createSignal(
		initial ?? parseViewerSettings(readStoredSettings()),
	);

	const setSetting: SetViewerSetting = (key, value) => {
		const next = { ...settings(), [key]: value };
		setSettings(next);
		if (initial) return;
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
