"use client";

import { useEffect, useState } from "react";

// A transaction's ✕ that asks first. One click turns it into a red "Delete?"
// pill; a second click deletes. Clicking anywhere else, or waiting a few
// seconds, puts the ✕ back. The ✕ used to delete on the first click — and a
// split purchase went with it whole — so a stray click cost a transaction.
//
// `parts` is how many rows the delete removes (a split purchase deletes all
// of its rows), so the pill can say "Delete both?" rather than surprise.
export function ConfirmDeleteButton({
  onConfirm,
  disabled = false,
  parts = 1,
  className,
  children,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  parts?: number;
  /** The ✕'s own look, as each list already draws it. */
  className: string;
  children: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        autoFocus
        onClick={(e) => {
          e.stopPropagation();
          setArmed(false);
          onConfirm();
        }}
        onBlur={() => setArmed(false)}
        className="relative z-10 shrink-0 whitespace-nowrap rounded-full bg-negative px-2 py-0.5 text-xs font-bold text-white shadow-sm"
      >
        {parts === 2 ? "Delete both?" : parts > 2 ? `Delete all ${parts}?` : "Delete?"}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label="Delete transaction"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        setArmed(true);
      }}
      className={className}
    >
      {children}
    </button>
  );
}
