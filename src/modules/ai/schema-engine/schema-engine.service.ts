import { Injectable } from '@nestjs/common';

@Injectable()
export class SchemaEngineService {
  applyPatch(
    currentSchema: Record<string, unknown> | undefined,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const base = this.clonePlainObject(currentSchema ?? {});
    return this.deepMerge(base, patch);
  }

  private deepMerge(
    target: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...target };

    for (const [key, patchValue] of Object.entries(patch)) {
      const currentValue = result[key];

      if (this.isPlainObject(currentValue) && this.isPlainObject(patchValue)) {
        result[key] = this.deepMerge(currentValue, patchValue);
        continue;
      }

      result[key] = this.cloneValue(patchValue);
    }

    return result;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.prototype.toString.call(value) === '[object Object]'
    );
  }

  private clonePlainObject(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      clone[key] = this.cloneValue(nested);
    }
    return clone;
  }

  private cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.cloneValue(item));
    }
    if (this.isPlainObject(value)) {
      return this.clonePlainObject(value);
    }
    return value;
  }
}
