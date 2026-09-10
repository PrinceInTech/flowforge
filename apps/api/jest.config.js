/** unit + integration test config (runs against Docker Postgres/Redis for integration) */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: "src/.*\\.(unit|e2e)\\.test\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  testEnvironment: "node",
  testTimeout: 30_000,
  maxWorkers: 1,
  moduleNameMapper: {
    "^@flowforge/shared$": "<rootDir>/../../packages/shared/src",
    "^@flowforge/engine$": "<rootDir>/../../packages/engine/src",
  },
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
};