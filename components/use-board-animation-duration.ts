"use client";

import { useEffect, useState } from "react";
import { boardAnimationDuration } from "@/lib/board-interaction";

export function useBoardAnimationDuration() {
  const [duration, setDuration] = useState(220);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setDuration(boardAnimationDuration(preference.matches));
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return duration;
}
