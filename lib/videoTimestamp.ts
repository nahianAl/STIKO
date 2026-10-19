/**
 * A video position in seconds as a timecode: `0:07`, `12:34`, `1:02:03`.
 *
 * Whole seconds, floored — the chip names the second the comment was made in, and rounding up
 * would label a frame at 4.6s as `0:05`, a second it never reached.
 */
export function formatVideoTimestamp(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
