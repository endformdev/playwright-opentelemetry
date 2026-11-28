import {
	type Accessor,
	batch,
	createEffect,
	createSignal,
	on,
	onCleanup,
} from "solid-js";
import { useHoverContext } from "./contexts/HoverContext";
import { useViewportContext } from "./contexts/ViewportContext";
import {
	advancePlayback,
	followPlayhead,
	getHeldPlayback,
	getPlaybackStartMs,
	type HeldPlayback,
	isPlaybackOver,
	type PlaybackHold,
	type PlaybackPosition,
	type PlaybackSpeed,
	rejoinPlayback,
	startPlayback,
} from "./playback";

export interface PlaybackOptions {
	/** Where playback stops: the end of the trace */
	endMs: Accessor<number>;
	/** Whether the playback controls are on screen and Space toggles playing */
	enabled: Accessor<boolean>;
	/** Takes effect at once, even mid-playback */
	speed: Accessor<PlaybackSpeed>;
	/** The moments playback waits at, in time order; none to play straight through */
	holds: Accessor<readonly PlaybackHold[]>;
}

export interface Playback {
	playing: Accessor<boolean>;
	/**
	 * The hold playback is waiting at, also once paused there; null while it
	 * moves and when the time on show is no longer playback's
	 */
	held: Accessor<HeldPlayback | null>;
	toggle: () => void;
	/** Takes Space when playback applies; true if handled */
	handleKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Plays the test back in real time (scaled by the speed): the timeline is
 * locked at a moving time, so the step viewer, details panel and time line
 * all follow along, and the view pages along to keep it on screen. At a hold
 * the time stands still for the hold's duration, at any speed.
 *
 * Playback owns the lock while it plays; any other lock or unlock (a click on
 * the timeline, Escape, arrow keys, the step viewer) pauses it where it is.
 * Paused and played again from where it stopped, it carries on: a hold it
 * was part way through takes only the rest of its time.
 */
export function usePlayback(options: PlaybackOptions): Playback {
	const { lock, lockedTimeMs, lockSource } = useHoverContext();
	const { viewport, animateTo } = useViewportContext();

	const [playing, setPlaying] = createSignal(false);
	const [held, setHeld] = createSignal<HeldPlayback | null>(null, {
		equals: (previous, next) =>
			previous?.index === next?.index && previous?.heldMs === next?.heldMs,
	});

	let frame: number | undefined;
	let lastFrameAt: number | undefined;
	let position: PlaybackPosition = startPlayback(0);

	const pause = () => {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
		setPlaying(false);
	};
	onCleanup(pause);

	const showPosition = () => {
		batch(() => {
			lock(position.timeMs, null, "playback");
			setHeld(getHeldPlayback(position, options.holds(), options.endMs()));
			const next = followPlayhead(viewport(), position.timeMs);
			if (next) animateTo(next);
		});
	};

	const tick = (now: number) => {
		const endMs = options.endMs();
		const elapsedMs = lastFrameAt === undefined ? 0 : now - lastFrameAt;
		lastFrameAt = now;
		position = advancePlayback(
			position,
			elapsedMs,
			options.speed(),
			endMs,
			options.holds(),
		);
		showPosition();
		if (isPlaybackOver(position, options.holds(), endMs)) {
			pause();
			return;
		}
		frame = requestAnimationFrame(tick);
	};

	/** Whether the time on show is still where playback left it */
	const isWherePlaybackLeftIt = () =>
		lockSource() === "playback" && lockedTimeMs() === position.timeMs;

	const play = () => {
		const endMs = options.endMs();
		if (endMs <= 0) return;
		const startMs = getPlaybackStartMs(lockedTimeMs(), viewport(), endMs);
		if (!isWherePlaybackLeftIt() || startMs !== position.timeMs) {
			position = startPlayback(startMs, options.holds());
		}
		lastFrameAt = undefined;
		batch(() => {
			setPlaying(true);
			showPosition();
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

	// A hold is over once the time on show is someone else's.
	createEffect(() => {
		if (!isWherePlaybackLeftIt()) setHeld(null);
	});

	// Other holds, as when they are switched on or off, apply from here on.
	createEffect(
		on(
			options.holds,
			(holds) => {
				position = rejoinPlayback(position.timeMs, holds);
				setHeld(null);
			},
			{ defer: true },
		),
	);

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

	return { playing, held, toggle, handleKeyDown };
}
