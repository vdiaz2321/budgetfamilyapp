"use client";

import { useState } from "react";

export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
