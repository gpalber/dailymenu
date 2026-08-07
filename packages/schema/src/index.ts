import { z } from "zod";

// API contract shared by web (and future native clients).
// Provenance is part of the contract: facts without source+date don't ship.

export const Freshness = z.enum(["today", "recent", "typical"]);
export type Freshness = z.infer<typeof Freshness>;

export const ProvenanceSchema = z.object({
  source_url: z.string().nullable(),
  fetched_at: z.string().nullable(), // ISO timestamp of the underlying snapshot / manual verification
  provenance: z.enum(["extracted", "manually_verified"]).nullable(),
});

export const ClassificationSchema = z.object({
  offers_menu: z.boolean().nullable(), // null = not yet classified
  confidence: z.number().nullable(),
});

export const CurrentOfferSchema = z.object({
  kind: z.string(),
  price_eur: z.number().nullable(),
  price_notes: z.string().nullable(),
  /** What the menú includes (courses, drink, bread…) as stated by the restaurant. */
  includes_text: z.string().nullable(),
  /** When it's served, as stated by the restaurant. */
  served_text: z.string().nullable(),
  freshness: Freshness,
  as_of_date: z.string().nullable(),
  provenance: ProvenanceSchema,
});

export const RestaurantSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  district: z.string(),
  amenity: z.string(),
  cuisine: z.string().nullable(),
  website: z.string().nullable(),
  // Street address disambiguates chains sharing a name (e.g. several "100 Montaditos").
  addr_street: z.string().nullable(),
  addr_housenumber: z.string().nullable(),
  distance_m: z.number().nullable(), // present when the query had a location
  classification: ClassificationSchema,
  current_offer: CurrentOfferSchema.nullable(),
});
export type RestaurantSummary = z.infer<typeof RestaurantSummarySchema>;

export const DishSchema = z.object({
  course: z.enum(["primero", "segundo", "postre", "otro"]),
  name: z.string(),
  position: z.number(),
});

export const RestaurantDetailSchema = RestaurantSummarySchema.extend({
  addr_street: z.string().nullable(),
  addr_housenumber: z.string().nullable(),
  addr_postcode: z.string().nullable(),
  instagram: z.string().nullable(),
  phone: z.string().nullable(),
  opening_hours_raw: z.string().nullable(),
  osm_url: z.string(),
  dishes: z.array(DishSchema),
});
export type RestaurantDetail = z.infer<typeof RestaurantDetailSchema>;

export const RestaurantListResponseSchema = z.object({
  restaurants: z.array(RestaurantSummarySchema),
  /** Rows in this page. */
  count: z.number(),
  /** Rows matching the filters across all pages. */
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
  attribution: z.literal("Datos de restaurantes © OpenStreetMap contributors (ODbL)"),
});
export type RestaurantListResponse = z.infer<typeof RestaurantListResponseSchema>;
