import type { ZodType, ZodTypeAny } from 'zod';

const MAX_DEPTH = 4;

export const describeSchema = (schema: ZodType<unknown>): string =>
  describeZodType(schema as ZodTypeAny, 0, new Set<ZodTypeAny>());

const describeZodType = (
  schema: ZodTypeAny,
  depth: number,
  seen: Set<ZodTypeAny>,
): string => {
  if (seen.has(schema)) return 'recursive';
  if (depth >= MAX_DEPTH) return shortTypeName(schema);

  const nextSeen = new Set(seen);
  nextSeen.add(schema);

  const def = schema._def as
    | {
        typeName?: string;
        shape?: (() => Record<string, ZodTypeAny>) | Record<string, ZodTypeAny>;
        innerType?: ZodTypeAny;
        schema?: ZodTypeAny;
        type?: ZodTypeAny;
        items?: readonly ZodTypeAny[];
        options?: readonly ZodTypeAny[] | Map<unknown, ZodTypeAny>;
        value?: unknown;
        values?: readonly string[];
        keyType?: ZodTypeAny;
        valueType?: ZodTypeAny;
        left?: ZodTypeAny;
        right?: ZodTypeAny;
      }
    | undefined;
  const typeName = def?.typeName ?? 'unknown';

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodBigInt':
      return 'bigint';
    case 'ZodDate':
      return 'date';
    case 'ZodAny':
      return 'any';
    case 'ZodUnknown':
      return 'unknown';
    case 'ZodNull':
      return 'null';
    case 'ZodUndefined':
      return 'undefined';
    case 'ZodLiteral':
      return JSON.stringify(def?.value);
    case 'ZodEnum':
      return `enum(${(def?.values ?? []).map((value) => JSON.stringify(value)).join(', ')})`;
    case 'ZodArray':
      return `array<${describeChild(def?.type, depth, nextSeen)}>`;
    case 'ZodOptional':
      return `${describeChild(def?.innerType, depth, nextSeen)}?`;
    case 'ZodNullable':
      return `${describeChild(def?.innerType, depth, nextSeen)} | null`;
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      return describeChild(def?.innerType, depth, nextSeen);
    case 'ZodEffects':
      return describeChild(def?.schema, depth, nextSeen);
    case 'ZodObject': {
      const rawShape =
        typeof def?.shape === 'function' ? def.shape() : def?.shape ?? {};
      const entries = Object.entries(rawShape).map(([key, value]) => {
        const child = describeZodType(value, depth + 1, nextSeen);
        return `${JSON.stringify(key)}: ${child}`;
      });
      return `object({ ${entries.join(', ')} })`;
    }
    case 'ZodUnion': {
      const options = Array.isArray(def?.options) ? def.options : [];
      return options
        .map((option) => describeZodType(option, depth + 1, nextSeen))
        .join(' | ');
    }
    case 'ZodDiscriminatedUnion': {
      const options = def?.options instanceof Map
        ? [...def.options.values()]
        : [];
      return `discriminatedUnion(${options
        .map((option) => describeZodType(option, depth + 1, nextSeen))
        .join(' | ')})`;
    }
    case 'ZodRecord':
      return `record<${describeChild(def?.keyType, depth, nextSeen)}, ${describeChild(
        def?.valueType,
        depth,
        nextSeen,
      )}>`;
    case 'ZodTuple': {
      const items = Array.isArray(def?.items) ? def.items : [];
      return `[${items
        .map((item: ZodTypeAny) => describeZodType(item, depth + 1, nextSeen))
        .join(', ')}]`;
    }
    case 'ZodIntersection':
      return `${describeChild(def?.left, depth, nextSeen)} & ${describeChild(
        def?.right,
        depth,
        nextSeen,
      )}`;
    default:
      return shortTypeName(schema);
  }
};

const describeChild = (
  child: ZodTypeAny | undefined,
  depth: number,
  seen: Set<ZodTypeAny>,
): string => {
  if (!child) return 'unknown';
  return describeZodType(child, depth + 1, seen);
};

const shortTypeName = (schema: ZodTypeAny): string => {
  const raw = (schema._def as { typeName?: string } | undefined)?.typeName ?? 'unknown';
  return raw.replace(/^Zod/, '').toLowerCase();
};
