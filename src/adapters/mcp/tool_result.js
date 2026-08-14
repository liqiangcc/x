"use strict";

function jsonResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function errorPayload(error) {
  const code = typeof error?.code === "string" && error.code
    ? error.code
    : error instanceof TypeError
      ? "invalid_arguments"
      : "tool_execution_failed";
  const message = typeof error?.message === "string" && error.message
    ? error.message
    : "Tool execution failed.";
  return { error: { code, message } };
}

module.exports = {
  errorPayload,
  jsonResult,
};
