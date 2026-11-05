import {
	type Accessor,
	batch,
	createEffect,
	createSignal,
	onCleanup,
} from "solid-js";
import { useHoverContext } from "./contexts/HoverContext";
import { useViewportContext } from "./contexts/ViewportContext";
import {
	advancePlayback,
	followPlayhead,
	getPlaybackStartMs,
	nextPlaybackSpeed,
	type PlaybackSpeed,
} from "./playback";

export interface PlaybackOptions {
	/** Where playback stops: the end of the trace */
	endMs: Accessor<number>;
	/** Whether the playback controls are on screen and Space toggles playing */
	enabled: Accessor<boolean>;
}

export interface Playback {
	playing: Accessor<boolean>;
	speed: Accessor<PlaybackSpeed>;
	toggle: () => void;
	/** Moves on to the next speed; takes effect at once, even mid-playback */
	cycleSpeed: () => void;
	/** Takes Space when playback applies; true if handled */
	handleKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Plays the test back in real time (scaled by the speed): the timeline is
 * locked at a moving time, so the step viewer, details panel and time line
 * all follow along, and the view pages along to keep it on screen.
 *
 * Playback owns the lock while it plays; any other lock or unlock (a click on
 * the timeline, Escape, arrow keys, the step viewer) pauses it where it is.
 */
export function usePlayback(options: PlaybackOptions): Playback {
	const { lock, lockedTimeMs, lockSource } = useHoverContext();
	const { viewport, animateTo } = useViewportContext();

	const [playing, setPlaying] = createSignal(false);
	const [speed, setSpeed] = createSignal<PlaybackSpeed>(1);

	let frame: number | undefined;
	let lastFrameAt: number | undefined;
	let timeMs = 0;

	const pause = () => {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
		setPlaying(false);
	};
	onCleanup(pause);

	const showTime = () => {
		batch(() => {
			lock(timeMs, null, "playback");
			const next = followPlayhead(viewport(), timeMs);
			if (next) animateTo(next);
		});
	};

	const tick = (now: number) => {
		const endMs = options.endMs();
		const elapsedMs = lastFrameAt === undefined ? 0 : now - lastFrameAt;
		lastFrameAt = now;
		timeMs = advancePlayback(timeMs, elapsedMs, speed(), endMs);
		showTime();
		if (timeMs >= endMs) {
			pause();
			return;
		}
		frame = requestAnimationFrame(tick);
	};

	const play = () => {
		const endMs = options.endMs();
		if (endMs <= 0) return;
		timeMs = getPlaybackStartMs(lockedTimeMs(), viewport(), endMs);
		lastFrameAt = undefined;
		batch(() => {
			setPlaying(true);
			showTime();
		});
		frame = requestAnimationFrame(tick);
	};

	const toggle = () => {
		if (playing()) pause();
		else play();
	};

	// Anything else taking or releasing the lock pauses playback.
	createEffect(() => {
		if (!playing()) return;
		if (!options.enabled() || lockSource() !== "playback") pause();
	});

	const handleKeyDown = (event: KeyboardEvent) => {
		if (!options.enabled() || event.key !== " ") return false;
		// A focused button takes Space itself.
		if (
			event.target instanceof HTMLElement &&
			event.target.closest("button, a[href]")
		) {
			return false;
		}
		event.preventDefault();
		toggle();
		return true;
	};

	return {
		playing,
		speed,
		toggle,
		cycleSpeed: () => setSpeed(nextPlaybackSpeed),
		handleKeyDown,
	};
}
