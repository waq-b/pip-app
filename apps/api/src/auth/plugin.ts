import { Auth } from "@auth/core";
import type { AuthConfig } from "@auth/core";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AUTH_BASE_PATH } from "./config.js";

/**
 * There is no official Fastify adapter for Auth.js (`@auth/fastify` is not
 * published), so we mount `@auth/core`'s handler ourselves: Fastify request in,
 * Web Request out, Web Response back into the reply.
 */
export const authPlugin: FastifyPluginAsync<{ config: AuthConfig }> = async (app, opts) => {
  // Auth.js parses the form body itself, so hand it the raw string rather than
  // Fastify's parsed object.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );

  app.all(`${AUTH_BASE_PATH}/*`, async (request, reply) => {
    const response = await Auth(toWebRequest(request), opts.config);
    return sendWebResponse(reply, response);
  });
};

function toWebRequest(request: FastifyRequest): Request {
  const protocol = (request.headers["x-forwarded-proto"] as string) ?? request.protocol;
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      headers.append(key, entry);
    }
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  return new Request(url, {
    method: request.method,
    headers,
    body: hasBody ? (typeof request.body === "string" ? request.body : undefined) : undefined,
  });
}

async function sendWebResponse(reply: FastifyReply, response: Response) {
  // Set-Cookie can legitimately repeat, and Headers collapses it — getSetCookie
  // is the only way to get them all back out.
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    reply.header(key, value);
  });
  if (cookies.length > 0) {
    reply.header("set-cookie", cookies);
  }

  reply.status(response.status);
  return reply.send(await response.text());
}
