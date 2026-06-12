import assert from "node:assert/strict";
import test from "node:test";
import { gameServerHttpBase, gameServerWsUrl, unquoteEnvValue } from "./env.mjs";

test("unquoteEnvValue strips double and single quotes", () => {
  assert.equal(unquoteEnvValue('"http://127.0.0.1:2567"'), "http://127.0.0.1:2567");
  assert.equal(unquoteEnvValue("'secret'"), "secret");
  assert.equal(unquoteEnvValue("plain"), "plain");
});

test("gameServerWsUrl derives from GAME_SERVER_URL when WS unset", () => {
  const prevUrl = process.env.GAME_SERVER_URL;
  const prevWs = process.env.GAME_SERVER_WS;
  const prevPort = process.env.GAME_SERVER_PORT;
  delete process.env.GAME_SERVER_WS;
  delete process.env.GAME_SERVER_PORT;
  process.env.GAME_SERVER_URL = "http://example.com:3000";
  try {
    assert.equal(gameServerHttpBase(), "http://example.com:3000");
    assert.equal(gameServerWsUrl(), "ws://example.com:3000");
  } finally {
    if (prevUrl === undefined) delete process.env.GAME_SERVER_URL;
    else process.env.GAME_SERVER_URL = prevUrl;
    if (prevWs === undefined) delete process.env.GAME_SERVER_WS;
    else process.env.GAME_SERVER_WS = prevWs;
    if (prevPort === undefined) delete process.env.GAME_SERVER_PORT;
    else process.env.GAME_SERVER_PORT = prevPort;
  }
});

test("gameServerWsUrl uses https → wss", () => {
  const prevUrl = process.env.GAME_SERVER_URL;
  const prevWs = process.env.GAME_SERVER_WS;
  delete process.env.GAME_SERVER_WS;
  process.env.GAME_SERVER_URL = "https://game.example.com";
  try {
    assert.equal(gameServerWsUrl(), "wss://game.example.com");
  } finally {
    if (prevUrl === undefined) delete process.env.GAME_SERVER_URL;
    else process.env.GAME_SERVER_URL = prevUrl;
    if (prevWs === undefined) delete process.env.GAME_SERVER_WS;
    else process.env.GAME_SERVER_WS = prevWs;
  }
});
