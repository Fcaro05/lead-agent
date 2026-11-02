import { GOOGLE_PLACES_API_KEY } from "./config";
import { PlaceResult } from "./types";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.nationalPhoneNumber",
  "places.formattedAddress",
  "places.addressComponents",
  "places.primaryType",
  "places.types",
  "places.googleMapsUri",
  "nextPageToken",
].join(",");

interface PlacesApiPlace {
  id?: string;
  displayName?: { text?: string };
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
  primaryType?: string;
  types?: string[];
  googleMapsUri?: string;
}

interface PlacesApiResponse {
  places?: PlacesApiPlace[];
  nextPageToken?: string;
}

function extractCity(place: PlacesApiPlace): string {
  if (place.addressComponents) {
    const locality = place.addressComponents.find((c) =>
      c.types?.includes("locality")
    );
    if (locality?.longText) return locality.longText;

    const sublocality = place.addressComponents.find((c) =>
      c.types?.some((t) => t.startsWith("sublocality"))
    );
    if (sublocality?.longText) return sublocality.longText;
  }
  // Fallback: last comma-separated segment before country
  if (place.formattedAddress) {
    const parts = place.formattedAddress.split(",").map((s) => s.trim());
    // Try second-to-last (usually city, Province, Country pattern)
    if (parts.length >= 3) return parts[parts.length - 3] ?? parts[0] ?? "";
  }
  return "";
}

function extractCategory(place: PlacesApiPlace): string {
  if (place.primaryType) return place.primaryType.replace(/_/g, " ");
  if (place.types && place.types.length > 0) return place.types[0].replace(/_/g, " ");
  return "";
}

function mapPlace(p: PlacesApiPlace): PlaceResult | null {
  if (!p.id || !p.displayName?.text) return null;
  return {
    placeId: p.id,
    name: p.displayName.text,
    website: p.websiteUri ?? "",
    rating: p.rating,
    reviewCount: p.userRatingCount,
    phone: p.nationalPhoneNumber,
    address: p.formattedAddress ?? "",
    city: extractCity(p),
    category: extractCategory(p),
    mapsUrl: p.googleMapsUri,
  };
}

export async function searchBusinesses(
  query: string,
  limit: number
): Promise<PlaceResult[]> {
  const apiKey = GOOGLE_PLACES_API_KEY();
  const results: PlaceResult[] = [];
  let pageToken: string | undefined;

  while (results.length < limit) {
    const body: Record<string, unknown> = {
      textQuery: query,
      languageCode: "it",
      regionCode: "IT",
      maxResultCount: Math.min(20, limit - results.length),
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Places API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as PlacesApiResponse;
    const places = data.places ?? [];

    for (const p of places) {
      const mapped = mapPlace(p);
      if (mapped) results.push(mapped);
      if (results.length >= limit) break;
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return results;
}
