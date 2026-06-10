import { Field } from "@ark-ui/solid/field";
import {
	FileUpload,
	type FileUploadFileAcceptDetails,
	type FileUploadFileError,
	type FileUploadFileRejectDetails,
} from "@ark-ui/solid/file-upload";
import { createSignal, For, Show } from "solid-js";
import { parseTraceSourceQuery, type TraceSourceSetter } from "./trace-source";

const ZIP_ACCEPT = ".zip,application/zip,application/x-zip-compressed";

const fileErrorMessages: Record<FileUploadFileError, string> = {
	TOO_MANY_FILES: "Select one trace ZIP file at a time.",
	FILE_INVALID_TYPE: "Select a Playwright OpenTelemetry trace ZIP file.",
	FILE_TOO_LARGE: "The trace ZIP file is too large.",
	FILE_TOO_SMALL: "The trace ZIP file is empty.",
	FILE_INVALID: "Select a valid trace ZIP file.",
	FILE_EXISTS: "That trace ZIP file is already selected.",
};

function isZipFile(file: File): boolean {
	return (
		file.name.toLowerCase().endsWith(".zip") ||
		file.type === "application/zip" ||
		file.type === "application/x-zip-compressed"
	);
}

function fileErrorText(error: FileUploadFileError): string {
	return fileErrorMessages[error] ?? String(error);
}

export function NoTraceLoaded(props: { setTraceSource: TraceSourceSetter }) {
	const [apiUrl, setApiUrl] = createSignal("");
	const [fileError, setFileError] = createSignal("");
	const [apiError, setApiError] = createSignal("");

	const handleFileAccept = (details: FileUploadFileAcceptDetails) => {
		const file = details.files[0];
		if (!file) return;

		setFileError("");
		props.setTraceSource({ kind: "local-zip", file });
	};

	const handleFileReject = (details: FileUploadFileRejectDetails) => {
		const firstError = details.files[0]?.errors[0];
		setFileError(
			firstError ? fileErrorText(firstError) : "Select a trace ZIP file.",
		);
	};

	const handleApiLoad = () => {
		const url = apiUrl().trim();
		if (!url) {
			setApiError("Enter a trace API URL or trace ZIP URL.");
			return;
		}

		const source = parseTraceSourceQuery(url);
		if (!source) {
			setApiError("Enter a trace API URL or trace ZIP URL.");
			return;
		}

		setApiError("");
		props.setTraceSource(source);
	};

	const handleApiKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Enter") {
			handleApiLoad();
		}
	};

	return (
		<div class="flex-1 flex items-center justify-center px-4">
			<div class="w-full max-w-xl text-center space-y-5">
				<div class="text-2xl font-light text-gray-400">
					Load a Playwright OpenTelemetry trace
				</div>

				<Field.Root invalid={Boolean(fileError())}>
					<FileUpload.Root
						accept={ZIP_ACCEPT}
						maxFiles={1}
						invalid={Boolean(fileError())}
						onFileAccept={handleFileAccept}
						onFileReject={handleFileReject}
						validate={(file) =>
							isZipFile(file) ? null : ["FILE_INVALID_TYPE"]
						}
					>
						<FileUpload.Label class="sr-only">Trace ZIP file</FileUpload.Label>
						<FileUpload.Dropzone
							disableClick
							class="rounded-lg border border-dashed border-gray-600 bg-gray-900/30 px-6 py-10 text-gray-400 transition-colors data-[dragging]:border-blue-400 data-[dragging]:bg-blue-900/20 data-[invalid]:border-red-500"
						>
							<div class="space-y-3">
								<div class="text-xl font-light">Drop trace ZIP file here</div>
								<div class="text-sm text-gray-500">or</div>
								<FileUpload.Trigger class="inline-flex px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded cursor-pointer transition-colors text-white">
									Select file
								</FileUpload.Trigger>
							</div>
						</FileUpload.Dropzone>
						<FileUpload.Context>
							{(context) => (
								<Show when={context().rejectedFiles.length > 0}>
									<FileUpload.ItemGroup class="mt-3 space-y-1 text-sm text-red-400">
										<For each={context().rejectedFiles}>
											{(fileRejection) => (
												<FileUpload.Item file={fileRejection.file}>
													<FileUpload.ItemName class="font-medium" />
													<For each={fileRejection.errors}>
														{(error) => <div>{fileErrorText(error)}</div>}
													</For>
												</FileUpload.Item>
											)}
										</For>
									</FileUpload.ItemGroup>
								</Show>
							)}
						</FileUpload.Context>
						<FileUpload.HiddenInput />
					</FileUpload.Root>
					<Field.HelperText class="mt-2 block text-sm text-gray-500">
						Upload a local Playwright OpenTelemetry trace ZIP.
					</Field.HelperText>
					<Field.ErrorText class="mt-2 block text-sm text-red-400">
						{fileError()}
					</Field.ErrorText>
				</Field.Root>

				<div class="text-gray-500">or</div>

				<Field.Root invalid={Boolean(apiError())}>
					<Field.Label class="sr-only">Trace API or ZIP URL</Field.Label>
					<div class="flex items-start gap-2 justify-center">
						<Field.Input
							type="text"
							placeholder="Enter API URL..."
							class="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-80 max-w-full text-gray-900 data-[invalid]:border-red-500"
							value={apiUrl()}
							onInput={(event) => {
								setApiUrl(event.currentTarget.value);
								if (apiError()) setApiError("");
							}}
							onKeyDown={handleApiKeyDown}
						/>
						<button
							type="button"
							class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors text-white disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={handleApiLoad}
							disabled={!apiUrl().trim()}
						>
							Load
						</button>
					</div>
					<Field.HelperText class="mt-2 block text-sm text-gray-500">
						Enter a trace API URL, or a URL ending in .zip.
					</Field.HelperText>
					<Field.ErrorText class="mt-2 block text-sm text-red-400">
						{apiError()}
					</Field.ErrorText>
				</Field.Root>
			</div>
		</div>
	);
}
