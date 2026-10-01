/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^obsidian$": "<rootDir>/tests/fakes/MockObsidian.ts",
  },
  collectCoverageFrom: [
    "src/domain/**/*.ts",
    "src/application/**/*.ts",
    "!src/**/*.d.ts",
  ],
};
