// Small checks for the JSON Schema subset the studio uses with the AI (type, properties,
// required, additionalProperties, items, enum, anyOf). Used to decide whether a schema is
// simple enough for Claude's strict mode, and to check replies written without it.

type Schema = Record<string, any>;

/** Counts what Claude's strict mode limits: properties left out of `required`, and union-typed properties. */
export function schemaComplexity(schema: Schema): { optional: number; unions: number; properties: number } {
  const out = { optional: 0, unions: 0, properties: 0 };
  const walk = (s: Schema | undefined) => {
    if (!s || typeof s !== "object") return;
    if (Array.isArray(s.anyOf)) s.anyOf.forEach(walk);
    if (s.items) walk(s.items);
    if (s.properties) {
      const req = new Set<string>(s.required ?? []);
      for (const [k, v] of Object.entries<Schema>(s.properties)) {
        out.properties++;
        if (!req.has(k)) out.optional++;
        if (Array.isArray(v.anyOf) || Array.isArray(v.type)) out.unions++;
        walk(v);
      }
    }
  };
  walk(schema);
  return out;
}

/**
 * Whether a schema is comfortably inside Claude's strict-mode limits (24 optional properties,
 * 16 union-typed ones, plus an unpublished cap on the compiled grammar). Optional properties
 * inside arrays of objects multiply the grammar, so the bar here is set well below the published one.
 */
export function fitsStrictMode(schema: Schema): boolean {
  const c = schemaComplexity(schema);
  return c.optional <= 8 && c.unions <= 6 && c.properties <= 120;
}

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);

function matchesType(v: unknown, t: string | string[] | undefined): boolean {
  if (!t) return true;
  const want = Array.isArray(t) ? t : [t];
  const got = typeOf(v);
  return want.some((w) => w === got || (w === "number" && got === "integer"));
}

/**
 * Checks a value against the schema and returns what's wrong (at most `limit` messages).
 * Properties the schema doesn't allow are removed from the value as it goes.
 */
export function checkJson(value: unknown, schema: Schema, path = "$", errors: string[] = [], limit = 20): string[] {
  if (errors.length >= limit) return errors;
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((s: Schema) => checkJson(structuredCloneSafe(value), s, path, [], 1).length === 0);
    if (!ok) errors.push(`${path} doesn't match any allowed shape`);
    else {
      const first = schema.anyOf.find((s: Schema) => checkJson(structuredCloneSafe(value), s, path, [], 1).length === 0);
      checkJson(value, first, path, errors, limit);
    }
    return errors;
  }
  if (!matchesType(value, schema.type)) {
    errors.push(`${path} should be ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}, not ${typeOf(value)}`);
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} should be one of ${schema.enum.map((e: unknown) => JSON.stringify(e)).join(", ")}`);
    return errors;
  }
  if (typeOf(value) === "array" && schema.items) {
    (value as unknown[]).forEach((item, i) => checkJson(item, schema.items, `${path}[${i}]`, errors, limit));
  }
  if (typeOf(value) === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) errors.push(`${path}.${k} is missing`);
    for (const k of Object.keys(obj)) {
      const sub = schema.properties[k];
      if (!sub) {
        if (schema.additionalProperties === false) delete obj[k];
        continue;
      }
      checkJson(obj[k], sub, `${path}.${k}`, errors, limit);
      if (errors.length >= limit) break;
    }
  }
  return errors.slice(0, limit);
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}
