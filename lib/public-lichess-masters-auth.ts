import { Chess, DEFAULT_POSITION } from "chess.js";

const tokenEndpoint = "https://lichess.org/api/token";
const clientId = "knightforge-masters";
const callbackPath = "/openings";
const transactionLifetime = 10 * 60_000;
export const mastersTransactionKey = "knightforge:masters-pkce:v1";
export const mastersCallbackFields = ["code", "state", "error", "error_description", "error_uri"] as const;

type Transaction = { state: string; verifier: string; redirectUri: string; createdAt: number };
type Callback = Transaction & { code: string };
export type MastersConnection = { token: string; expiresAt: number };

const pkceValue = /^[A-Za-z0-9_-]{43}$/;
const lichessValue = /^[A-Za-z0-9_]+$/;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export async function beginMastersAuthorization(origin: string, now = Date.now()) {
  const website = new URL(origin);
  if (website.protocol !== "https:" && !(website.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(website.hostname))) {
    throw new Error("Lichess connections require HTTPS or a local browser preview.");
  }
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = new URL(callbackPath, website).href;
  const challenge = encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const url = new URL("https://lichess.org/oauth");
  url.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    code_challenge_method: "S256", code_challenge: challenge, state,
  }).toString();
  return { url, transaction: { state, verifier, redirectUri, createdAt: now } satisfies Transaction };
}

export function mastersCallback(url: URL, stored: string | null, now = Date.now()): Callback {
  let transaction: unknown;
  try { transaction = JSON.parse(stored ?? "null"); } catch { transaction = null; }
  if (!object(transaction) || typeof transaction.state !== "string" || !pkceValue.test(transaction.state)
    || typeof transaction.verifier !== "string" || !pkceValue.test(transaction.verifier)
    || typeof transaction.createdAt !== "number" || !Number.isSafeInteger(transaction.createdAt)
    || typeof transaction.redirectUri !== "string" || url.pathname !== callbackPath
    || transaction.redirectUri !== new URL(callbackPath, url.origin).href
    || mastersCallbackFields.some((field) => url.searchParams.getAll(field).length > 1)
    || url.searchParams.get("state") !== transaction.state) {
    throw new Error("Lichess sign-in could not be verified. Please connect again.");
  }
  if (now < transaction.createdAt || now - transaction.createdAt >= transactionLifetime) {
    throw new Error("The Lichess sign-in request expired. Please connect again.");
  }
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error")) {
    if (code === null && url.searchParams.get("error") === "access_denied") throw new Error("Lichess authorization was declined.");
    throw new Error("Lichess authorization did not complete. Please connect again.");
  }
  if (!code || !lichessValue.test(code)) throw new Error("Lichess did not return a valid authorization code.");
  return { code, state: transaction.state, verifier: transaction.verifier, createdAt: transaction.createdAt, redirectUri: transaction.redirectUri };
}

async function request(url: string | URL, init: RequestInit, signal?: AbortSignal, fetcher = fetch) {
  const timeout = AbortSignal.timeout(12_000);
  try {
    return await fetcher(url, {
      ...init, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new Error("Could not reach Lichess. Check your connection and try again.");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new Error("Lichess returned an unreadable response."); }
}

export async function exchangeMastersCode(callback: Callback, signal?: AbortSignal, fetcher = fetch): Promise<MastersConnection> {
  const response = await request(tokenEndpoint, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code", code: callback.code, client_id: clientId,
      code_verifier: callback.verifier, redirect_uri: callback.redirectUri,
    }),
  }, signal, fetcher);
  if (response.status === 429) throw new Error("Lichess is limiting requests. Wait at least a minute before reconnecting.");
  if ([400, 401, 403].includes(response.status)) throw new Error("Lichess rejected the authorization code. It may have expired. Please connect again.");
  if (!response.ok) throw new Error("Lichess could not finish connecting. Please try again later.");
  const value = await readJson(response);
  if (!object(value) || typeof value.access_token !== "string" || !lichessValue.test(value.access_token)
    || typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer"
    || typeof value.expires_in !== "number" || !Number.isSafeInteger(value.expires_in)) {
    throw new Error("Lichess returned an invalid access token response.");
  }
  if (value.expires_in <= 0) throw new MastersAuthorizationExpired();
  const expiresAt = Date.now() + value.expires_in * 1000;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("Lichess returned an invalid token expiration.");
  return { token: value.access_token, expiresAt };
}

export class MastersAuthorizationExpired extends Error {
  constructor() { super("Lichess authorization expired or was rejected. Please connect again."); }
}

export function mastersTokenExpired({ expiresAt }: MastersConnection, now = Date.now()) {
  return now >= expiresAt;
}

const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function counts(value: Record<string, unknown>) {
  return count(value.white) && count(value.draws) && count(value.black) ? [value.white, value.draws, value.black] : null;
}
function opening(value: unknown) {
  return value === null || (object(value) && typeof value.eco === "string" && /^[A-E][0-9]{2}$/.test(value.eco)
    && typeof value.name === "string" && value.name.length > 0);
}

export function validMastersProbe(value: unknown) {
  if (!object(value) || !opening(value.opening) || !Array.isArray(value.topGames) || value.topGames.length !== 0
    || !Array.isArray(value.moves) || value.moves.length > 1) return false;
  const totals = counts(value);
  if (!totals) return false;
  const legal = new Map(new Chess().moves({ verbose: true }).map((move) => [move.from + move.to, move.san]));
  return value.moves.every((move: unknown) => {
    if (!object(move) || typeof move.uci !== "string" || typeof move.san !== "string" || legal.get(move.uci) !== move.san
      || !count(move.averageRating) || !opening(move.opening) || !(move.game === null || object(move.game))) return false;
    return counts(move)?.every((total, index) => total <= totals[index]) ?? false;
  });
}

export async function probeMasters(connection: MastersConnection, signal?: AbortSignal, fetcher = fetch) {
  if (mastersTokenExpired(connection)) throw new MastersAuthorizationExpired();
  const url = new URL("https://explorer.lichess.org/masters");
  url.search = new URLSearchParams({ fen: DEFAULT_POSITION, moves: "1", topGames: "0" }).toString();
  const response = await request(url, { headers: { Authorization: `Bearer ${connection.token}` } }, signal, fetcher);
  if (response.status === 401 || response.status === 403) throw new MastersAuthorizationExpired();
  if (response.status === 429) throw new Error("The Masters database is limiting requests. Wait at least a minute before trying again.");
  if (!response.ok) throw new Error("The Masters database is temporarily unavailable.");
  if (!validMastersProbe(await readJson(response))) throw new Error("The Masters database returned unexpected data.");
}

export async function revokeMastersToken(connection: MastersConnection, signal?: AbortSignal, fetcher = fetch) {
  const response = await request(tokenEndpoint, { method: "DELETE", headers: { Authorization: `Bearer ${connection.token}` } }, signal, fetcher);
  return response.ok || response.status === 401;
}
