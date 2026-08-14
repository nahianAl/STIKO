/**
 * Icons for the 3D viewport's tool buttons.
 *
 * Traced from the supplied SVGs with two edits each: the hardcoded fills and strokes become
 * `currentColor` so the chip's active and hover states drive them, and the rotate icon's
 * `<style>`/`.st0` class is inlined as attributes — a class inside a JSX SVG would leak into
 * the global stylesheet and collide with anything else named `st0`.
 *
 * The two viewBoxes differ (24 and 32) because the sources do; each renders into the same
 * 17px box, so the difference is invisible.
 */

/** Cross-section: a sphere with a slice cut through it. */
export const SliceIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.425 7.73C16.505 3.752 14.395 1.2 12 1.2A10.8 10.8 0 1 0 22.8 12c0-1.818-2.003-3.403-5.375-4.27zM21.8 12c0 1.367-1.949 2.72-4.955 3.447a22.67 22.67 0 0 1-8.73.22l1.3-1.014A13.55 13.55 0 0 0 12.5 15a13.716 13.716 0 0 0 2.98-.316C17.683 14.183 19 13.18 19 12c0-1.07-1.091-1.99-2.936-2.526l1.018-.793C19.951 9.403 21.8 10.693 21.8 12zm-11 0c0-.313.012-.618.028-.915.117-2.133.68-4.285 1.672-4.285.788 0 1.3 1.36 1.538 2.984L10.809 12.3c-.002-.1-.01-.197-.01-.3zm5.4 0c0 .73-1.54 1.014-2.201 1.103a11.486 11.486 0 0 1-1.499.097c-.38 0-.753-.036-1.125-.073l2.823-2.2c.728.114 2.002.408 2.002 1.073zm.237-4.085l-.777.606C15.1 5.743 13.918 4 12.5 4c-1.618 0-2.938 2.254-3.365 5.743A18.621 18.621 0 0 0 9 12c0 .556.033 1.105.08 1.647l-1.817 1.416a17.914 17.914 0 0 1 .129-6.782c.78-3.637 2.633-6.08 4.608-6.08 1.874 0 3.633 2.283 4.437 5.714zM12 21.8A9.796 9.796 0 0 1 8.936 2.698 11.345 11.345 0 0 0 6.414 8.07a19.366 19.366 0 0 0 0 7.967.5.5 0 0 0 .371.38 22.262 22.262 0 0 0 5.148.582 22.268 22.268 0 0 0 5.147-.582 10.646 10.646 0 0 0 4.408-2.011A9.808 9.808 0 0 1 12 21.8z" />
  </svg>
);

/** Move: the four-way arrow cross. */
export const MoveIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12.0001 2.89331L8.81809 6.07529L9.87875 7.13595L11.2501 5.76463V11.2499H5.7649L7.13619 9.8786L6.07553 8.81794L2.89355 11.9999L6.07553 15.1819L7.13619 14.1212L5.76485 12.7499H11.2501V18.2352L9.87875 16.8639L8.81809 17.9245L12.0001 21.1065L15.182 17.9245L14.1214 16.8639L12.7501 18.2352V12.7499H18.2353L16.8639 14.1213L17.9246 15.1819L21.1066 11.9999L17.9246 8.81796L16.8639 9.87862L18.2352 11.2499H12.7501V5.76463L14.1214 7.13595L15.182 6.07529L12.0001 2.89331Z"
    />
  </svg>
);

/** Rotate: the crossed orbit loops. */
export const RotateIcon = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeMiterlimit="10"
    aria-hidden
  >
    <polyline points="19,19 24,19 24,24" />
    <polyline points="6,23 11,23 11,18" />
    <path d="M24,19.4c-0.7,0.8-1.4,1.6-2.2,2.4c-7,7-15.3,10.2-18.5,7s-0.1-11.5,7-18.5s15.3-10.2,18.5-7c1.4,1.4,1.6,3.6,0.8,6.3" />
    <path d="M11,22.5c-0.3-0.2-0.5-0.5-0.8-0.8c-7-7-10.2-15.3-7-18.5s11.5-0.1,18.5,7s10.2,15.3,7,18.5c-1.7,1.7-4.8,1.6-8.4,0.1" />
  </svg>
);
