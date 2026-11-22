import * as fs from "fs";
import * as path from "path";

describe("Plugin Version Consistency", () => {
  const rootDir = path.resolve(__dirname, "..");

  it("should have version 2.1.0 in manifest.json", () => {
    const manifestPath = path.join(rootDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.version).toBe("2.1.0");
  });

  it("should have version 2.1.0 in package.json", () => {
    const pkgPath = path.join(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    expect(pkg.version).toBe("2.1.0");
  });

  it("should have version 2.1.0 in package-lock.json", () => {
    const lockPath = path.join(rootDir, "package-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    expect(lock.version).toBe("2.1.0");
    expect(lock.packages[""].version).toBe("2.1.0");
  });

  it("should include 2.1.0 in versions.json mapped to minAppVersion", () => {
    const manifestPath = path.join(rootDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    const versionsPath = path.join(rootDir, "versions.json");
    const versions = JSON.parse(fs.readFileSync(versionsPath, "utf-8"));
    expect(versions["2.1.0"]).toBe(manifest.minAppVersion);
  });

  it("should reference v2.1.0 in README.md", () => {
    const readmePath = path.join(rootDir, "README.md");
    const readme = fs.readFileSync(readmePath, "utf-8");
    expect(readme).toContain("badge/version-v2.1.0-blue.svg");
    expect(readme).toContain("**Version: `v2.1.0`**");
  });
});
