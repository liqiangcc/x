"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createFilesystemKlineCodesInputReader,
} = require("../src/adapters/kline/kline_codes_input_reader");

test("kline codes input reader loads and normalizes directory codes.json", async () => {
  const calls = [];
  const root = path.join(path.sep, "repo");
  const fsApi = {
    async stat(target) {
      calls.push(["stat", target]);
      return { isDirectory: () => true };
    },
    async readFile(target, encoding) {
      calls.push(["readFile", target, encoding]);
      return JSON.stringify({ codes: ["600000", " 000001 ", "600000", ""] });
    },
  };
  const readInput = createFilesystemKlineCodesInputReader({ root, fsApi });

  const codes = await readInput("data/pool/20260817");

  assert.deepEqual(codes, ["000001", "600000"]);
  assert.deepEqual(calls, [
    ["stat", path.join(root, "data/pool/20260817")],
    ["readFile", path.join(root, "data/pool/20260817/codes.json"), "utf8"],
  ]);
});

test("kline codes input reader loads a direct codes file", async () => {
  const root = path.join(path.sep, "repo");
  const target = path.join(root, "runs", "codes.json");
  const fsApi = {
    async stat(value) {
      assert.equal(value, target);
      return { isDirectory: () => false };
    },
    async readFile(value, encoding) {
      assert.equal(value, target);
      assert.equal(encoding, "utf8");
      return JSON.stringify({ codes: ["300001"] });
    },
  };
  const readInput = createFilesystemKlineCodesInputReader({ root, fsApi });
  assert.deepEqual(await readInput("runs/codes.json"), ["300001"]);
});

test("kline codes input reader preserves missing codes array error path", async () => {
  const root = path.join(path.sep, "repo");
  const fsApi = {
    async stat() {
      return { isDirectory: () => true };
    },
    async readFile() {
      return JSON.stringify({ items: [] });
    },
  };
  const readInput = createFilesystemKlineCodesInputReader({ root, fsApi });
  await assert.rejects(
    () => readInput("data/pool"),
    /Missing codes array: data\/pool\/codes\.json/,
  );
});

test("kline codes input reader validates its narrow dependencies", async () => {
  assert.throws(
    () => createFilesystemKlineCodesInputReader(),
    /root is required/,
  );
  assert.throws(
    () => createFilesystemKlineCodesInputReader({ root: "/repo", fsApi: {} }),
    /fsApi must provide stat and readFile/,
  );
  const readInput = createFilesystemKlineCodesInputReader({
    root: "/repo",
    fsApi: {
      stat: async () => ({ isDirectory: () => false }),
      readFile: async () => JSON.stringify({ codes: [] }),
    },
  });
  await assert.rejects(() => readInput(), /input path is required/);
});
