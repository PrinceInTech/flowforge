import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyInstance } from "fastify";

/**
 * Makes the API accept POST/PUT/PATCH requests that carry
 * `Content-Type: application/json` with an empty body. Fastify's default JSON
 * parser rejects those with a 500 ("Body cannot be empty"), which breaks
 * bodyless endpoints (e.g. run retry/cancel called from the SPA). Empty bodies
 * parse to `{}`.
 *
 * Must be called on the app instance before listen/init. Shared by the
 * production bootstrap and the e2e harness so tests exercise the same body
 * handling as production.
 */
export function useLenientJsonBodyParser(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.removeContentTypeParser("application/json");
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        const raw = typeof body === "string" ? body.trim() : "";
        done(null, raw.length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
}
