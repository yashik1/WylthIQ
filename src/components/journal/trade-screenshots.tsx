"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { captionScreenshot, deleteScreenshot } from "@/lib/journal/screenshot-actions";
import { cn } from "@/lib/utils";

export interface ScreenshotItem {
  id: number;
  width: number;
  height: number;
  bytes: number;
  caption: string;
  createdAt: string;
}

/** Mirrors MAX_PER_TRADE in lib/journal/screenshots.ts, which is what enforces it. */
const LIMIT = 6;
const ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * The reader's own screenshots of a trade: their chart with their drawings,
 * from TradingView or their broker's platform. Added by choosing a file,
 * dropping one here, or pasting straight from the clipboard, which is how a
 * screenshot usually arrives.
 */
export function TradeScreenshots({ tradeId, screenshots }: { tradeId: number; screenshots: ScreenshotItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const full = screenshots.length >= LIMIT;

  const upload = useCallback(
    async (file: File) => {
      if (busy || full) return;
      setBusy(true);
      setMessage(null);
      try {
        const body = new FormData();
        body.set("image", file);
        const res = await fetch(`/api/journal/trades/${tradeId}/screenshots`, { method: "POST", body });
        const result = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
        setMessage({ ok: Boolean(result?.ok), text: result?.message ?? "That did not upload. Try again." });
        if (result?.ok) router.refresh();
      } catch {
        setMessage({ ok: false, text: "That did not upload. Check your connection and try again." });
      } finally {
        setBusy(false);
      }
    },
    [busy, full, router, tradeId],
  );

  // Pasting an image anywhere on the page adds it, unless the reader is
  // typing in a field, where a paste means text.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, [contenteditable='true']"))) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void upload(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {screenshots.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          {screenshots.map((s, i) => (
            <Screenshot key={s.id} item={s} index={i} />
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-xs text-faint">
          {LIMIT} screenshots is the most a trade can have. Delete one to add another.
        </p>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
            if (file) void upload(file);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center transition-colors",
            dragging && "border-accent bg-surface-2",
          )}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
          >
            <ImagePlus className="size-4" aria-hidden />
            {busy ? "Uploading…" : "Add a screenshot"}
          </button>
          <p className="text-xs text-faint">
            Or drop an image here, or paste one with Ctrl+V or ⌘V. PNG, JPEG or WebP, up to 10 MB.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
      )}

      {message && (
        <p className={cn("text-xs", message.ok ? "text-up" : "text-poor")} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}

function Screenshot({ item, index }: { item: ScreenshotItem; index: number }) {
  const [captionState, captionAction, saving] = useActionState(captionScreenshot, null);
  const [deleteState, deleteAction, deleting] = useActionState(deleteScreenshot, null);
  const src = `/api/journal/screenshots/${item.id}`;
  const label = item.caption || `Screenshot ${index + 1}`;

  return (
    <li className="overflow-hidden rounded-xl border border-border">
      <a href={src} target="_blank" rel="noopener" className="block bg-surface-2">
        {/* A plain img: this is the reader's own private file behind their
            session, which an image optimiser fetching it without the
            session could not read. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          width={item.width}
          height={item.height}
          loading="lazy"
          className="h-auto max-h-80 w-full object-contain"
        />
      </a>
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-2.5">
        <form action={captionAction} className="flex min-w-0 flex-1 items-center gap-2">
          <input type="hidden" name="id" value={item.id} />
          <input
            name="caption"
            defaultValue={item.caption}
            maxLength={200}
            placeholder="Add a caption"
            aria-label={`Caption for ${label}`}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg border border-border px-2 py-1 text-xs transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {saving ? "…" : "Save"}
          </button>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={item.id} />
          <button
            type="submit"
            disabled={deleting}
            aria-label={`Delete ${label}`}
            className="inline-flex items-center rounded-lg p-1.5 text-faint transition-colors hover:text-poor disabled:opacity-50"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </form>
        {(captionState && !captionState.ok) || (deleteState && !deleteState.ok) ? (
          <p className="w-full text-xs text-poor" role="status">
            {(deleteState && !deleteState.ok ? deleteState : captionState)!.message}
          </p>
        ) : null}
      </div>
    </li>
  );
}
