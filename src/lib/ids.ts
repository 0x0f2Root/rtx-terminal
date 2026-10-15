/** Ids for persisted records; they satisfy isValidId in src/shared/config.ts. */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
