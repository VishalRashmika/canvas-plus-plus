import { UnsupportedSchemaVersionError } from "./JsonCanvasSerializer";

export interface MigrationStep {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

export class SchemaMigrator {
  private steps: MigrationStep[] = [];

  constructor(steps: MigrationStep[] = []) {
    this.steps = [...steps];
  }

  registerStep(step: MigrationStep): void {
    if (step.toVersion !== step.fromVersion + 1) {
      throw new Error(
        `Migration step must be strictly sequential (from v${step.fromVersion} to v${step.fromVersion + 1}), got toVersion=${step.toVersion}`
      );
    }
    this.steps.push(step);
    this.steps.sort((a, b) => a.fromVersion - b.fromVersion);
  }

  canMigrate(fromVersion: number, targetVersion: number): boolean {
    if (fromVersion === targetVersion) return true;
    if (fromVersion > targetVersion) return false;

    let current = fromVersion;
    while (current < targetVersion) {
      const step = this.steps.find((s) => s.fromVersion === current);
      if (!step) return false;
      current = step.toVersion;
    }
    return current === targetVersion;
  }

  migrate(
    data: Record<string, unknown>,
    targetVersion: number
  ): Record<string, unknown> {
    const rawVersion = data.schemaVersion;
    if (typeof rawVersion !== "number") {
      throw new Error("Missing numeric 'schemaVersion' in data to migrate");
    }

    if (rawVersion === targetVersion) {
      return { ...data };
    }

    if (rawVersion > targetVersion) {
      throw new UnsupportedSchemaVersionError(rawVersion);
    }

    let currentVersion = rawVersion;
    let currentData = { ...data };

    while (currentVersion < targetVersion) {
      const step = this.steps.find((s) => s.fromVersion === currentVersion);
      if (!step) {
        throw new Error(
          `No migration step available to migrate from schema v${currentVersion} to v${currentVersion + 1}`
        );
      }

      currentData = step.migrate(currentData);
      currentVersion = step.toVersion;
      currentData.schemaVersion = currentVersion;
    }

    return currentData;
  }
}

/**
 * Standard registry of migrations.
 * In Phase 1, CURRENT_SCHEMA_VERSION is 1. When schema bumps to v2 in future
 * phases, add `migrate_v1_to_v2` here.
 */
export const defaultSchemaMigrator = new SchemaMigrator([]);
