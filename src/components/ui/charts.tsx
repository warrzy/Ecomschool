/**
 * Graphiques SVG/divs légers — lot D4.
 * Données réelles uniquement, aucun placeholder. Accessibles :
 * chaque visuel est accompagné d'une liste textuelle équivalente
 * (lisible par lecteur d'écran) et les barres portent un aria-label.
 */

export type ChartPoint = { label: string; value: number };

const BAR_COLORS = [
  "bg-brand-500",
  "bg-leaf-500",
  "bg-sun-400",
  "bg-coral-400",
  "bg-brand-300",
  "bg-brand-700",
];

const DONUT_COLORS = [
  "#2f5fe6", // brand-500
  "#2da265", // leaf-500
  "#f5b92e", // sun-400
  "#f5833d", // coral-400
  "#87a9f7", // brand-300
  "#182966", // brand-900
];

/** Barres horizontales : répartition (niveaux, offres, catégories, méthodes). */
export function BarList(props: {
  items: ChartPoint[];
  unit?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(0, ...props.items.map((i) => i.value));
  const fmt = props.format ?? ((n: number) => `${n.toLocaleString("fr-FR")}${props.unit ? ` ${props.unit}` : ""}`);
  if (props.items.length === 0) return null;
  return (
    <ul className="space-y-2.5" role="list">
      {props.items.map((item, i) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-zinc-800">{item.label}</span>
            <span className="shrink-0 text-xs font-semibold text-ink">
              {fmt(item.value)}
            </span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100"
            role="img"
            aria-label={`${item.label} : ${fmt(item.value)}`}
          >
            <div
              className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} motion-safe:transition-[width] motion-safe:duration-500`}
              style={{ width: max > 0 ? `${Math.max(2, (item.value / max) * 100)}%` : "0%" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Donut SVG : parts d'un total (filles/garçons, statuts, méthodes). */
export function Donut(props: { items: ChartPoint[]; centerLabel?: string }) {
  const total = props.items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return null;
  const R = 15.9155; // circonférence 100
  // Segments pré-calculés (offset cumulé, départ en haut = 25).
  const segments = props.items.map((item, i) => ({
    ...item,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
    pct: (item.value / total) * 100,
  }));
  const offsets = segments.map(
    (_, i) => 25 - segments.slice(0, i).reduce((s, x) => s + x.pct, 0),
  );
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox="0 0 42 42"
        className="h-36 w-36 shrink-0"
        role="img"
        aria-label={props.items.map((i) => `${i.label} : ${i.value}`).join(", ")}
      >
        <circle cx="21" cy="21" r={R} fill="none" stroke="#f4f4f5" strokeWidth="6" />
        {segments.map((item, i) => (
          <circle
            key={item.label}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke={item.color}
            strokeWidth="6"
            strokeDasharray={`${item.pct} ${100 - item.pct}`}
            strokeDashoffset={offsets[i]}
            strokeLinecap="butt"
          />
        ))}
        <text
          x="21"
          y="21.5"
          textAnchor="middle"
          className="fill-ink"
          fontSize="6.5"
          fontWeight="700"
        >
          {props.centerLabel ?? total.toLocaleString("fr-FR")}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm" role="list">
        {props.items.map((item, i) => (
          <li key={item.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              <span className="truncate text-zinc-700">{item.label}</span>
            </span>
            <span className="shrink-0 font-semibold text-ink">
              {item.value.toLocaleString("fr-FR")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type FlowPoint = { label: string; collected: number; disbursed: number };

/** Colonnes jumelées entrées/sorties (trésorerie) : leaf = encaissé, coral = décaissé. */
export function FlowBars(props: { items: FlowPoint[]; format?: (n: number) => string }) {
  const max = Math.max(0, ...props.items.flatMap((i) => [i.collected, i.disbursed]));
  const fmt = props.format ?? ((n: number) => n.toLocaleString("fr-FR"));
  if (props.items.length === 0) return null;
  const h = (v: number) => (max > 0 && v > 0 ? `${Math.max(4, (v / max) * 100)}%` : "3%");
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-leaf-500" />
          Encaissé
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-coral-400" />
          Décaissé
        </span>
      </div>
      <div
        role="img"
        aria-label={props.items
          .map((i) => `${i.label} : encaissé ${fmt(i.collected)}, décaissé ${fmt(i.disbursed)}`)
          .join(", ")}
      >
        <div className="flex h-36 items-end gap-2">
          {props.items.map((item) => (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex h-24 w-full items-end justify-center gap-1">
                <div
                  className={`w-full max-w-4 rounded-t-lg motion-safe:transition-[height] motion-safe:duration-500 ${
                    item.collected > 0 ? "bg-leaf-500" : "bg-zinc-100"
                  }`}
                  style={{ height: h(item.collected) }}
                  title={`${item.label} — encaissé : ${fmt(item.collected)}`}
                />
                <div
                  className={`w-full max-w-4 rounded-t-lg motion-safe:transition-[height] motion-safe:duration-500 ${
                    item.disbursed > 0 ? "bg-coral-400" : "bg-zinc-100"
                  }`}
                  style={{ height: h(item.disbursed) }}
                  title={`${item.label} — décaissé : ${fmt(item.disbursed)}`}
                />
              </div>
              <span className="w-full truncate text-center text-[0.65rem] text-zinc-500">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Colonnes mensuelles : évolution (inscriptions, encaissements). */
export function TrendBars(props: {
  items: ChartPoint[];
  format?: (n: number) => string;
  tone?: "brand" | "leaf";
}) {
  const max = Math.max(0, ...props.items.map((i) => i.value));
  const fmt = props.format ?? ((n: number) => n.toLocaleString("fr-FR"));
  if (props.items.length === 0) return null;
  const bar = props.tone === "leaf" ? "bg-leaf-500" : "bg-brand-500";
  return (
    <div role="img" aria-label={props.items.map((i) => `${i.label} : ${fmt(i.value)}`).join(", ")}>
      <div className="flex h-36 items-end gap-2">
        {props.items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="text-[0.65rem] font-semibold text-ink">
              {item.value > 0 ? fmt(item.value) : ""}
            </span>
            <div className="flex h-24 w-full items-end justify-center">
              <div
                className={`w-full max-w-8 rounded-t-lg ${bar} motion-safe:transition-[height] motion-safe:duration-500 ${
                  item.value === 0 ? "bg-zinc-100" : ""
                }`}
                style={{ height: max > 0 && item.value > 0 ? `${Math.max(4, (item.value / max) * 100)}%` : "3%" }}
                title={`${item.label} : ${fmt(item.value)}`}
              />
            </div>
            <span className="w-full truncate text-center text-[0.65rem] text-zinc-500">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
