"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { updateAvatarUrl } from "./actions";

type Props = {
  userId: string;
  currentUrl: string | null;
  displayName: string;
  email: string;
};

const MAX_MB = 3;

export function AvatarCard({ userId, currentUrl, displayName, email }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, startRemove] = useTransition();

  const initial = (displayName.trim()?.[0] ?? email[0] ?? "?").toUpperCase();

  const onPick = () => inputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (PNG, JPG, WebP).");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Image is larger than ${MAX_MB} MB.`);
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // Cache-buster in the filename so the sidebar <img> refetches after
      // replacing an avatar — same public URL would otherwise be cached.
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl;

      const fd = new FormData();
      fd.set("avatarUrl", url);
      await updateAvatarUrl(fd);
      setPreview(url);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAvatar = () =>
    startRemove(async () => {
      const fd = new FormData();
      fd.set("avatarUrl", "");
      await updateAvatarUrl(fd);
      setPreview(null);
      router.refresh();
    });

  return (
    <div className="flex items-start gap-5">
      <div className="relative">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Profile"
            className="h-20 w-20 rounded-full object-cover ring-2 ring-line"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand text-2xl font-semibold text-white">
            {initial}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={onFile}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPick}
            disabled={uploading}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : preview ? "Replace photo" : "Upload photo"}
          </button>
          {preview ? (
            <button
              type="button"
              onClick={removeAvatar}
              disabled={removing || uploading}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-negative/10 hover:text-negative disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted">PNG, JPG or WebP. Max {MAX_MB} MB.</p>
        {error ? <p className="text-xs text-negative">{error}</p> : null}
      </div>
    </div>
  );
}
