import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, STATUS_CODES } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Capabilities, CliContext } from "../../types.ts";
import { errorMessage, OmtError } from "../../util/errors.ts";
import { openUrl } from "../../util/open.ts";
import { EditorError, editorState, explainProfile, parseEditRequest, previewEdits, writeEdits } from "./api.ts";
import type { MaintainerTarget } from "./api.ts";
import { ASSETS } from "./assets.ts";
import { bundledSkillText } from "./catalog.ts";
import type { Asset } from "./assets.ts";
import { parseSkillWrite, skillFiles, writeSkillFile } from "./skillFiles.ts";

export interface ConfigEditor {
  url: string;
  port: number;
  closed: Promise<void>; // resolves when the server has stopped
  close(): Promise<void>;
}

export interface ConfigEditorOptions {
  open: boolean;
  idleMs?: number; // after the first ping, stop when no ping comes for this long
  closeGraceMs?: number; // after api/close, stop unless a ping comes within this time
  capabilities?: Capabilities; // orchestrator_capabilities output, for the provider and model lists
  maintainer?: MaintainerTarget; // edit the built-in defaults and the skill files of an omt clone
}

const MAX_BODY = 1024 * 1024;

// With Referrer-Policy no-referrer, a browser sends "Origin: null" on the page's own POST requests, which the Origin
// check refuses. The page loads nothing from another origin, so no Referer with the token leaves it.
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const CLIENT_ERROR_STATUS: Readonly<Record<string, number>> = {
  HPE_HEADER_OVERFLOW: 431,
  HPE_CHUNK_EXTENSIONS_OVERFLOW: 413,
  ERR_HTTP_REQUEST_TIMEOUT: 408,
};

const ROUTES: Readonly<Record<string, "GET" | "POST">> = {
  login: "GET",
  "login.js": "GET",
  "": "GET",
  "app.css": "GET",
  "app.js": "GET",
  "api/state": "GET",
  "api/explain": "GET",
  "api/skill": "GET",
  "api/skill-files": "GET",
  "api/skill-file": "POST",
  "api/preview": "POST",
  "api/write": "POST",
  "api/ping": "POST",
  "api/close": "POST",
};

function send(res: ServerResponse, status: number, body?: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", ...headers });
}

function errorBody(error: EditorError): unknown {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    ...(error.hint === undefined ? {} : { hint: error.hint }),
    ...(error.newErrors === undefined ? {} : { newErrors: error.newErrors }),
  };
}

function sendError(res: ServerResponse, error: EditorError, headers: Record<string, string> = {}): void {
  sendJson(res, error.status, errorBody(error), headers);
}

// For a socket that Node took away from the request listener: writes one response, then closes the socket.
function sendRaw(socket: Duplex, error: EditorError, headers: Record<string, string> = {}): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  const body = JSON.stringify(errorBody(error));
  const all = {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    ...headers,
    Connection: "close",
  };
  const lines = Object.entries(all).map(([name, value]) => `${name}: ${value}\r\n`).join("");
  socket.end(`HTTP/1.1 ${error.status} ${STATUS_CODES[error.status]}\r\n${lines}\r\n${body}`, () => socket.destroy());
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

// Stops at the first byte over MAX_BODY and drops the rest of the upload, so the client gets the 413 at once.
function readBody(req: IncomingMessage): Promise<string> {
  const tooLarge = () => new EditorError(413, "payload_too_large", "the request body is larger than 1 MiB");
  if (Number(req.headers["content-length"]) > MAX_BODY) {
    req.resume();
    return Promise.reject(tooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) {
        chunks.push(chunk);
        return;
      }
      req.off("data", onData);
      req.off("end", onEnd);
      req.resume();
      reject(tooLarge());
    };
    const onEnd = () => resolve(Buffer.concat(chunks).toString("utf8"));
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", reject);
  });
}

// Serves the config editor on 127.0.0.1 under a random token. It stops on close(), a close beacon that no ping
// follows within closeGraceMs, or no ping for idleMs after the first ping.
export async function startConfigEditor(ctx: CliContext, opts: ConfigEditorOptions, openBrowser = openUrl): Promise<ConfigEditor> {
  const idleMs = opts.idleMs ?? 120_000;
  const closeGraceMs = opts.closeGraceMs ?? 5_000;
  const token = randomBytes(32).toString("base64url");
  const tokenBytes = Buffer.from(token);
  let host = "";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  let markClosed = () => {};
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });

  // Previews and writes run one at a time, from the first read of the files to the end of the write.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };

  const routeOf = (pathname: string): string | undefined => {
    const end = token.length + 1;
    if (pathname[0] !== "/" || pathname[end] !== "/") return undefined;
    const given = Buffer.from(pathname.slice(1, end));
    if (given.length !== tokenBytes.length || !timingSafeEqual(given, tokenBytes)) return undefined;
    return pathname.slice(end + 1);
  };

  // A timer set after close() starts would keep the process alive after the server stops.
  const ping = () => {
    if (closing !== undefined) return;
    clearTimeout(graceTimer);
    graceTimer = undefined;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void close(), idleMs);
  };

  const requestClose = () => {
    if (closing !== undefined) return;
    clearTimeout(idleTimer);
    idleTimer = undefined;
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => void close(), closeGraceMs);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, route: string, query: string): Promise<void> => {
    if (Object.hasOwn(ASSETS, route)) {
      const asset = ASSETS[route] as Asset;
      return send(res, 200, asset.body, { "Content-Type": asset.type });
    }
    const maintainer = opts.maintainer;
    if (route === "api/state") return sendJson(res, 200, await editorState(ctx, opts.capabilities, maintainer));
    if (route === "api/skill") {
      const skill = await bundledSkillText(ctx.packageRoot, new URLSearchParams(query).get("name") ?? "");
      if (skill === undefined) throw new EditorError(404, "unknown_skill", "no bundled skill with this name");
      return sendJson(res, 200, skill);
    }
    if (route === "api/explain") return sendJson(res, 200, await explainProfile(ctx, new URLSearchParams(query).get("profile"), maintainer));
    if (route === "api/skill-files" || route === "api/skill-file") {
      if (maintainer === undefined) throw new EditorError(404, "not_found", "skill files are editable only in maintainer mode");
    }
    if (route === "api/skill-files") {
      const files = await skillFiles(maintainer?.skillsRoot ?? "", new URLSearchParams(query).get("name") ?? "");
      if (files === undefined) throw new EditorError(404, "unknown_skill", "no skill with this name");
      return sendJson(res, 200, { files });
    }
    const edit = route === "api/preview" || route === "api/write" || route === "api/skill-file";
    if (edit && !isJson(req.headers["content-type"])) {
      throw new EditorError(415, "unsupported_media_type", "send the request body as application/json");
    }
    const body = await readBody(req);
    if (route === "api/ping") ping();
    if (route === "api/close") requestClose();
    if (!edit) return send(res, 204);
    if (route === "api/skill-file") {
      const write = parseSkillWrite(body);
      return sendJson(res, 200, await serial(() => writeSkillFile(maintainer?.skillsRoot ?? "", write)));
    }
    const request = parseEditRequest(body);
    sendJson(res, 200, await serial<unknown>(() =>
      route === "api/write" ? writeEdits(ctx, request, opts.capabilities, maintainer) : previewEdits(ctx, request, maintainer)));
  };

  // Throws the 403 or 404 that the request earns before its method is checked.
  const check = (req: IncomingMessage): { route: string; method: "GET" | "POST"; query: string } => {
    const target = req.url ?? "";
    const queryAt = target.indexOf("?");
    if (req.headers.host !== host) throw new EditorError(403, "forbidden", "the Host header does not name this editor");
    const pathname = queryAt === -1 ? target : target.slice(0, queryAt);
    const route = pathname === "/" ? "login" : pathname === "/login.js" ? "login.js" : routeOf(pathname);
    if (route === undefined || !Object.hasOwn(ROUTES, route)) throw new EditorError(404, "not_found", "not found");
    const origin = req.headers.origin;
    const foreign = () => new EditorError(403, "forbidden", "the request does not come from the editor page");
    if (origin === undefined ? req.method === "POST" : origin !== `http://${host}`) throw foreign();
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") throw foreign();
    return { route, method: ROUTES[route] as "GET" | "POST", query: queryAt === -1 ? "" : target.slice(queryAt + 1) };
  };

  // CONNECT and protocol upgrades: the same checks, and a 405 on a valid path.
  const refuse = (req: IncomingMessage, socket: Duplex): void => {
    try {
      const { method } = check(req);
      sendRaw(socket, new EditorError(405, "method_not_allowed", `use ${method} without an upgrade`), { Allow: method });
    } catch (error) {
      sendRaw(socket, error instanceof EditorError ? error : new EditorError(400, "bad_request", "bad request"));
    }
  };

  const respond = async (req: IncomingMessage, res: ServerResponse, continueFirst = false): Promise<void> => {
    try {
      const { route, method, query } = check(req);
      if (req.method !== method) {
        sendError(res, new EditorError(405, "method_not_allowed", `use ${method}`), { Allow: method });
        return;
      }
      const expect = req.headers.expect;
      if (expect !== undefined && expect.trim().toLowerCase() !== "100-continue") {
        throw new EditorError(417, "expectation_failed", "the editor meets no expectation but 100-continue");
      }
      if (continueFirst) res.writeContinue();
      await handle(req, res, route, query);
    } catch (error) {
      if (error instanceof EditorError) {
        sendError(res, error, error.status === 413 ? { Connection: "close" } : {});
        return;
      }
      ctx.stderr(`warning: config editor: ${errorMessage(error)}\n`);
      sendJson(res, 500, { ok: false, code: "internal_error", message: errorMessage(error) });
    }
  };

  // Without requireHostHeader: false, Node answers a request with no Host itself, with 400 and no security headers.
  const server = createServer({ requireHostHeader: false }, (req, res) => {
    void respond(req, res);
  });
  // Without these listeners, Node answers an Expect header itself, before the checks and without the security headers.
  server.on("checkContinue", (req, res) => {
    void respond(req, res, true);
  });
  server.on("checkExpectation", (req, res) => {
    void respond(req, res);
  });
  // Without a connect listener, Node closes the socket of a CONNECT request with no response.
  server.on("connect", refuse);
  server.on("upgrade", refuse);

  const close = (): Promise<void> => {
    closing ??= (async () => {
      clearTimeout(idleTimer);
      clearTimeout(graceTimer);
      const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      await tail;
      server.closeAllConnections();
      await stopped;
      markClosed();
    })();
    return closing;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    throw new OmtError("editor_listen", `cannot start the config editor on 127.0.0.1: ${errorMessage(error)}`, { cause: error });
  }
  // Node's own answer to a request that does not parse has none of the security headers.
  server.on("clientError", (error: NodeJS.ErrnoException, socket) => {
    if (!socket.writable || error.code === "ECONNRESET") {
      socket.destroy();
      return;
    }
    const status = CLIENT_ERROR_STATUS[error.code ?? ""] ?? 400;
    sendRaw(socket, new EditorError(status, "bad_request", "the HTTP request does not parse"));
  });
  server.on("error", (error) => ctx.stderr(`warning: config editor: ${errorMessage(error)}\n`));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  host = `127.0.0.1:${port}`;
  const url = `http://${host}/${token}/`;
  if (opts.open) {
    void openBrowser(`http://${host}/`).then((opened) => {
      if (!opened) ctx.stderr("warning: could not open a browser; open the URL yourself\n");
    });
  }
  return { url, port, closed, close };
}
