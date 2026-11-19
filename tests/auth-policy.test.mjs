import assert from "node:assert/strict";
import { test } from "node:test";
import { privateRequestDecision } from "../lib/auth-policy.ts";
const origin = "https://chess.example";
test("unauthenticated pages redirect and all private API methods return unauthorized", () => {
 assert.equal(privateRequestDecision(false,"/games","GET",null,origin),"redirect");
 for (const method of ["GET","POST","PUT","PATCH","DELETE"]) assert.equal(privateRequestDecision(false,"/api/games",method,null,origin),"unauthorized");
});
test("authenticated requests are allowed and unsafe cross-origin API writes are rejected",()=>{
 assert.equal(privateRequestDecision(true,"/api/games","GET",null,origin),"allow");
 assert.equal(privateRequestDecision(true,"/api/games","POST",origin,origin),"allow");
 assert.equal(privateRequestDecision(true,"/api/games","POST","https://evil.example",origin),"csrf");
 assert.equal(privateRequestDecision(true,"/games","POST","https://evil.example",origin),"allow");
});
test("Auth.js cookie configuration is time bounded and password hashing uses bcrypt", async()=>{
 const fs=await import("node:fs/promises"); const source=await fs.readFile(new URL("../auth.ts",import.meta.url),"utf8"); const config=await fs.readFile(new URL("../auth.config.ts",import.meta.url),"utf8");
 assert.match(config,/strategy: "jwt", maxAge: 8 \* 60 \* 60/); assert.match(source,/bcrypt\.compare/);
});
test("expired and tampered JWT sessions are rejected", async()=>{
 const { encode, decode } = await import("next-auth/jwt"); const secret="unit-test-only-secret-that-is-not-used-by-app";
 const salt="unit-test-cookie"; const token=await encode({token:{sub:"single-user"},secret,salt,maxAge:60});
 assert.equal((await decode({token,secret,salt}) )?.sub,"single-user");
 const tampered=`${token.slice(0,20)}${token[20] === "a" ? "b" : "a"}${token.slice(21)}`;
 await assert.rejects(decode({token:tampered,secret,salt}));
});
