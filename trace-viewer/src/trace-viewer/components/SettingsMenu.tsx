import { Menu } from "@ark-ui/solid/menu";
import { Check, Settings } from "lucide-solid";
import { For } from "solid-js";
import { Portal } from "solid-js/web";
import {
	VIEWER_SETTING_LABELS,
	type ViewerSettingKey,
	type ViewerSettings,
} from "../viewerSettings";

export interface SettingsMenuProps {
	settings: ViewerSettings;
	onSettingChange: (key: ViewerSettingKey, value: boolean) => void;
}

const SETTING_KEYS = Object.keys(VIEWER_SETTING_LABELS) as ViewerSettingKey[];

export function SettingsMenu(props: SettingsMenuProps) {
	return (
		<Menu.Root
			positioning={{ placement: "bottom-end", gutter: 4, overflowPadding: 8 }}
			loopFocus={true}
		>
			<Menu.Trigger
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
				aria-label="Viewer settings"
				title="Viewer settings"
			>
				<Settings size={15} strokeWidth={2.2} aria-hidden="true" />
			</Menu.Trigger>

			<Portal>
				<Menu.Positioner>
					<Menu.Content class="mt-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg z-50">
						<Menu.ItemGroup id="viewer-sections">
							<Menu.ItemGroupLabel class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
								Show
							</Menu.ItemGroupLabel>
							<For each={SETTING_KEYS}>
								{(key) => (
									<Menu.CheckboxItem
										value={key}
										checked={props.settings[key]}
										onCheckedChange={(checked) =>
											props.onSettingChange(key, checked)
										}
										closeOnSelect={false}
										class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-700 data-[highlighted]:bg-gray-100"
									>
										<span class="flex h-4 w-4 items-center justify-center">
											<Menu.ItemIndicator>
												<Check size={14} strokeWidth={2.4} aria-hidden="true" />
											</Menu.ItemIndicator>
										</span>
										<Menu.ItemText>{VIEWER_SETTING_LABELS[key]}</Menu.ItemText>
									</Menu.CheckboxItem>
								)}
							</For>
						</Menu.ItemGroup>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	);
}
