import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert a Zod schema to the subset of JSON Schema that Gemini accepts.
 * Gemini rejects: $schema, additionalProperties, some format specifiers.
 * Property names should be short; deep nesting should be avoided.
 */
export function toGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'jsonSchema7' }) as Record<string, unknown>;
  return sanitize(json);
}

function sanitize(node: any): any {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema' || key === 'additionalProperties') continue;
      if (key === 'format' && value === 'date-time') continue;
      out[key] = sanitize(value);
    }
    return out;
  }
  return node;
}
