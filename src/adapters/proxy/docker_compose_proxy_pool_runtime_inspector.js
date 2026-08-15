"use strict";

const {
  createDockerComposeProxyPool,
} = require("./docker_compose_proxy_pool");

function createDockerComposeProxyPoolRuntimeInspector({
  root,
  fsAccess,
  execFileAsync,
  compose,
} = {}) {
  const resolvedCompose = compose ?? createDockerComposeProxyPool({
    root,
    fsAccess,
    execFileAsync,
  });

  return {
    async inspect() {
      return resolvedCompose.run(["ps"]);
    },
  };
}

module.exports = {
  createDockerComposeProxyPoolRuntimeInspector,
};
