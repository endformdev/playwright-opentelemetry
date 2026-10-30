import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A fresh checkpoint directory per run, inherited by every worker. */
export default function globalSetup() {
	process.env.LIVE_CHECKPOINT_DIR = mkdtempSync(
		path.join(tmpdir(), "pw-otel-live-checkpoints-"),
	);
}
