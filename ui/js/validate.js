// Tiny JSON Schema validator for the subset documented at the top of schemas/build_schemas.py:
//   type (string or list, "null" allowed), properties, required, items, enum, const,
//   minimum, maximum, minItems, maxItems, pattern.   No $ref, no oneOf/anyOf.
// Unknown extra properties are allowed (forward compatible). Pure ES module, no DOM: runs in
// the browser and in Node (ui/tests/validate_fixtures.mjs).

const MAX_ERRORS = 25;

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string, number, boolean, object
}

function matchesType(t, v) {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    default: return true; // unknown type keyword: do not reject
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

const short = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 40 ? s.slice(0, 37) + '...' : s;
};

/** Validate `value` against `schema`. Returns an array of "path: message" strings (empty = valid). */
export function validate(schema, value) {
  const errors = [];
  walk(schema, value, '$', errors);
  return errors;
}

function walk(schema, value, path, errors) {
  if (errors.length >= MAX_ERRORS || schema === null || typeof schema !== 'object') return;
  const err = (msg) => { if (errors.length < MAX_ERRORS) errors.push(`${path}: ${msg}`); };

  if ('const' in schema && !deepEqual(schema.const, value)) {
    err(`must equal ${short(schema.const)} (got ${short(value)})`);
    return;
  }
  if ('enum' in schema && !schema.enum.some((e) => deepEqual(e, value))) {
    err(`must be one of ${short(schema.enum)} (got ${short(value)})`);
    return;
  }
  if ('type' in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, value))) {
      err(`expected ${types.join(' or ')}, got ${typeName(value)}`);
      return;
    }
  }
  if (typeof value === 'number') {
    if ('minimum' in schema && value < schema.minimum) err(`${value} is below minimum ${schema.minimum}`);
    if ('maximum' in schema && value > schema.maximum) err(`${value} is above maximum ${schema.maximum}`);
  }
  if (typeof value === 'string' && 'pattern' in schema) {
    let re = null;
    try { re = new RegExp(schema.pattern); } catch (e) { re = null; }
    if (re && !re.test(value)) err(`does not match pattern ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if ('minItems' in schema && value.length < schema.minItems) err(`needs at least ${schema.minItems} items (has ${value.length})`);
    if ('maxItems' in schema && value.length > schema.maxItems) err(`allows at most ${schema.maxItems} items (has ${value.length})`);
    if (schema.items && typeof schema.items === 'object') {
      for (let i = 0; i < value.length && errors.length < MAX_ERRORS; i++) walk(schema.items, value[i], `${path}[${i}]`, errors);
    }
  } else if (value !== null && typeof value === 'object') {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) if (!(k in value)) err(`missing required property "${k}"`);
    }
    if (schema.properties) {
      for (const k of Object.keys(schema.properties)) {
        if (k in value) walk(schema.properties[k], value[k], `${path}.${k}`, errors);
      }
    }
  }
}
