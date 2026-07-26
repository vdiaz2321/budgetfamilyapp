"use client";

import { useLayoutEffect } from "react";

export function ThemeInit() {
  useLayoutEffect(() => {
    try {
      // Light is the first-visit default. A saved choice is respected only
      // after the user deliberately switches themes from the sidebar toggle.
      const t = localStorage.getItem("theme") ?? "light";
      document.documentElement.setAttribute("data-theme", t);
    } catch {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, []);

  return null;
}
