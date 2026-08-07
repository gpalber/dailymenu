import { useEffect, useState } from "react";
import type { RestaurantDetail, RestaurantListResponse, RestaurantSummary } from "@dailymenu/schema";

// Slice-0/1 list. Real UI (map, filters, PWA, i18n) arrives in Slice 3.
const DISTRICTS = ["Todos", "Centro", "Salamanca", "Chamberí"];
const PAGE_SIZE = 100;

const FRESHNESS_ES: Record<string, string> = {
  today: "confirmado hoy",
  recent: "visto recientemente",
  typical: "menú habitual (sin fecha confirmada)",
};

// Server already orders menú-first; grouping here mirrors it so the sections are explicit.
type GroupKey = "menu" | "no_menu" | "pending";
const groupOf = (r: RestaurantSummary): GroupKey =>
  r.classification.offers_menu === true ? "menu" : r.classification.offers_menu === false ? "no_menu" : "pending";

const GROUPS: { key: GroupKey; title: string; hint: string; color: string }[] = [
  { key: "menu", title: "Con menú del día", hint: "Detectado en la web del local — cada dato con su fuente y fecha.", color: "#1a7f37" },
  { key: "no_menu", title: "Sin menú del día", hint: "Su web no menciona menú del día. Puede que lo sirvan sin anunciarlo.", color: "#666" },
  { key: "pending", title: "Pendientes de análisis", hint: "Sin web utilizable o pendiente de revisión manual.", color: "#b58900" },
];

const KIND_ES: Record<string, string> = {
  menu_del_dia: "Menú del día",
  menu_ejecutivo: "Menú ejecutivo",
  menu_diario: "Menú diario",
  menu_cerrado: "Menú cerrado",
  other: "Menú",
};
const COURSE_ES: Record<string, string> = {
  primero: "Primero", segundo: "Segundo", postre: "Postre", otro: "Otro",
};

/** Street address: what tells two "100 Montaditos" apart. Falls back to district. */
function addressOf(r: RestaurantSummary): string {
  if (!r.addr_street) return r.district;
  return r.addr_housenumber ? `${r.addr_street} ${r.addr_housenumber}` : r.addr_street;
}

function WhatIsIt() {
  return (
    <details style={{ background: "#fdf6ef", border: "1px solid #f0e0d0", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
      <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#b3541e" }}>
        ¿Qué es el menú del día?
      </summary>
      <div style={{ fontSize: 13, color: "#555", marginTop: 8, lineHeight: 1.5 }}>
        <p style={{ margin: "0 0 8px" }}>
          Fórmula de comida a precio cerrado que sirven muchos restaurantes de Madrid entre semana,
          normalmente de 13:00 a 16:00. Suele incluir:
        </p>
        <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          <li><strong>Primer plato</strong> a elegir (ensalada, legumbre, sopa, pasta…)</li>
          <li><strong>Segundo plato</strong> a elegir (carne, pescado, huevos…)</li>
          <li><strong>Postre o café</strong></li>
          <li><strong>Bebida</strong> y <strong>pan</strong> incluidos</li>
        </ul>
        <p style={{ margin: 0 }}>
          El precio habitual en Madrid va de 12 € a 20 €, algo más alto en el centro.
          Muchos locales lo cambian a diario; otros mantienen una carta fija de menú.
        </p>
      </div>
    </details>
  );
}

function MenuDetail({ detail }: { detail: RestaurantDetail | undefined }) {
  if (!detail) return <p style={{ fontSize: 12, color: "#999", margin: "8px 0" }}>Cargando…</p>;
  const offer = detail.current_offer;
  const byCourse = ["primero", "segundo", "postre", "otro"].map((course) => ({
    course,
    items: detail.dishes.filter((d) => d.course === course),
  })).filter((g) => g.items.length > 0);

  return (
    <div style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 6, padding: 10, margin: "8px 0", fontSize: 13 }}>
      {offer ? (
        <>
          <div style={{ marginBottom: 6 }}>
            <strong>{KIND_ES[offer.kind] ?? "Menú"}</strong>
            {offer.price_eur != null ? ` — ${offer.price_eur.toFixed(2)} €` : " — precio no publicado en su web"}
            {offer.price_notes && <span style={{ color: "#777" }}> ({offer.price_notes})</span>}
          </div>
          {byCourse.length > 0 ? (
            byCourse.map((g) => (
              <div key={g.course} style={{ marginBottom: 4 }}>
                <span style={{ color: "#777" }}>{COURSE_ES[g.course]}:</span>{" "}
                {g.items.map((d) => d.name).join(", ")}
              </div>
            ))
          ) : (
            <p style={{ margin: "4px 0", color: "#888" }}>
              Todavía no hemos extraído los platos concretos de este menú. No los inventamos:
              cuando los publiquen en su web y podamos leerlos, aparecerán aquí con su fecha.
            </p>
          )}
          <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>
            {FRESHNESS_ES[offer.freshness]}
            {offer.provenance.fetched_at && ` · visto el ${new Date(offer.provenance.fetched_at).toLocaleDateString("es-ES")}`}
            {offer.provenance.provenance === "manually_verified" && " · verificado manualmente"}
          </div>
        </>
      ) : (
        <p style={{ margin: 0, color: "#888" }}>
          No hemos encontrado un menú del día publicado en su web.
        </p>
      )}
      {detail.opening_hours_raw && (
        <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>Horario: {detail.opening_hours_raw}</div>
      )}
      <div style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {offer?.provenance.source_url && (
          <a href={offer.provenance.source_url} target="_blank" rel="noopener noreferrer">página del menú</a>
        )}
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${detail.name} ${addressOf(detail)} Madrid`)}`} target="_blank" rel="noopener noreferrer">
          cómo llegar
        </a>
        {detail.phone && <a href={`tel:${detail.phone}`}>llamar</a>}
        <a href={detail.osm_url} target="_blank" rel="noopener noreferrer" style={{ color: "#999" }}>OSM</a>
      </div>
    </div>
  );
}

function Badge({ r }: { r: RestaurantSummary }) {
  const c = r.classification;
  if (c.offers_menu === true)
    return <span style={{ color: "#1a7f37" }}>✓ menú del día{c.confidence != null ? ` (${Math.round(c.confidence * 100)}%)` : ""}</span>;
  if (c.offers_menu === false) return <span style={{ color: "#777" }}>sin menú del día</span>;
  return <span style={{ color: "#b58900" }}>pendiente de análisis</span>;
}

export function App() {
  const [items, setItems] = useState<RestaurantSummary[]>([]);
  const [meta, setMeta] = useState<Omit<RestaurantListResponse, "restaurants"> | null>(null);
  const [district, setDistrict] = useState("Todos");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, RestaurantDetail>>({});

  async function toggleDetail(id: string) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    if (details[id]) return;
    try {
      const res = await fetch(`/api/restaurants/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: RestaurantDetail = await res.json();
      setDetails((prev) => ({ ...prev, [id]: d }));
    } catch {
      setOpenId(null);
    }
  }

  async function load(offset: number, replace: boolean) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (district !== "Todos") qs.set("district", district);
      const res = await fetch(`/api/restaurants?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RestaurantListResponse = await res.json();
      const { restaurants, ...rest } = data;
      setItems((prev) => (replace ? restaurants : [...prev, ...restaurants]));
      setMeta(rest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(0, true);
  }, [district]);

  const shown = items.length;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Menú del Día — Madrid</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        v0 en construcción: lista base de locales en Centro, Salamanca y Chamberí.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {DISTRICTS.map((d) => (
          <button
            key={d}
            onClick={() => setDistrict(d)}
            style={{
              padding: "6px 12px", borderRadius: 16, border: "1px solid #ccc", cursor: "pointer",
              background: district === d ? "#b3541e" : "#fff", color: district === d ? "#fff" : "#333",
            }}
          >
            {d}
          </button>
        ))}
      </div>

      <WhatIsIt />

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      {!meta && !error && <p>Cargando…</p>}

      {meta && (
        <>
          <p style={{ fontSize: 13, color: "#666" }}>
            Mostrando {shown} de {meta.total} locales
          </p>
          {GROUPS.map(({ key, title, hint, color }) => {
            const group = items.filter((r) => groupOf(r) === key);
            if (group.length === 0) return null;
            return (
              <section key={key}>
                <h2 style={{ fontSize: 15, marginBottom: 2, marginTop: 20, color }}>
                  {title} ({group.length})
                </h2>
                <p style={{ fontSize: 12, color: "#888", margin: "0 0 6px" }}>{hint}</p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {group.map((r) => (
                    <li key={r.id} style={{ borderBottom: "1px solid #eee", padding: "10px 0" }}>
                      <strong>{r.name}</strong>{" "}
                      <span style={{ color: "#999", fontSize: 12 }}>
                        {r.amenity}
                        {r.cuisine ? ` · ${r.cuisine.split(";")[0]}` : ""}
                      </span>
                      <div style={{ fontSize: 12, color: "#777" }}>
                        {addressOf(r)} · {r.district}
                        {r.distance_m != null && ` · a ${r.distance_m} m`}
                      </div>
                      <div style={{ fontSize: 13 }}>
                        <Badge r={r} />
                        {r.current_offer?.price_eur != null && (
                          <span> · <strong>{r.current_offer.price_eur.toFixed(2)} €</strong></span>
                        )}
                        {r.website && (
                          <>
                            {" · "}
                            <a href={r.website} target="_blank" rel="noopener noreferrer">web</a>
                          </>
                        )}
                      </div>
                      {r.current_offer && (
                        <div style={{ fontSize: 11, color: "#999" }}>
                          {FRESHNESS_ES[r.current_offer.freshness]}
                          {r.current_offer.provenance.fetched_at &&
                            ` · visto el ${new Date(r.current_offer.provenance.fetched_at).toLocaleDateString("es-ES")}`}
                        </div>
                      )}
                      <button
                        onClick={() => toggleDetail(r.id)}
                        aria-expanded={openId === r.id}
                        style={{
                          marginTop: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer",
                          borderRadius: 12, border: "1px solid #ddd", background: "#fff", color: "#555",
                        }}
                      >
                        {openId === r.id ? "▴ Ocultar" : "▾ Ver menú y detalles"}
                      </button>
                      {openId === r.id && <MenuDetail detail={details[r.id]} />}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {meta.has_more && (
            <button
              onClick={() => load(shown, false)}
              disabled={loading}
              style={{
                display: "block", width: "100%", marginTop: 20, padding: "12px 16px",
                borderRadius: 8, border: "1px solid #b3541e", cursor: loading ? "wait" : "pointer",
                background: "#fff", color: "#b3541e", fontSize: 15,
              }}
            >
              {loading ? "Cargando…" : `Cargar más (${meta.total - shown} restantes)`}
            </button>
          )}
          {!meta.has_more && shown > 0 && (
            <p style={{ fontSize: 12, color: "#999", textAlign: "center", marginTop: 16 }}>
              Fin de la lista
            </p>
          )}
        </>
      )}

      <footer style={{ fontSize: 12, color: "#888", marginTop: 24 }}>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          Datos de restaurantes © OpenStreetMap contributors
        </a>{" "}
        (ODbL)
      </footer>
    </main>
  );
}
