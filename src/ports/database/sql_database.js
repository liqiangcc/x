"use strict";

const DATABASE_INITIALIZER_METHODS = Object.freeze(["initialize"]);
const SQL_EXECUTOR_METHODS = Object.freeze(["execute"]);
const SQL_ROW_READER_METHODS = Object.freeze(["queryRows"]);

function assertMethods(implementation, methods, label) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError(`${label} implementation must be an object.`);
  }

  const missing = methods.filter(
    (method) => typeof implementation[method] !== "function"
  );
  if (missing.length > 0) {
    throw new TypeError(`${label} is missing methods: ${missing.join(", ")}`);
  }
  return implementation;
}

function assertDatabaseInitializer(implementation) {
  return assertMethods(
    implementation,
    DATABASE_INITIALIZER_METHODS,
    "databaseInitializer"
  );
}

function assertSqlExecutor(implementation) {
  return assertMethods(implementation, SQL_EXECUTOR_METHODS, "sqlExecutor");
}

function assertSqlRowReader(implementation) {
  return assertMethods(
    implementation,
    SQL_ROW_READER_METHODS,
    "sqlRowReader"
  );
}

module.exports = {
  DATABASE_INITIALIZER_METHODS,
  SQL_EXECUTOR_METHODS,
  SQL_ROW_READER_METHODS,
  assertDatabaseInitializer,
  assertSqlExecutor,
  assertSqlRowReader,
};
