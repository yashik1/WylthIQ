/**
 * The WylthIQ mark: a W that is also a rising line.
 *
 * The brand initial and an ascending trend are the same shape, so the mark
 * draws one stroke and means both — down, up, down, up, with every turn
 * landing higher than the one before it and the finish above the start. That
 * upward tilt is the only thing separating a W from a chart, and it is doing
 * the arguing: this is about what wealth does over time, not what it did on
 * Tuesday.
 *
 * The dot on the final point is the convention the price charts already use
 * for the current reading — the end of the line is the part you are actually
 * standing on.
 *
 * Stroked, `currentColor`, no gradient and no fill beyond that one dot, for
 * the same reason the mark it replaces had none: this has to survive 16px in
 * a tab strip and reversing out of a coloured tile, and a gradient turns to
 * mud at both.
 */
export function WylthMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className ?? "size-[18px]"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M3 8 L7.5 17 L12 11 L16.5 14 L21 4.5" />
      {/* Filled from the stroke colour so the whole mark stays one ink. */}
      <circle cx="21" cy="4.5" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
