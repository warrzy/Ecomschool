"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Apparition au scroll via IntersectionObserver.
 * `from` : direction d'entrée (left/right/up). `delay` en ms pour le stagger.
 * Respecte prefers-reduced-motion (styles désactivés en CSS).
 */
export default function Reveal(props: {
  children: ReactNode;
  from?: "left" | "right" | "up" | "scale";
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal reveal--${props.from ?? "up"} ${visible ? "is-visible" : ""} ${props.className ?? ""}`}
      style={props.delay ? { transitionDelay: `${props.delay}ms` } : undefined}
    >
      {props.children}
    </div>
  );
}
