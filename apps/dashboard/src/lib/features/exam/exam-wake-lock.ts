export function holdScreenAwake(): () => void {
  if (typeof document === 'undefined' || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return () => {};
  }

  let sentinel: WakeLockSentinel | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped || document.visibilityState !== 'visible') return;

    try {
      const granted = await navigator.wakeLock.request('screen');
      if (stopped) {
        await granted.release();
        return;
      }
      sentinel = granted;
    } catch (error) {
      console.warn('Screen wake lock unavailable:', error);
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void acquire();
  };

  void acquire();
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    void sentinel?.release();
    sentinel = null;
  };
}
