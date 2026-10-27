/**
 * Pele, pinned exactly (worker/package.json and app/package.json; a test holds them together). In
 * a module of its own so the main Worker can name the version (TEMPRA-167, the library's Pele
 * verdicts) without importing Pele.
 */
export const PELE_VERSION = "1.6.0";

/** Vega-Lite and Vega, pinned exactly (worker/render/package.json and app/package.json; TEMPRA-207). */
export const VEGA_LITE_VERSION = "6.5.0";
export const VEGA_VERSION = "6.4.0";

/**
 * The largest chart source drawn, in characters: a Vega-Lite fence with its data made inline
 * (TEMPRA-207; data files are capped at 2 MB each, the fence at 50,000 characters). Here so the
 * main Worker can name it without importing Vega.
 */
export const MAX_CHART_SOURCE = 4_000_000;
