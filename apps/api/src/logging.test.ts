import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { LOG_REDACT_PATHS } from "./logging.js";

describe("logging", () => {
  it("never writes keys, secrets or auth headers", async () => {
    let output = "";
    const stream = new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const app = Fastify({
      logger: { level: "info", stream, redact: { paths: LOG_REDACT_PATHS, censor: "[redacted]" } },
    });
    app.get("/probe", async (request) => {
      request.log.info({ req: { headers: request.headers } }, "headers");
      request.log.info(
        { credential: { key: "KEY-123456", secret: "SECRET-654321" } },
        "credential",
      );
      return { ok: true };
    });

    await app.inject({
      method: "GET",
      url: "/probe",
      headers: { authorization: "Bearer TOKEN-abcdef", "x-job-secret": "JOB-999999" },
    });
    await app.close();

    expect(output).toContain("[redacted]");
    for (const secret of ["KEY-123456", "SECRET-654321", "TOKEN-abcdef", "JOB-999999"]) {
      expect(output).not.toContain(secret);
    }
  });
});
