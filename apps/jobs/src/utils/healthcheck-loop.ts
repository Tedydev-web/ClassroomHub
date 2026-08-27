/**
 * Keeps the worker's liveness file fresh.
 *
 * The loop used to be created inside the first probe's `.then`, so a probe that failed
 * once scheduled nothing and the file was never written again. Redis answers `LOADING` for
 * a second or two after it starts, which is exactly when the first probe runs — a normal
 * startup left the container reporting unhealthy for the rest of its life while every
 * worker inside it ran perfectly.
 *
 * A liveness signal that is permanently wrong is worse than none: it is either ignored, or
 * it hides the outage it exists to reveal. The loop therefore starts regardless of how the
 * first attempt goes, and a failed probe leaves the file stale so the container turns
 * unhealthy on its own terms rather than on a scheduling accident.
 */
export type HealthcheckLoop = {
  /** Stops the loop. The process does not wait on it either way. */
  stop: () => void;
};

export function startHealthcheckLoop(options: {
  probe: () => Promise<void>;
  intervalMs: number;
  onError: (error: unknown) => void;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}): HealthcheckLoop {
  const schedule = options.setInterval ?? setInterval;
  const cancel = options.clearInterval ?? clearInterval;

  const run = () => {
    void options.probe().catch(options.onError);
  };

  run();

  const handle = schedule(run, options.intervalMs);
  // Never a reason for the process to stay alive.
  if (typeof (handle as { unref?: () => void }).unref === 'function') {
    (handle as { unref: () => void }).unref();
  }

  return { stop: () => cancel(handle) };
}
