"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Clock, Monitor, Palette } from "lucide-react";
import {
  DAY_STARTS_AT,
  NIGHT_STARTS_AT,
  THEMES,
  THEME_STORAGE_KEY,
  isThemeChoice,
  msUntilThemeSwitch,
  themeForHour,
  type ThemeChoice,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * The theme picker.
 *
 * The chosen theme is applied by an inline script in the document head before
 * first paint (see layout.tsx), so this component only reflects and updates it.
 * Reading the stored value here instead would paint the default theme first and
 * then snap — which is the exact flash that script exists to prevent, and which
 * is far more obvious across seven palettes than it was across two.
 *
 * "System" is a real choice rather than the absence of one: it means "follow
 * the operating system", and it is stored as `system` so a reader who picked it
 * deliberately is not mistaken for one who has never opened this menu. It is
 * represented in the DOM by removing `data-theme` entirely, which is what lets
 * the media query in globals.css take over.
 */
/** A 24-hour hour as a reader would say it: 6 becomes "6am", 18 "6pm". */
function hour(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

/** True when the device asks for dark. Read on the client only. */
function deviceWantsDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Subscribes to the device changing its mind, for useSyncExternalStore. */
function watchColorScheme(onChange: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  const [open, setOpen] = useState(false);
  /*
    What the device is currently asking for, so "System" can say which.

    A reader whose machine is set to dark reads "System", expects the app to
    follow the time of day, and concludes the setting is broken — with nothing
    in this menu to tell them their device asked for dark. Naming it answers
    that on the spot. Subscribed rather than read once, so it stays right when
    the device changes while the menu is open, and null until hydration
    because a server has no device to ask.
  */
  const systemDark = useSyncExternalStore(watchColorScheme, deviceWantsDark, () => null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Deferred to a microtask so the state update does not run synchronously
    // inside the effect, which React flags as a cascading render.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        // Private browsing can block storage; the picker still works per-page.
      }
      setChoice(isThemeChoice(stored) ? stored : "system");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
    A tab left open across six o'clock changes itself.

    Without this the choice only takes effect on a page load, so somebody
    reading at half past five in the afternoon would still be on the light
    theme at midnight. The timer is set to the boundary itself rather than
    polling, and re-set each time one passes.
  */
  useEffect(() => {
    if (choice !== "daynight") return;

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        document.documentElement.dataset.theme = themeForHour(new Date().getHours());
        schedule();
      }, msUntilThemeSwitch());
    };
    schedule();
    return () => clearTimeout(timer);
  }, [choice]);

  // Close on an outside click or Escape, the two ways anyone expects a menu to
  // go away. Bound only while open so the app is not listening for nothing.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function apply(next: ThemeChoice) {
    setChoice(next);
    setOpen(false);

    if (next === "system") {
      delete document.documentElement.dataset.theme;
    } else if (next === "daynight") {
      // A rule rather than a theme: what gets stamped is whichever of the two
      // the clock asks for, which is also what the pre-paint script writes.
      document.documentElement.dataset.theme = themeForHour(new Date().getHours());
    } else {
      document.documentElement.dataset.theme = next;
    }

    /*
      Keep the mobile browser chrome on the same colour as the page.

      The static `themeColor` in the layout's viewport export can only answer
      light or dark, which is the wrong answer for five of these seven. Read
      back the ground the stylesheet actually resolved rather than keeping a
      second copy of every palette here in JavaScript.
    */
    const ground = getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (ground && meta) meta.setAttribute("content", ground);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage refused; the theme still applies for this page.
    }
  }

  // Null until hydration: a server has no reader's clock to read. Recomputed
  // on every render, which is often enough — the menu is short-lived, and the
  // effect above is what keeps a long-open page honest.
  const clockWants = choice === null ? "" : themeForHour(new Date().getHours());

  const label =
    choice === "daynight"
      ? "Day / night"
      : choice === "system"
        ? "System"
        : (THEMES.find((t) => t.id === choice)?.label ?? "Theme");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${label}. Change theme`}
        className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-border bg-transparent text-muted-strong transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
      >
        <Palette className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <p className="border-b border-border px-3 py-2 text-[0.6875rem] font-semibold tracking-wider text-faint uppercase">
            Theme
          </p>

          <div className="max-h-[70vh] overflow-y-auto py-1">
            <Option
              selected={choice === "system"}
              onSelect={() => apply("system")}
              label={systemDark == null ? "System" : `System — ${systemDark ? "dark" : "light"}`}
              description="Follows your device, not the time of day."
              swatch={
                <span className="flex size-5 items-center justify-center rounded-full border border-border text-muted">
                  <Monitor className="size-3" />
                </span>
              }
            />

            <Option
              selected={choice === "daynight"}
              onSelect={() => apply("daynight")}
              label={`Day / night — ${clockWants}`}
              description={`Light from ${hour(DAY_STARTS_AT)}, dark from ${hour(NIGHT_STARTS_AT)}, by your clock.`}
              swatch={
                <span className="flex size-5 items-center justify-center rounded-full border border-border text-muted">
                  <Clock className="size-3" />
                </span>
              }
            />

            {THEMES.map((theme) => (
              <Option
                key={theme.id}
                selected={choice === theme.id}
                onSelect={() => apply(theme.id)}
                label={theme.label}
                description={theme.description}
                swatch={<Swatch id={theme.id} />}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Option({
  selected,
  onSelect,
  label,
  description,
  swatch,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  description: string;
  swatch: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2",
        selected && "bg-accent-soft",
      )}
    >
      {swatch}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-medium">{label}</span>
        <span className="block truncate text-[0.6875rem] text-muted">{description}</span>
      </span>
      {/* The tick carries the state for anyone who cannot separate the
          highlight from the row beside it. */}
      <Check
        className={cn("size-3.5 shrink-0 text-accent", !selected && "invisible")}
        aria-hidden
      />
    </button>
  );
}

/**
 * A two-tone chip previewing a theme's ground and accent.
 *
 * The colours are read from the stylesheet rather than restated here: each
 * theme's own block is scoped to `[data-theme]`, so a bare element cannot pick
 * them up, but a `data-swatch` attribute nested inside an element carrying the
 * theme id can. That keeps `globals.css` the only place any palette is written
 * down — a swatch cannot drift from the theme it advertises.
 */
function Swatch({ id }: { id: string }) {
  return (
    <span
      data-theme={id}
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-full border border-border bg-background"
    >
      <span className="size-2.5 rounded-full bg-accent" />
    </span>
  );
}
