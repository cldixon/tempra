/**
 * Pele, pinned exactly (worker/package.json and app/package.json; a test holds them together). In
 * a module of its own so the main Worker can name the version (TEMPRA-167, the library's Pele
 * verdicts) without importing Pele.
 */
export const PELE_VERSION = "1.6.0";
