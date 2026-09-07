"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Palette } from "lucide-react";
import {
  THEMES,
  THEME_STORAGE_KEY,
  isThemeChoice,
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
export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  const [open, setOpen] = useState(false);
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

  const label =
    choice === "system"
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
              label="System"
              description="Follow your device setting."
              swatch={
                <span className="flex size-5 items-center justify-center rounded-full border border-border text-muted">
                  <Monitor className="size-3" />
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
