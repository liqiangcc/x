"use strict";

const ORDER_FIELDS = {
  candidateId: { minLength: 1, type: "string" },
  estimatedFees: { minimum: 0, type: "number" },
  estimatedPrice: { exclusiveMinimum: 0, type: "number" },
  expectedVersion: { minimum: 1, type: "integer" },
  quantity: { minimum: 1, type: "integer" },
  reason: { minLength: 1, type: "string" },
  side: { enum: ["buy", "sell"], type: "string" },
};

async function orderRoutes(app, { runtime }) {
  app.post("/sessions/:sessionId/orders", {
    schema: { body: { additionalProperties: false, properties: ORDER_FIELDS, required: ["candidateId", "expectedVersion", "quantity", "reason", "side"], type: "object" } },
  }, async (request, reply) => reply.code(201).send(runtime.createOrder(request.params.sessionId, request.body)));
  app.patch("/sessions/:sessionId/orders/:orderId", {
    schema: { body: { additionalProperties: false, properties: {
      estimatedFees: ORDER_FIELDS.estimatedFees,
      estimatedPrice: ORDER_FIELDS.estimatedPrice,
      expectedVersion: ORDER_FIELDS.expectedVersion,
      quantity: ORDER_FIELDS.quantity,
      reason: ORDER_FIELDS.reason,
    }, required: ["expectedVersion"], type: "object" } },
  }, async (request) => runtime.updateOrder(request.params.sessionId, request.params.orderId, request.body));
  app.delete("/sessions/:sessionId/orders/:orderId", {
    schema: { body: { additionalProperties: false, properties: { expectedVersion: ORDER_FIELDS.expectedVersion }, required: ["expectedVersion"], type: "object" } },
  }, async (request) => runtime.cancelOrder(request.params.sessionId, request.params.orderId, request.body));
}

module.exports = {
  ORDER_FIELDS,
  orderRoutes,
};
