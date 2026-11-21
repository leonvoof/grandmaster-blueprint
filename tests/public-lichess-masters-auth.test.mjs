import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  beginMastersAuthorization, exchangeMastersCode, mastersCallback, mastersTokenExpired,
  MastersAuthorizationExpired, probeMasters, revokeMastersToken, validMastersProbe,
} from "../lib/public-lichess-masters-auth.ts";

const origin = "https://knightforge.example";
const now = 1_800_000_000_000;
const authorized = { token: "synthetic_token", expiresAt: Date.now() + 60_000 };
const fixture = {
  white: 42, draws: 20, black: 38, opening: null, topGames: [],
  moves: [{ uci: "e2e4", san: "e4", averageRating: 2400, white: 21, draws: 10, black: 19, game: null, opening: null }],
};
async function callbackFixture() {
  const { transaction } = await beginMastersAuthorization(origin, now);
  const callback = new URL(transaction.redirectUri);
  callback.search = new URLSearchParams({ state: transaction.state, code: "synthetic_code" }).toString();
  return { callback, stored: JSON.stringify(transaction), transaction };
}

test("browser authorization generates independent S256 verifier and state with no scopes", async () => {
  const { url, transaction } = await beginMastersAuthorization(origin, now);
  assert.equal(url.origin + url.pathname, "https://lichess.org/oauth");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "knightforge-masters");
  assert.equal(url.searchParams.get("redirect_uri"), origin + "/openings");
  assert.equal(url.searchParams.get("state"), transaction.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(transaction.verifier).digest("base64url"));
  assert.notEqual(transaction.state, transaction.verifier);
  assert.ok(!url.searchParams.has("scope") && !url.href.includes(transaction.verifier));
  assert.equal((await beginMastersAuthorization("http://127.0.0.1:39129")).transaction.redirectUri, "http://127.0.0.1:39129/openings");
  await assert.rejects(beginMastersAuthorization("http://knightforge.example"), /HTTPS/);
});

test("callback verifies its origin, path, single state and code, stored transaction, and time", async () => {
  const { callback, stored } = await callbackFixture();
  assert.equal(mastersCallback(callback, stored, now).code, "synthetic_code");
  assert.throws(() => mastersCallback(callback, null, now), /could not be verified/);
  assert.throws(() => mastersCallback(new URL(callback.href.replace(origin, "https://elsewhere.example")), stored, now), /could not be verified/);
  assert.throws(() => mastersCallback(new URL(callback.href.replace("/openings", "/games")), stored, now), /could not be verified/);
  assert.throws(() => mastersCallback(new URL(callback.href + "&state=other"), stored, now), /could not be verified/);
  assert.throws(() => mastersCallback(callback, stored, now + 600_000), /expired/);
  callback.searchParams.delete("code");
  assert.throws(() => mastersCallback(callback, stored, now), /valid authorization code/);
  callback.searchParams.set("error", "access_denied");
  callback.searchParams.set("error_description", "untrusted instruction");
  assert.throws(() => mastersCallback(callback, stored, now), /^Error: Lichess authorization was declined\.$/);
});

test("exchanges only with Lichess and handles rejected codes and malformed or expired tokens", async () => {
  const { callback, stored, transaction } = await callbackFixture();
  const verified = mastersCallback(callback, stored, now);
  const token = await exchangeMastersCode(verified, undefined, async (url, options) => {
    assert.equal(url, "https://lichess.org/api/token");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.body.get("code_verifier"), transaction.verifier);
    assert.equal(options.body.get("redirect_uri"), origin + "/openings");
    assert.equal(options.body.get("code"), "synthetic_code");
    return Response.json({ token_type: "Bearer", access_token: authorized.token, expires_in: 60 });
  });
  assert.equal(token.token, authorized.token);
  assert.equal(mastersTokenExpired(token, token.expiresAt - 1), false);
  assert.equal(mastersTokenExpired(token, token.expiresAt), true);
  await assert.rejects(exchangeMastersCode(verified, undefined, async () => new Response("untrusted", { status: 400 })), /code.*expired/);
  await assert.rejects(exchangeMastersCode(verified, undefined, async () => Response.json({ access_token: authorized.token })), /invalid access token response/);
  await assert.rejects(exchangeMastersCode(verified, undefined, async () => Response.json({ token_type: "Bearer", access_token: authorized.token, expires_in: 0 })), MastersAuthorizationExpired);
});

test("validates documented Masters response fields and starting-position move legality", () => {
  assert.equal(validMastersProbe(fixture), true);
  assert.equal(validMastersProbe({ white: 0, draws: 0, black: 0, opening: null, moves: [], topGames: [] }), true);
  assert.equal(validMastersProbe({ ok: true }), false);
  assert.equal(validMastersProbe({ ...fixture, draws: -1 }), false);
  for (const fields of [{ uci: "e2e5" }, { san: "e5" }, { white: 100 }]) {
    assert.equal(validMastersProbe({ ...fixture, moves: [{ ...fixture.moves[0], ...fields }] }), false);
  }
});

test("Masters probe rejects HTTP 200 with invalid JSON schema, auth errors, rate limits, and network failures", async () => {
  await probeMasters(authorized, undefined, async (url, options) => {
    assert.equal(url.origin + url.pathname, "https://explorer.lichess.org/masters");
    assert.equal(url.searchParams.get("topGames"), "0");
    assert.ok(url.searchParams.has("fen") && !url.href.includes(authorized.token));
    assert.equal(options.headers.Authorization, "Bearer " + authorized.token);
    assert.equal(options.referrerPolicy, "no-referrer");
    return Response.json(fixture);
  });
  await assert.rejects(probeMasters(authorized, undefined, async () => Response.json({ ok: true })), /unexpected data/);
  await assert.rejects(probeMasters(authorized, undefined, async () => new Response(null, { status: 401 })), MastersAuthorizationExpired);
  await assert.rejects(probeMasters(authorized, undefined, async () => new Response(null, { status: 429 })), /limiting requests/);
  await assert.rejects(probeMasters(authorized, undefined, async () => { throw Error("connection reset"); }), /Could not reach Lichess/);
  let contacted = false;
  await assert.rejects(probeMasters({ ...authorized, expiresAt: 1 }, undefined, async () => { contacted = true; }), MastersAuthorizationExpired);
  assert.equal(contacted, false);
});

test("disconnect revokes directly with Lichess and detects unsuccessful revocation", async () => {
  assert.equal(await revokeMastersToken(authorized, undefined, async (url, options) => {
    assert.equal(url, "https://lichess.org/api/token");
    assert.equal(options.method, "DELETE");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, "Bearer " + authorized.token);
    return new Response(null, { status: 204 });
  }), true);
  assert.equal(await revokeMastersToken(authorized, undefined, async () => new Response(null, { status: 503 })), false);
});
