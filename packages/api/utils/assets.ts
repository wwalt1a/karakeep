import { Readable } from "stream";

import { Context } from "hono";
import { stream } from "hono/streaming";

import {
  createAssetReadStream,
  getAssetSize,
  readAssetMetadata,
} from "@karakeep/shared/assetdb";

import { toWebReadableStream } from "./upload";

// CSS injected into HTML assets to hide <noscript> fallback messages.
// The CSP sandbox directive disables scripting, which causes browsers to
// render <noscript> content.  SingleFile snapshots already contain the
// fully-rendered DOM, so <noscript> elements (e.g. x.com's "JavaScript
// is disabled" banner) are redundant and should be hidden.
const NOSCRIPT_HIDE_STYLE = `<style>noscript{display:none!important}</style>`;
const NOSCRIPT_HIDE_BYTES = new TextEncoder().encode(NOSCRIPT_HIDE_STYLE);

export async function serveAsset(c: Context, assetId: string, userId: string) {
  const [metadata, size] = await Promise.all([
    readAssetMetadata({
      userId,
      assetId,
    }),

    getAssetSize({
      userId,
      assetId,
    }),
  ]);

  const isHtml = metadata.contentType.startsWith("text/html");

  // Default Headers
  c.header("Content-type", metadata.contentType);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  c.header(
    "Content-Security-Policy",
    [
      "sandbox",
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "img-src https: data: blob:",
      "style-src 'unsafe-inline' https:",
      "connect-src 'none'",
      "media-src https: data: blob:",
      "object-src 'none'",
      "frame-src 'none'",
    ].join("; "),
  );

  const range = c.req.header("Range");
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

    const fStream = await createAssetReadStream({
      userId,
      assetId,
      start,
      end,
    });
    c.status(206); // Partial Content
    c.header("Content-Range", `bytes ${start}-${end}/${size}`);
    c.header("Accept-Ranges", "bytes");
    c.header("Content-Length", (end - start + 1).toString());
    return stream(c, async (stream) => {
      await stream.pipe(toWebReadableStream(fStream));
    });
  } else {
    c.status(200);
    c.header(
      "Content-Length",
      (size + (isHtml ? NOSCRIPT_HIDE_BYTES.length : 0)).toString(),
    );
    return stream(c, async (stream) => {
      if (isHtml) {
        // Concatenate the injected CSS prefix and the file stream into one
        // Node Readable, then pipe it as a single Web ReadableStream.
        // Mixing stream.write() followed by stream.pipe() releases and
        // re-acquires the underlying writer lock, which corrupts the
        // TransformStream state in Node.js and causes a TypeError.
        const prefix = Readable.from([NOSCRIPT_HIDE_BYTES]);
        const fileStream = await createAssetReadStream({ userId, assetId });
        const combined = Readable.from(
          (async function* () {
            for await (const chunk of prefix) {
              yield chunk as Buffer;
            }
            for await (const chunk of fileStream) {
              yield chunk as Buffer;
            }
          })(),
        );
        await stream.pipe(toWebReadableStream(combined));
      } else {
        const fStream = await createAssetReadStream({
          userId,
          assetId,
        });
        await stream.pipe(toWebReadableStream(fStream));
      }
    });
  }
}
