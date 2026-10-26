/**
 * Getting a file's bytes in (TEMPRA-156, TEMPRA-158). An agent with a shell asks for an upload
 * URL (MCP `prepare_upload`, REST `POST …/uploads`) and PUTs the file to it; an agent without
 * one sends small files to `attach` as base64, checked against the size and hash it declares.
 * Free of Worker APIs.
 */
import type { TokenInfo } from "./auth";
import { type LibraryClient, WORKER_ATTACHMENT_CAP } from "./client";
import { sha256Hex } from "./okf/hash";
import { OkfError } from "./store/errors";
import type { RequestContext } from "./store/store";

/**
 * How long an upload URL and its page stay good: long enough for a person to switch from a chat
 * to their files and back (TEMPRA-196).
 */
export const UPLOAD_TTL_SECONDS = 60 * 60;

/**
 * The most MCP `attach` takes as `content_base64`, decoded (TEMPRA-156, tempra-dev app/media,
 * Limits): the model types every byte, so anything bigger goes by `source_url` or
 * `prepare_upload`. REST, uploads, fetches and import keep WORKER_ATTACHMENT_CAP.
 */
export const BASE64_MAX_BYTES = 256 * 1024;

/** What an upload URL's token carries: the write to apply when the bytes arrive, and as whom. */
export interface UploadGrant {
  k: "upload";
  /** Null for a blob-first upload (REST): the PUT stores the bytes and answers with their hash. */
  path: string | null;
  media: string | null;
  size?: number;
  sha256?: string;
  if_match?: string;
  /** What the file shows, kept with the attach op (TEMPRA-157, for the file's page). */
  description?: string;
  /** Who made it and its licence (TEMPRA-170). */
  credit?: string;
  licence?: string;
  note: string | null;
  actor: string;
  by: RequestContext["by"];
  /** The caller as it was when it asked; checked again when the bytes arrive. */
  token: TokenInfo;
}

export interface Declared {
  size?: number;
  sha256?: string;
}

/** Checks a declared size and hash as given, before any bytes move. */
export function checkDeclared({ size, sha256 }: Declared): Declared {
  if (size !== undefined && (!Number.isInteger(size) || size < 0)) {
    throw new OkfError(400, "bad_size", "`size` is the file's length in bytes, an integer.");
  }
  if (size !== undefined && size > WORKER_ATTACHMENT_CAP) {
    throw new OkfError(
      413,
      "attachment_too_large",
      `Attachments are capped at ${WORKER_ATTACHMENT_CAP} bytes; this one is ${size}.`,
    );
  }
  const hash = sha256?.trim().toLowerCase();
  if (hash !== undefined && !/^[0-9a-f]{64}$/.test(hash)) {
    throw new OkfError(400, "bad_sha256", "`sha256` is the file's SHA-256 as 64 hex digits.");
  }
  return { size, sha256: hash };
}

/**
 * The bytes against what the caller said they are: refused with what arrived, so an agent can
 * see how far a truncated or garbled send got.
 */
export function checkBytes(bytes: Uint8Array, want: Declared): string {
  const hash = sha256Hex(bytes);
  const sizeOff = want.size !== undefined && want.size !== bytes.length;
  const hashOff = want.sha256 !== undefined && want.sha256 !== hash;
  if (sizeOff || hashOff) {
    const said = [
      ...(want.size !== undefined ? [`size ${want.size}`] : []),
      ...(want.sha256 !== undefined ? [`sha256 ${want.sha256}`] : []),
    ].join(", ");
    throw new OkfError(
      400,
      "checksum_mismatch",
      `The bytes received do not match what was declared (${said}): received ${bytes.length} bytes, sha256 ${hash}. Nothing was written; send the file again.`,
      { received_size: bytes.length, received_sha256: hash },
    );
  }
  return hash;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Strict base64 (TEMPRA-156): whitespace is dropped, then the length must be a multiple of 4
 * and every character in the standard alphabet, padding only at the end. `atob` alone accepts
 * unpadded and some sloppy input, which hides a truncated send. Refused past `max` decoded bytes
 * (`base64_too_large`), worked out from the text's length before anything is decoded.
 */
export function decodeBase64(text: string, max = BASE64_MAX_BYTES): Uint8Array {
  const s = text.replace(/\s+/g, "");
  if (s.length % 4 !== 0 || !BASE64.test(s)) {
    throw new OkfError(
      400,
      "bad_base64",
      `content_base64 is not valid base64 (${s.length} characters after whitespace; a whole base64 string is a multiple of 4, from A-Z a-z 0-9 + / with = padding only at the end). It may have been cut short.`,
    );
  }
  // The decoded length from the text's, before decoding anything.
  const size = (s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
  if (size > max) {
    throw new OkfError(
      400,
      "base64_too_large",
      `content_base64 decodes to ${size} bytes, over the limit of ${max} bytes (${max / 1024} KB). Nothing was written. For an image on the web, use \`attach\` with \`source_url\`; for a file you made, with a shell, use \`prepare_upload\` and PUT the file (up to ${WORKER_ATTACHMENT_CAP / 1048576} MB).`,
      { size, limit: max },
    );
  }
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** A request body read whole, refused once it passes `cap` (no Content-Length is trusted). */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  cap = WORKER_ATTACHMENT_CAP,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new OkfError(413, "attachment_too_large", `Attachments are capped at ${cap} bytes.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * The URL to PUT a file to, a curl line that does it, and for a file at a path, the page a
 * signed-in person opens to send it from their browser instead (TEMPRA-196); one token for all.
 */
export async function prepareUpload(
  lib: LibraryClient,
  origin: string,
  grant: Omit<UploadGrant, "k">,
): Promise<{ url: string; method: "PUT"; expires: string; curl: string; upload_page?: string }> {
  const token = await lib.signUpload({ k: "upload", ...grant }, UPLOAD_TTL_SECONDS);
  const { do_id, owner, slug } = grant.token.library;
  const url = `${origin}/ul/${encodeURIComponent(do_id)}/${token}`;
  const file = grant.path?.split("/").pop() || "<file>";
  return {
    url,
    method: "PUT",
    expires: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    curl: `curl -sS -T ${shellQuote(file)} '${url}'`,
    // Grants from before A1 carry no owner handle, so no page address.
    ...(grant.path && owner
      ? {
          upload_page: `${origin}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/-/upload/${token}`,
        }
      : {}),
  };
}

/** A filename for the curl line, quoted when the shell would split or expand it. */
function shellQuote(s: string): string {
  return /^[A-Za-z0-9._@%+=:,/-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

/** The type the PUT says, when it says one, must be the type declared at prepare. */
export function checkMedia(declared: string | null, header: string | undefined): void {
  const sent = header?.split(";")[0]?.trim().toLowerCase();
  if (!sent || sent === "application/octet-stream" || declared === null) return;
  if (sent !== declared.toLowerCase()) {
    throw new OkfError(
      400,
      "media_mismatch",
      `This upload was prepared for ${declared}, but the request says ${sent}. Prepare it again with the right media, or send no Content-Type.`,
    );
  }
}
