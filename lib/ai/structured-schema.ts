import { AIProviderError } from './errors';

type Schema = Record<string, unknown>;
const record = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value);
const removedConstraints = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'uniqueItems'];

function visitSchemas(schema: unknown, visit: (schema: Schema) => void) {
  if (!record(schema)) return;
  visit(schema);
  for (const key of ['properties', '$defs', 'definitions']) {
    if (record(schema[key])) Object.values(schema[key]).forEach(child => visitSchemas(child, visit));
  }
  visitSchemas(schema.items, visit);
  for (const key of ['anyOf', 'allOf', 'oneOf']) {
    if (Array.isArray(schema[key])) schema[key].forEach(child => visitSchemas(child, visit));
  }
}

/** Claude accepts fewer JSON Schema constraints than the app. Keep the original schema for validation. */
export function prepareClaudeSchema(original: unknown) {
  const schema = structuredClone(original);
  let unions = 0;
  visitSchemas(schema, part => { if (Array.isArray(part.type) || Array.isArray(part.anyOf)) unions++; });
  // The workflow schema has more than Claude's 16 union parameters. An empty string is a
  // transport representation of an unknown nullable string, restored to null on receipt.
  const emptyStringNulls = unions > 16;
  visitSchemas(schema, part => {
    const hints: string[] = [];
    for (const key of removedConstraints) {
      if (part[key] !== undefined) { hints.push(`${key}: ${JSON.stringify(part[key])}`); delete part[key]; }
    }
    if (typeof part.minItems === 'number' && part.minItems > 1) {
      hints.push(`minItems: ${part.minItems}`); delete part.minItems;
    }
    if (emptyStringNulls && isNullableString(part)) {
      part.type = 'string';
      if (Array.isArray(part.enum)) part.enum = part.enum.map(value => value === null ? '' : value);
      hints.push('Use an empty string for unknown; never guess a missing fact. The application restores it to null.');
    }
    if (hints.length) part.description = [part.description, ...hints].filter(Boolean).join('\n');
  });
  return { schema, emptyStringNulls };
}

function isNullableString(schema: Schema) {
  return Array.isArray(schema.type) && schema.type.length === 2 && schema.type.includes('string') && schema.type.includes('null');
}

/** Enforce the constraints moved into descriptions; never trim or silently discard extracted facts. */
export function validateStructuredConstraints(value: unknown, original: unknown, emptyStringNulls = false): unknown {
  if (!record(original)) return value;
  if (emptyStringNulls && isNullableString(original) && value === '') return null;
  const invalid = () => { throw new AIProviderError('invalid_response', 'AIの整理結果が文字数・件数などの条件を満たしていません。メモと前の候補は残っています。再試行してください。'); };
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (typeof original.minLength === 'number' && length < original.minLength) invalid();
    if (typeof original.maxLength === 'number' && length > original.maxLength) invalid();
  }
  if (typeof value === 'number') {
    if (typeof original.minimum === 'number' && value < original.minimum) invalid();
    if (typeof original.maximum === 'number' && value > original.maximum) invalid();
    if (typeof original.exclusiveMinimum === 'number' && value <= original.exclusiveMinimum) invalid();
    if (typeof original.exclusiveMaximum === 'number' && value >= original.exclusiveMaximum) invalid();
    if (typeof original.multipleOf === 'number' && Math.abs(value / original.multipleOf - Math.round(value / original.multipleOf)) > 1e-10) invalid();
  }
  if (Array.isArray(value)) {
    if (typeof original.minItems === 'number' && value.length < original.minItems) invalid();
    if (typeof original.maxItems === 'number' && value.length > original.maxItems) invalid();
    if (original.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length) invalid();
    return value.map(item => validateStructuredConstraints(item, original.items, emptyStringNulls));
  }
  if (record(value) && record(original.properties)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, validateStructuredConstraints(item, (original.properties as Schema)[key], emptyStringNulls)]));
  }
  return value;
}
