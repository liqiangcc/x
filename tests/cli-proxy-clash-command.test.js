"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyClashCommand,
  runProxyClashCommand,
} = require("../src/adapters/cli/commands/proxy_clash");

function outputSink() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
      },
    },
    value: () => value,
  };
}

test("proxy clash CLI maps list options and preserves JSON presentation", async () => {
  const stdout = outputSink();
  const calls = [];
  const command = createProxyClashCommand({
    stdout: stdout.stream,
    capability: {
      async listProxies(options) {
        calls.push(options);
        return ["a", "b"];
      },
    },
  });

  const result = await command(["list", "--config", "/tmp/clash.yaml", "--group", "fast"]);

  assert.deepEqual(calls, [{ configFile: "/tmp/clash.yaml", groupName: "fast" }]);
  assert.deepEqual(result, ["a", "b"]);
  assert.equal(stdout.value(), `${JSON.stringify(result, null, 2)}\n`);
});

test("proxy clash CLI maps rotate options and preserves null proxy default", async () => {
  const calls = [];
  const capability = {
    async rotateProxy(options) {
      calls.push(options);
      return { proxy: options.proxyName ?? "random" };
    },
  };

  await runProxyClashCommand({
    argv: ["rotate", "--config", "/tmp/clash.yaml", "--group", "fast"],
    capability,
    stdout: { write() {} },
  });
  await runProxyClashCommand({
    argv: ["rotate", "--proxy", "node-a"],
    capability,
    stdout: { write() {} },
  });

  assert.deepEqual(calls, [
    { configFile: "/tmp/clash.yaml", groupName: "fast", proxyName: null },
    { configFile: undefined, groupName: undefined, proxyName: "node-a" },
  ]);
});

test("proxy clash CLI check delegates without capability options", async () => {
  let calls = 0;
  const result = await runProxyClashCommand({
    argv: ["check"],
    capability: {
      async checkEastmoneyAccess() {
        calls += 1;
        return { ok: true };
      },
    },
    stdout: { write() {} },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true });
});

test("proxy clash CLI validates protocol before resolving capability", async () => {
  let resolutions = 0;
  await assert.rejects(
    () => runProxyClashCommand({
      argv: ["unknown"],
      getCapability() {
        resolutions += 1;
        return {};
      },
    }),
    /Unknown proxy command: unknown/
  );
  assert.equal(resolutions, 0);

  await assert.rejects(
    () => runProxyClashCommand({
      argv: ["list", "--config"],
      getCapability() {
        resolutions += 1;
        return {};
      },
    }),
    /Missing value for --config/
  );
  assert.equal(resolutions, 0);
});

test("proxy clash CLI requires only the capability used by the selected action", async () => {
  await assert.rejects(
    () => runProxyClashCommand({ argv: ["list"], capability: {}, stdout: { write() {} } }),
    /proxy clash capability must expose listProxies\(\)/
  );
  await assert.rejects(
    () => runProxyClashCommand({ argv: ["rotate"], capability: {}, stdout: { write() {} } }),
    /proxy clash capability must expose rotateProxy\(\)/
  );
  await assert.rejects(
    () => runProxyClashCommand({ argv: ["check"], capability: {}, stdout: { write() {} } }),
    /proxy clash capability must expose checkEastmoneyAccess\(\)/
  );
});
