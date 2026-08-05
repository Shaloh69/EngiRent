/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  clearMocks: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  // uuid ships ESM-only; without this it fails to parse under Jest's
  // default CommonJS transform (node_modules is untransformed by default).
  transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
};
