import { Fetch, HttpRequestError } from "../http/undici.js";

export type GoogleSearchResult = {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  thumbnail?: string;
};

export type GoogleSearchHighlight = {
  title: string;
  description: string;
  sourceName?: string;
  sourceLink?: string;
  image?: string;
};

export type GoogleSearchLocalPlace = {
  title: string;
  type?: string;
  rating?: number;
  reviews?: number;
  address?: string;
  thumbnail?: string;
};

export type GoogleSearchQuestion = {
  question: string;
  snippet?: string;
  title?: string;
  link?: string;
};

const GOOGLE_DEBUG = (process.env.GOOGLE_DEBUG ?? "false").trim().toLowerCase() === "true";
const GOOGLE_RESULT_LIMIT_DEFAULT = 5;

function resolveGoogleResultLimit(): number {
  const raw = process.env.GOOGLE_RESULT_LIMIT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : GOOGLE_RESULT_LIMIT_DEFAULT;
  if (!Number.isFinite(parsed)) return GOOGLE_RESULT_LIMIT_DEFAULT;
  return Math.max(1, Math.min(10, parsed));
}

export const GOOGLE_RESULT_LIMIT = resolveGoogleResultLimit();

function debugLog(scope: string, message: string, meta?: unknown): void {
  if (!GOOGLE_DEBUG) return;
  if (meta !== undefined) {
    console.debug(`[google-search][${scope}] ${message}`, meta);
    return;
  }
  console.debug(`[google-search][${scope}] ${message}`);
}

type SerpApiResponse = {
  error?: string;
  search_metadata?: { status?: string };
  search_information?: { corrected_query?: string };
  organic_results?: Array<{
    title?: string;
    link?: string;
    source?: string;
    snippet?: string;
    thumbnail?: string;
  }>;
  knowledge_graph?: {
    title?: string;
    description?: string;
    source?: { name?: string; link?: string };
    header_images?: Array<{ image?: string; source?: string }>;
  };
  local_results?: {
    places?: Array<{
      title?: string;
      type?: string;
      rating?: number;
      reviews?: number;
      address?: string;
      thumbnail?: string;
    }>;
  };
  related_questions?: Array<{
    question?: string;
    snippet?: string;
    title?: string;
    link?: string;
  }>;
};

export async function searchGoogle(query: string): Promise<{
  results: GoogleSearchResult[];
  highlights: GoogleSearchHighlight[];
  localPlaces: GoogleSearchLocalPlace[];
  relatedQuestions: GoogleSearchQuestion[];
  didYouMean?: string;
  error?: string;
}> {
  debugLog("pipeline", "start", { query });
  const apiKey = process.env.SERPAPI_KEY?.trim();
  if (!apiKey) {
    return {
      results: [],
      highlights: [],
      localPlaces: [],
      relatedQuestions: [],
      error: "missing_serpapi_key",
    };
  }
  const url = `https://serpapi.com/search.json?engine=google&hl=en&gl=us&num=${String(GOOGLE_RESULT_LIMIT)}&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
  try {
    debugLog("serpapi", "request", { url: "https://serpapi.com/search.json?...", query });
    const data = await Fetch<SerpApiResponse>(url, { mode: "strict" });
    if (data.error) {
      debugLog("serpapi", "api-error", data.error);
      return {
        results: [],
        highlights: [],
        localPlaces: [],
        relatedQuestions: [],
        error: data.error,
      };
    }
    const results = (data.organic_results ?? [])
      .map((r) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        source: r.source?.trim() || undefined,
        snippet: r.snippet?.trim() || undefined,
        thumbnail: r.thumbnail?.trim() || undefined,
      }))
      .filter((r) => r.title.length > 0 && r.url.startsWith("http"))
      .slice(0, GOOGLE_RESULT_LIMIT);
    const kg = data.knowledge_graph;
    const highlights: GoogleSearchHighlight[] = [];
    if (kg?.title && kg.description) {
      highlights.push({
        title: kg.title,
        description: kg.description,
        sourceName: kg.source?.name?.trim() || undefined,
        sourceLink: kg.source?.link?.trim() || undefined,
        image: kg.header_images?.[0]?.image?.trim() || undefined,
      });
    }
    const localPlaces = (data.local_results?.places ?? [])
      .map((p) => ({
        title: p.title ?? "",
        type: p.type?.trim() || undefined,
        rating: typeof p.rating === "number" ? p.rating : undefined,
        reviews: typeof p.reviews === "number" ? p.reviews : undefined,
        address: p.address?.trim() || undefined,
        thumbnail: p.thumbnail?.trim() || undefined,
      }))
      .filter((p) => p.title.length > 0)
      .slice(0, 3);
    const relatedQuestions = (data.related_questions ?? [])
      .map((q) => ({
        question: q.question ?? "",
        snippet: q.snippet?.trim() || undefined,
        title: q.title?.trim() || undefined,
        link: q.link?.trim() || undefined,
      }))
      .filter((q) => q.question.length > 0)
      .slice(0, 3);
    const didYouMean = data.search_information?.corrected_query;
    debugLog("pipeline", "winner", {
      source: "serpapi",
      count: results.length,
      highlightCount: highlights.length,
      localCount: localPlaces.length,
      relatedQuestionCount: relatedQuestions.length,
      didYouMean: didYouMean ?? "",
    });
    return {
      results,
      highlights,
      localPlaces,
      relatedQuestions,
      didYouMean: didYouMean || undefined,
    };
  } catch (err) {
    if (err instanceof HttpRequestError) {
      debugLog("serpapi", "http-error", { status: err.status, causeCode: err.causeCode });
      if (err.status) {
        return {
          results: [],
          highlights: [],
          localPlaces: [],
          relatedQuestions: [],
          error: `serpapi_http_${String(err.status)}`,
        };
      }
    }
    debugLog("serpapi", "error", err instanceof Error ? err.message : String(err));
    return {
      results: [],
      highlights: [],
      localPlaces: [],
      relatedQuestions: [],
      error: "serpapi_fetch_failed",
    };
  }
}
