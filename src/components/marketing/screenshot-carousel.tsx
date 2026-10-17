"use client";

import { useRef, useState } from "react";
import BrowserFrame from "@/components/marketing/browser-frame";

export type Slide = { src: string; alt: string; caption: string };

/**
 * Carrousel de captures : scroll-snat natif + boutons + indicateurs.
 * Utilisable au clavier (boutons) et au tactile (swipe natif du scroll).
 */
export default function ScreenshotCarousel({ slides }: { slides: Slide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function go(i: number) {
    const clamped = Math.max(0, Math.min(slides.length - 1, i));
    setIndex(clamped);
    const el = track.current;
    if (el) {
      const slide = el.children[clamped] as HTMLElement | undefined;
      slide?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }

  return (
    <div className="relative">
      <div
        ref={track}
        className="carousel-track -mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0"
      >
        {slides.map((s, i) => (
          <div
            key={s.src}
            className="w-[85%] shrink-0 snap-center sm:w-[70%] lg:w-[60%]"
            aria-hidden={i !== index}
          >
            <BrowserFrame src={s.src} alt={s.alt} url={s.caption} />
            <p className="mt-3 text-center text-sm text-zinc-500">{s.caption}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Capture précédente"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-40"
        >
          ←
        </button>
        <div className="flex gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.src}
              type="button"
              onClick={() => go(i)}
              aria-label={`Capture ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === index ? "w-6 bg-brand-500" : "w-2 bg-zinc-300 hover:bg-brand-300"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === slides.length - 1}
          aria-label="Capture suivante"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-40"
        >
          →
        </button>
      </div>
    </div>
  );
}
