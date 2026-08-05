// Manual mock for the `uuid` package under Jest — `uuid` v14 ships ESM-only
// .js files that Jest's default CommonJS transform can't parse. Tests here
// don't depend on genuinely random/unique IDs, so a simple counter-based
// stand-in is sufficient.
let counter = 0;
export function v4(): string {
  counter += 1;
  return `test-uuid-${counter}`;
}
