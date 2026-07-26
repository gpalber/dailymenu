import { useEffect, useState } from "react";
import type { RestaurantListResponse, RestaurantSummary } from "@dailymenu/schema";

// Slice-0 bare list. Real UI (map, filters, PWA, i18n) arrives in Slice 3.
const DISTRICTS = ["Todos", "Centro", "Salamanca", "Chamberí"];

function Badge({ r }: { r: RestaurantSummary }) {
  const c = r.classification;
  if (c.offers_menu === true)
    return <span style={{ color: "#1a7f37" }}>✓ menú del día{c.confidence != null ? ` (${Math.round(c.confidence * 100)}%)` : ""}</span>;
  if (c.offers_menu === false) return <span style={{ color: "#777" }}>sin menú del día</span>;
  return <span style={{ color: "#b58900" }}>pendiente de análisis</span>;
}

export function App() {
  const [data, setData] = useState<RestaurantListResponse | null>(null);
  const [district, setDistrict] = useState("Todos");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: "100" });
    if (district !== "Todos") qs.set("district", district);
    fetch(`/api/restaurants?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [district]);

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
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      {!data && !error && <p>Cargando…</p>}
      {data && (
        <>
          <p style={{ fontSize: 13, color: "#666" }}>{data.total} locales mostrados</p>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {data.restaurants.map((r) => (
              <li key={r.id} style={{ borderBottom: "1px solid #eee", padding: "10px 0" }}>
                <strong>{r.name}</strong>{" "}
                <span style={{ color: "#999", fontSize: 12 }}>
                  {r.district} · {r.amenity}
                  {r.cuisine ? ` · ${r.cuisine.split(";")[0]}` : ""}
                </span>
                <div style={{ fontSize: 13 }}>
                  <Badge r={r} />
                  {r.current_offer?.price_eur != null && (
                    <span> · {r.current_offer.price_eur.toFixed(2)} € ({r.current_offer.freshness})</span>
                  )}
                  {r.website && (
                    <>
                      {" · "}
                      <a href={r.website} target="_blank" rel="noopener noreferrer">web</a>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
