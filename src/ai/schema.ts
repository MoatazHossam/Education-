import { z } from 'zod';

// Each provider constrains replies with JSON Schema, but each accepts a
// different subset (no length or range limits on Anthropic and OpenAI's strict
// mode, every property required on OpenAI, no "$schema" on Gemini). The
// portable form keeps what all three accept: types, properties, items, enum,
// const, anyOf and descriptions, with every object closed and fully required.
// The full schema, limits included, is still checked on our side
// (parseJsonReply), so dropping a limit here never lets a reply through.

const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'const', 'anyOf', 'description', 'additionalProperties']);

/** JSON Schema for a reply schema, in the subset every provider accepts. */
export function portableSchema(schema: z.ZodType): Record<string, unknown> {
  return portable(z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>, '$');
}

function portable(node: Record<string, unknown>, path: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    if (key === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, Record<string, unknown>>).map(([name, child]) => [name, portable(child, `${path}.${name}`)]),
      );
    } else if (key === 'items') {
      out.items = portable(value as Record<string, unknown>, `${path}[]`);
    } else if (key === 'anyOf') {
      out.anyOf = (value as Record<string, unknown>[]).map((child, i) => portable(child, `${path}|${i}`));
    } else {
      out[key] = value;
    }
  }
  if (out.type === 'object') {
    const names = Object.keys((out.properties as Record<string, unknown> | undefined) ?? {});
    const required = new Set((out.required as string[] | undefined) ?? []);
    const optional = names.filter((n) => !required.has(n));
    // OpenAI's strict mode needs every property required; an optional answer is a nullable one.
    if (optional.length) throw new Error(`AI reply schema: ${path} has optional properties (${optional.join(', ')}); make them .nullable() instead`);
    out.required = names;
    out.additionalProperties = false;
  }
  return out;
}

export class InvalidReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReplyError';
  }
}

/**
 * The reply as JSON, checked against the full schema. Some models wrap JSON in
 * a Markdown code fence even when asked for JSON only; the fence is removed.
 */
export function parseJsonReply<T>(text: string, schema: z.ZodType<T>): T {
  const body = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/i, '$1').trim();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InvalidReplyError('The reply is not JSON');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new InvalidReplyError(`The reply does not match the expected shape (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'unknown'})`);
  }
  return parsed.data;
}
