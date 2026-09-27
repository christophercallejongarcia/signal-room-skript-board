"use client";

import { useCallback, useEffect, useState } from "react";

/** Board theme (point 6): light Poppy look by default, dark with Signal Room tokens, stored in localStorage. */
export type BoardTheme = "light" | "dark";
export const THEME_KEY = "board-theme";

export function readTheme(): BoardTheme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useBoardTheme(): [BoardTheme, () => void] {
  const [theme, setTheme] = useState<BoardTheme>("light");
  useEffect(() => setTheme(readTheme()), []);
  useEffect(() => {
    document.querySelector(".board-root")?.setAttribute("data-theme", theme);
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {}
      return next;
    });
  }, []);
  return [theme, toggle];
}
