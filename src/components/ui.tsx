import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Rating } from "@/lib/scoring/types";

/**
 * A corner bracket — a short L sitting on the frame's own line.
 *
 * This replaces the `+` crop marks the frames used to carry. Those sat half a
 * dozen pixels outside the border, so they floated in the gap between one card
 * and the next and read as a rendering fault rather than as a detail: four
 * small crosses adrift in whitespace, touching nothing. A bracket laid over
 * the corner itself thickens a line that is already there, which is the whole
 * difference between an ornament and a finish.
 *
 * Still two 1px rules rather than a glyph, so it stays exactly one device pixel
 * at any zoom. Quiet by default; on a card you can click, the brackets pick up
 * the accent with the border so the whole frame answers as one object.
 */
function Corner({ pos, hover = true }: { pos: "tl" | "tr" | "bl" | "br"; hover?: boolean }) {
  const box = {
    tl: "-top-px -left-px",
    tr: "-top-px -right-px",
    bl: "-bottom-px -left-px",
    br: "-bottom-px -right-px",
  }[pos];
  const arm = cn(
    "absolute bg-border-strong",
    hover && "transition-colors group-hover:bg-accent",
  );

  /*
    Both arms are pinned on both axes, and the horizontal one needs `left-0`
    as much as the vertical one needs `left-0`/`right-0`.

    An absolutely positioned box given no horizontal inset falls back to its
    static position — where it would have sat in the flow — and that depends
    on the parent's `text-align`. Every frame in the app is a div, where the
    default `start` puts the static position at the left edge and the arm
    lands correctly by accident. Put the same markup inside a <button>, which
    centres its content, and the static position moves to the middle of the
    14px box: the arm shifts 7px right and its end pokes 8px past the frame it
    is supposed to finish. That was visible on the hero's Analyse button as a
    broken vertical line floating beside it.
  */
  return (
    <span aria-hidden className={cn("pointer-events-none absolute size-3.5", box)}>
      <span className={cn(arm, "left-0 h-px w-full", pos.startsWith("t") ? "top-0" : "bottom-0")} />
      <span className={cn(arm, "top-0 h-full w-px", pos.endsWith("l") ? "left-0" : "right-0")} />
    </span>
  );
}

/**
 * The four brackets, for a framed object that is not a Card.
 *
 * Exported so the hero's figures and its submit button stop hand-rolling
 * their own copies. Three near-identical copies of this markup is how one of
 * them ended up with a positioning bug the other two did not have, and the
 * whole point of the frame is that it is identical everywhere.
 *
 * `hover` is off by default: the accent pickup belongs to a Card you can
 * click, and on a solid button it would fight the fill rather than answer it.
 */
export function CornerBrackets({ hover = false }: { hover?: boolean }) {
  return (
    <>
      <Corner pos="tl" hover={hover} />
      <Corner pos="tr" hover={hover} />
      <Corner pos="bl" hover={hover} />
      <Corner pos="br" hover={hover} />
    </>
  );
}

/**
 * Every framed object in the interface.
 *
 * A lifted surface rather than a line drawing: rounded, filled, and shadowed
 * off the canvas beneath it. `marks` is kept as a prop for source
 * compatibility with every existing call site, but corner brackets read as
 * floating clutter against a rounded corner, so a Card no longer draws them —
 * the elevation itself is what says "this is a frame" now. The brackets stay
 * available via `<CornerBrackets />` for the handful of square, technical
 * exhibits (the hero's filing readout) that deliberately sit outside this
 * rounded language.
 */
export function Card({
  children,
  className,
  as: Tag = "div",
  interactive,
  marks: _marks = true,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
  interactive?: boolean;
  /** @deprecated no longer changes rendering; kept so old call sites still compile. */
  marks?: boolean;
}) {
  void _marks;
  return (
    <Tag
      className={cn(
        "relative rounded-xl border border-border bg-surface shadow-sm transition-[box-shadow,border-color,transform] duration-200",
        interactive &&
          "group cursor-pointer hover:-translate-y-px hover:border-accent/40 hover:shadow-md",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold leading-tight tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The band at the top of a page: eyebrow, title, standfirst.
 *
 * A component rather than a shape everyone copies, because copying is exactly
 * what happened. Ten pages had hand-written headers that had drifted into two
 * incompatible treatments — four carried `pt-10 pb-[22px]` and a rule beneath
 * them, six carried `pt-1` and no rule, so moving between Screener and Compare
 * shifted the title by nearly 40px and the rule under it appeared and vanished.
 * The standfirst measure had drifted four ways as well (52ch, 56ch, 60ch,
 * max-w-2xl, and none at all), and the Terms title was a different size from
 * every other title in the app.
 *
 * The ruled treatment wins because the site header, the dashboard's bands and
 * the stock page all already use it, so it is the app's established language
 * rather than a new one.
 *
 * `aside` holds anything that belongs opposite the title — Markets puts a
 * units note there. It only becomes a second column when it exists, so a page
 * without one is not laid out as a grid with an empty half.
 */
export function PageHeader({
  eyebrow,
  title,
  aside,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
  /** The standfirst. Multiple paragraphs are spaced for you. */
  children?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "border-b border-border pt-10 pb-[22px]",
        aside &&
          "grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-end gap-6",
      )}
    >
      <div className="min-w-0">
        <p className="eyebrow mb-2">{eyebrow}</p>
        {/* break-words because one of these titles is a signed-in user's own
            email address, which has no spaces to wrap at. */}
        <h1 className="font-display mb-2 text-[2.75rem] leading-none break-words">
          {title}
        </h1>
        {children && (
          <div className="max-w-[60ch] space-y-2 text-sm leading-relaxed text-muted">
            {children}
          </div>
        )}
      </div>
      {aside && <div className="justify-self-start sm:justify-self-end">{aside}</div>}
    </header>
  );
}

/** Section heading used between cards, with an optional trailing action. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  // ReactNode rather than string: a description can carry an inline element,
  // such as a timestamp that has to be formatted in the reader's own timezone.
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h2 className="font-display text-xl">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const RATING_STYLES: Record<Rating, string> = {
  good: "bg-good-soft text-good-fg ring-good/25",
  fair: "bg-fair-soft text-fair-fg ring-fair/25",
  poor: "bg-poor-soft text-poor-fg ring-poor/25",
  unknown: "bg-unknown-soft text-unknown-fg ring-unknown/25",
};

/**
 * Rating labels always carry words, never colour alone — the text is what
 * conveys meaning to anyone who cannot separate the hues.
 */
const RATING_LABELS: Record<Rating, string> = {
  good: "Good",
  fair: "Mixed",
  poor: "Weak",
  unknown: "No data",
};

export function RatingBadge({
  rating,
  label,
  className,
}: {
  rating: Rating;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tnum inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        RATING_STYLES[rating],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 bg-current" />
      {label ?? RATING_LABELS[rating]}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "fair" | "poor";
  title?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted-strong ring-border",
    accent: "bg-accent-soft text-accent ring-accent/20",
    good: "bg-good-soft text-good-fg ring-good/25",
    fair: "bg-fair-soft text-fair-fg ring-fair/25",
    poor: "bg-poor-soft text-poor-fg ring-poor/25",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * An explanation a reader can actually open.
 *
 * Everything about this app's positioning rests on the explanatory writing
 * attached to its figures, and all of it used to be delivered through `title`
 * — which only appears on hover. The comment that used to sit above `Metric`
 * claimed the hint reached "screen readers and keyboard users": half true. A
 * screen reader did read the visually hidden copy, but a sighted keyboard user
 * had no way to open a `title`, and on a touchscreen there is no hover at all,
 * so on the device most of this is read on the explanations did not exist.
 *
 * A native `<details>` needs no JavaScript, no popover positioning, and no
 * client boundary — this file stays a server component — while opening on tap,
 * click, Enter and Space alike. Styling lives in `globals.css` under `.explain`.
 */
export function Explain({ term, children }: { term: string; children: ReactNode }) {
  return (
    <details className="explain">
      {/*
        The label is spoken rather than left as a bare symbol: a page carries
        a dozen of these, and "ⓘ, ⓘ, ⓘ" in a screen reader's element list
        names none of them.
      */}
      <summary aria-label={`Explain ${term}`}>ⓘ</summary>
      <span className="explain-body">{children}</span>
    </details>
  );
}

/**
 * A labelled figure with an always-available plain-language explanation.
 *
 * The explanation opens from the figure itself rather than the label, because
 * "explain this number" is what a reader wants and the number is what they are
 * looking at.
 */
export function Metric({
  label,
  value,
  hint,
  size = "md",
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  size?: "sm" | "md" | "lg";
  tone?: "up" | "down" | "muted";
}) {
  const sizes = {
    sm: "text-[0.8125rem]",
    md: "text-[0.9375rem]",
    lg: "font-display text-[1.625rem] leading-none",
  };
  return (
    <div className="min-w-0">
      {/* The same eyebrow every other measure label in the app uses, so a
          figure reads identically whether it sits on the dashboard strip, a
          backtest panel or a company page. */}
      <dt className="eyebrow text-[0.625rem]">
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={cn(
          "tnum mt-1 font-semibold",
          size === "lg" && "mt-1.5",
          sizes[size],
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "muted" && "text-muted",
        )}
      >
        {value}
        {hint && <Explain term={label}>{hint}</Explain>}
      </dd>
    </div>
  );
}

/**
 * Horizontal magnitude bar.
 *
 * Gives a number a visual length so a column of figures can be scanned by shape
 * rather than read one at a time.
 */
export function MeterBar({
  value,
  max = 1,
  rating = "unknown",
  className,
  label,
}: {
  value: number | null;
  max?: number;
  rating?: Rating;
  className?: string;
  label?: string;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max)) * 100;
  const fills: Record<Rating, string> = {
    good: "bg-good",
    fair: "bg-fair",
    poor: "bg-poor",
    unknown: "bg-unknown",
  };

  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="img"
      aria-label={label ?? (value == null ? "No data" : `${Math.round(pct)} percent`)}
    >
      <div
        className={cn("h-full rounded-full transition-all", fills[rating])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Coloured price change, with the sign always spelled out in the text. */
export function Change({
  value,
  percent,
  className,
}: {
  value: number | null;
  percent: number | null;
  className?: string;
}) {
  if (value == null && percent == null) {
    return <span className={cn("text-muted", className)}>—</span>;
  }
  const positive = (value ?? percent ?? 0) >= 0;
  return (
    <span
      className={cn("tnum font-semibold", positive ? "text-up" : "text-down", className)}
    >
      {positive ? "▲" : "▼"}{" "}
      {value != null ? Math.abs(value).toFixed(2) : ""}
      {value != null && percent != null ? " " : ""}
      {percent != null ? `(${Math.abs(percent * 100).toFixed(2)}%)` : ""}
    </span>
  );
}

/**
 * Placeholder for a figure that genuinely is not available.
 *
 * A bare dash reads as a broken page. This says "not reported" quietly, and
 * carries the reason when there is one.
 */
export function NotReported({ reason }: { reason?: string }) {
  return (
    <span className="text-xs text-faint" title={reason}>
      not reported
      {reason && <span className="sr-only"> — {reason}</span>}
    </span>
  );
}
