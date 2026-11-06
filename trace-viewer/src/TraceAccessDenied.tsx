import type { TraceAccessFailure } from "./trace-info-loader";

export interface TraceAccessDeniedProps {
	failure: TraceAccessFailure;
	onLoadAnother: () => void;
}

const GET_A_NEW_LINK = "Ask for a new link from wherever you got this one.";

const expiryFormat = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	timeZoneName: "short",
});

export function TraceAccessDenied(props: TraceAccessDeniedProps) {
	const copy = () => accessDeniedCopy(props.failure);

	return (
		<div class="flex-1 flex items-center justify-center px-4">
			<div class="w-full max-w-md text-center">
				<h1 class="text-xl font-semibold tracking-tight text-gray-900">
					{copy().title}
				</h1>
				<p class="mt-3 text-sm text-gray-600">{copy().explanation}</p>
				<p class="mt-1 text-sm text-gray-600">{GET_A_NEW_LINK}</p>
				<button
					type="button"
					class="mt-6 text-sm font-medium text-gray-500 underline underline-offset-2 hover:text-gray-900"
					onClick={props.onLoadAnother}
				>
					Load a different trace
				</button>
			</div>
		</div>
	);
}

function accessDeniedCopy(failure: TraceAccessFailure): {
	title: string;
	explanation: string;
} {
	switch (failure.code) {
		case "token_expired":
			return {
				title: "This trace link has expired",
				explanation: expiryExplanation(failure.expiredAt),
			};
		case "token_invalid":
			return {
				title: "This trace link isn't valid",
				explanation: "The trace server didn't accept the link's access token.",
			};
		case "token_missing":
			return {
				title: "You don't have access to this trace",
				explanation:
					"The trace server needs an access token, and this link doesn't have one.",
			};
	}
}

function expiryExplanation(expiredAt: Date | null): string {
	const limit = "For security, trace links only work for a limited time.";
	if (!expiredAt) return limit;
	return `${limit} This one expired on ${expiryFormat.format(expiredAt)}.`;
}
