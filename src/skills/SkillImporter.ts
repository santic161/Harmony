import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import YAML from 'yaml';
import type {
  ImportedSkill,
  ImportedSkillSource,
  RemoteSkillLoadOptions,
  SkillResource,
  SkillSource,
} from './SkillTypes.js';

interface SkillBundleFile {
  readonly relativePath: string;
  readonly data: Uint8Array;
  readonly mediaType?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const bundleRegistry = new WeakMap<ImportedSkill, readonly SkillBundleFile[]>();

export const loadSkillFromDirectory = async (directoryPath: string): Promise<ImportedSkill> => {
  const root = resolve(directoryPath);
  const bundle = await collectDirectoryFiles(root);
  const skill = buildImportedSkill({
    bundle,
    source: {
      kind: 'directory',
      locator: root,
      fetchedAt: new Date().toISOString(),
    },
    fallbackId: basename(root),
  });
  bundleRegistry.set(skill, bundle);
  return skill;
};

export const loadSkillFromZip = async (zipPath: string): Promise<ImportedSkill> => {
  const absolutePath = resolve(zipPath);
  const data = new Uint8Array(await readFile(absolutePath));
  const bundle = await unpackZip(data);
  const skill = buildImportedSkill({
    bundle,
    source: {
      kind: 'zip',
      locator: absolutePath,
      fetchedAt: new Date().toISOString(),
    },
    fallbackId: basename(absolutePath, '.zip'),
  });
  bundleRegistry.set(skill, bundle);
  return skill;
};

export const loadSkillFromUrl = async (
  url: string,
  options: RemoteSkillLoadOptions = {},
): Promise<ImportedSkill> => {
  const fetchImpl = options.fetch ?? fetch;
  const normalizedUrl = normalizeUrl(url);
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    options.headers ? { headers: options.headers } : {},
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (isZipResponse(url, contentType, response.headers.get('content-disposition'))) {
    const bundle = await unpackZip(new Uint8Array(await response.arrayBuffer()));
    const skill = buildImportedSkill({
      bundle,
      source: {
        kind: 'url',
        locator: url,
        fetchedAt: new Date().toISOString(),
      },
      fallbackId: basename(normalizedUrl.pathname).replace(/\.zip$/i, '') || 'remote-skill',
    });
    bundleRegistry.set(skill, bundle);
    return skill;
  }

  const text = await response.text();
  if (normalizedUrl.hostname === 'clawhub.ai') {
    return loadSkillFromClawHubPage({
      requestedUrl: url,
      pageUrl: response.url || url,
      html: text,
      fetchImpl,
      ...(options.headers ? { headers: options.headers } : {}),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }
  if (normalizedUrl.hostname === 'www.skillhub.club' || normalizedUrl.hostname === 'skillhub.club') {
    const extracted = extractSkillHubPage(url, text);
    const skill = buildImportedSkill({
      bundle: extracted.bundle,
      source: extracted.source,
      fallbackId: extracted.fallbackId,
      diagnostics: extracted.diagnostics,
    });
    bundleRegistry.set(skill, extracted.bundle);
    return skill;
  }

  const bundle = [toSkillFile('SKILL.md', text, contentType || 'text/markdown')];
  const skill = buildImportedSkill({
    bundle,
    source: {
      kind: 'url',
      locator: url,
      fetchedAt: new Date().toISOString(),
    },
    fallbackId: basename(normalizedUrl.pathname) || 'remote-skill',
  });
  bundleRegistry.set(skill, bundle);
  return skill;
};

export const loadSkillFromClawHub = async (
  url: string,
  options: RemoteSkillLoadOptions = {},
): Promise<ImportedSkill> => {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    options.headers ? { headers: options.headers } : {},
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  return loadSkillFromClawHubPage({
    requestedUrl: url,
    pageUrl: response.url || url,
    html: await response.text(),
    fetchImpl,
    ...(options.headers ? { headers: options.headers } : {}),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
};

export const loadSkillFromSource = async (source: SkillSource): Promise<ImportedSkill> => {
  switch (source.kind) {
    case 'directory':
      return loadSkillFromDirectory(source.path);
    case 'zip':
      return loadSkillFromZip(source.path);
    case 'url':
      return loadSkillFromUrl(source.url, {
        ...(source.headers ? { headers: source.headers } : {}),
        ...(source.timeoutMs !== undefined ? { timeoutMs: source.timeoutMs } : {}),
      });
    case 'clawhub':
      return loadSkillFromClawHub(source.url, {
        ...(source.headers ? { headers: source.headers } : {}),
        ...(source.timeoutMs !== undefined ? { timeoutMs: source.timeoutMs } : {}),
      });
  }
};

export const writeImportedSkill = async (
  skill: ImportedSkill,
  targetDir: string,
): Promise<string> => {
  const bundle = bundleRegistry.get(skill);
  if (!bundle) {
    throw new Error(`No bundle data is available for imported skill "${skill.id}"`);
  }

  const root = resolve(targetDir);
  await mkdir(root, { recursive: true });
  for (const file of bundle) {
    const outputPath = resolve(root, file.relativePath);
    assertWithinRoot(root, outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.data);
  }
  return root;
};

const buildImportedSkill = (input: {
  readonly bundle: readonly SkillBundleFile[];
  readonly source: ImportedSkillSource;
  readonly fallbackId: string;
  readonly diagnostics?: readonly string[];
}): ImportedSkill => {
  const skillFile = input.bundle.find((file) => file.relativePath.toLowerCase() === 'skill.md');
  if (!skillFile) {
    throw new Error('Skill bundle does not contain a SKILL.md file');
  }

  const raw = new TextDecoder().decode(skillFile.data);
  const parsed = parseSkillMarkdown(raw, input.fallbackId);
  const resources = input.bundle.map(toSkillResource);

  return {
    id: parsed.id,
    description: parsed.description,
    instructions: parsed.instructions,
    ...(parsed.preferredActionIds ? { preferredActionIds: parsed.preferredActionIds } : {}),
    ...(parsed.examples ? { examples: parsed.examples } : {}),
    source: input.source,
    resources,
    ...(parsed.license ? { license: parsed.license } : {}),
    ...(parsed.compatibility ? { compatibility: parsed.compatibility } : {}),
    ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
    ...(parsed.allowedTools ? { allowedTools: parsed.allowedTools } : {}),
    ...(mergeDiagnostics(parsed.diagnostics, input.diagnostics).length > 0
      ? { diagnostics: mergeDiagnostics(parsed.diagnostics, input.diagnostics) }
      : {}),
  };
};

const mergeDiagnostics = (
  primary: readonly string[],
  secondary: readonly string[] | undefined,
): readonly string[] => secondary ? [...primary, ...secondary] : primary;

const parseSkillMarkdown = (
  raw: string,
  fallbackId: string,
): {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly allowedTools?: readonly string[];
  readonly preferredActionIds?: readonly string[];
  readonly examples?: readonly string[];
  readonly diagnostics: readonly string[];
} => {
  const diagnostics: string[] = [];
  const frontmatter = extractFrontmatter(raw);
  const parsedFrontmatter = parseFrontmatter(frontmatter.frontmatter, diagnostics);

  const name = firstNonEmptyString(parsedFrontmatter['name']) ?? fallbackId;
  const id = normalizeSkillId(name, fallbackId, diagnostics);
  const description =
    firstNonEmptyString(parsedFrontmatter['description']) ??
    inferDescription(frontmatter.body);
  if (!description) {
    throw new Error(`Skill "${id}" is missing a usable description`);
  }

  const instructions = frontmatter.body.trim();
  if (instructions.length === 0) {
    throw new Error(`Skill "${id}" is missing instructions in the SKILL.md body`);
  }

  const allowedTools = normalizeAllowedTools(parsedFrontmatter['allowed-tools']);
  const metadata = normalizeMetadata(parsedFrontmatter['metadata']);
  const license = firstNonEmptyString(parsedFrontmatter['license']);
  const compatibility = firstNonEmptyString(parsedFrontmatter['compatibility']);

  return {
    id,
    description,
    instructions,
    ...(license ? { license } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(metadata ? { metadata } : {}),
    ...(allowedTools ? { allowedTools } : {}),
    diagnostics,
  };
};

const extractFrontmatter = (raw: string): { readonly frontmatter: string; readonly body: string } => {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: '', body: normalized.trim() };
  }

  const closingMarker = '\n---\n';
  const closingIndex = normalized.indexOf(closingMarker, 4);
  if (closingIndex === -1) {
    return { frontmatter: '', body: normalized.trim() };
  }

  return {
    frontmatter: normalized.slice(4, closingIndex),
    body: normalized.slice(closingIndex + closingMarker.length).trim(),
  };
};

const parseFrontmatter = (
  frontmatter: string,
  diagnostics: string[],
): Record<string, unknown> => {
  if (frontmatter.trim().length === 0) return {};

  try {
    return toRecord(YAML.parse(frontmatter));
  } catch (error) {
    diagnostics.push(`Recovered malformed YAML frontmatter: ${(error as Error).message}`);
  }

  const repaired = repairCommonYaml(frontmatter);
  if (repaired !== frontmatter) {
    try {
      return toRecord(YAML.parse(repaired));
    } catch (error) {
      diagnostics.push(`YAML repair attempt failed: ${(error as Error).message}`);
    }
  }

  const fallback = salvageFrontmatter(frontmatter);
  if (Object.keys(fallback).length > 0) {
    diagnostics.push('Loaded skill with lenient frontmatter salvage.');
    return fallback;
  }

  throw new Error('Could not parse SKILL.md frontmatter');
};

const repairCommonYaml = (frontmatter: string): string =>
  frontmatter
    .split('\n')
    .map((line) => {
      const match = /^(\s*[A-Za-z0-9_-]+\s*:\s*)(.+)$/.exec(line);
      if (!match?.[2]) return line;

      const value = match[2].trim();
      if (value.length === 0) return line;
      if (
        value.startsWith('"') ||
        value.startsWith("'") ||
        value.startsWith('[') ||
        value.startsWith('{') ||
        value.startsWith('|') ||
        value.startsWith('>')
      ) {
        return line;
      }
      if (value.includes(':')) {
        return `${match[1]}"${value.replace(/"/g, '\\"')}"`;
      }
      return line;
    })
    .join('\n');

const salvageFrontmatter = (frontmatter: string): Record<string, unknown> => {
  const lines = frontmatter.split('\n');
  const result: Record<string, unknown> = {};
  let currentObjectKey: string | undefined;
  let currentArrayKey: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const objectChild = /^\s{2,}([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line);
    if (objectChild && currentObjectKey) {
      const childKey = objectChild[1];
      const childValue = objectChild[2];
      if (!childKey || childValue === undefined) continue;
      const existing = result[currentObjectKey];
      const current: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
      current[childKey] = stripYamlQuotes(childValue);
      result[currentObjectKey] = current;
      continue;
    }

    const arrayChild = /^\s*-\s+(.+)$/.exec(line);
    if (arrayChild && currentArrayKey) {
      const childValue = arrayChild[1];
      if (childValue === undefined) continue;
      const existing = result[currentArrayKey];
      const current = Array.isArray(existing) ? [...existing] : [];
      current.push(stripYamlQuotes(childValue));
      result[currentArrayKey] = current;
      continue;
    }

    const topLevel = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!topLevel) {
      currentObjectKey = undefined;
      currentArrayKey = undefined;
      continue;
    }

    const key = topLevel[1];
    const value = topLevel[2];
    if (!key || value === undefined) {
      currentObjectKey = undefined;
      currentArrayKey = undefined;
      continue;
    }

    if (value.length === 0) {
      if (key === 'metadata') {
        result[key] = {};
        currentObjectKey = key;
        currentArrayKey = undefined;
      } else {
        result[key] = [];
        currentArrayKey = key;
        currentObjectKey = undefined;
      }
      continue;
    }

    currentArrayKey = undefined;
    currentObjectKey = undefined;
    result[key] = stripYamlQuotes(value);
  }

  return result;
};

const stripYamlQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const normalizeSkillId = (
  name: string,
  fallbackId: string,
  diagnostics: string[],
): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (normalized.length > 0 && normalized === name.trim()) {
    return normalized;
  }
  if (normalized.length > 0) {
    diagnostics.push(`Normalized skill name "${name}" to id "${normalized}".`);
    return normalized;
  }
  diagnostics.push(`Fell back to inferred id "${fallbackId}".`);
  return fallbackId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'imported-skill';
};

const inferDescription = (body: string): string | undefined => {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    return trimmed.slice(0, 1024);
  }
  return undefined;
};

const normalizeAllowedTools = (value: unknown): readonly string[] | undefined => {
  if (typeof value === 'string') {
    const parts = value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
};

const normalizeMetadata = (
  value: unknown,
): Readonly<Record<string, unknown>> | undefined => {
  return isPlainObject(value) ? value : undefined;
};

const collectDirectoryFiles = async (root: string): Promise<readonly SkillBundleFile[]> => {
  const bundle: SkillBundleFile[] = [];
  await walkDirectory(root, root, bundle);
  return bundle.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const walkDirectory = async (
  root: string,
  current: string,
  bundle: SkillBundleFile[],
): Promise<void> => {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(root, absolutePath, bundle);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = sanitizeRelativePath(relative(root, absolutePath));
    const data = new Uint8Array(await readFile(absolutePath));
    const mediaType = guessMediaType(relativePath);
    bundle.push({
      relativePath,
      data,
      ...(mediaType ? { mediaType } : {}),
    });
  }
};

const unpackZip = async (data: Uint8Array): Promise<readonly SkillBundleFile[]> => {
  const zip = await JSZip.loadAsync(data);
  const bundle: SkillBundleFile[] = [];
  for (const [rawPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const relativePath = sanitizeRelativePath(entry.unsafeOriginalName ?? rawPath);
    const fileData = new Uint8Array(await entry.async('uint8array'));
    const mediaType = guessMediaType(relativePath);
    bundle.push({
      relativePath,
      data: fileData,
      ...(mediaType ? { mediaType } : {}),
    });
  }
  return bundle.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const toSkillResource = (file: SkillBundleFile): SkillResource => ({
  kind: inferResourceKind(file.relativePath),
  path: file.relativePath,
  sizeBytes: file.data.byteLength,
  ...(file.mediaType ? { mediaType: file.mediaType } : {}),
});

const inferResourceKind = (relativePath: string): SkillResource['kind'] => {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (normalizedPath.toLowerCase() === 'skill.md') return 'skill';
  if (normalizedPath.startsWith('scripts/')) return 'script';
  if (normalizedPath.startsWith('references/')) return 'reference';
  if (normalizedPath.startsWith('assets/')) return 'asset';
  return 'file';
};

const guessMediaType = (relativePath: string): string | undefined => {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.py')) return 'text/x-python';
  if (lower.endsWith('.sh')) return 'text/x-shellscript';
  if (lower.endsWith('.js')) return 'text/javascript';
  if (lower.endsWith('.ts')) return 'text/typescript';
  return undefined;
};

const extractClawHubDownloadUrl = (pageUrl: string, html: string): string | undefined => {
  const downloadAnchor = /<a[^>]+href="([^"]+)"[^>]*>\s*Download(?:\s+zip)?\s*<\/a>/i.exec(html);
  if (!downloadAnchor?.[1]) return undefined;
  return new URL(downloadAnchor[1], pageUrl).toString();
};

const loadSkillFromClawHubPage = async (input: {
  readonly requestedUrl: string;
  readonly pageUrl: string;
  readonly html: string;
  readonly fetchImpl: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}): Promise<ImportedSkill> => {
  const downloadUrl = extractClawHubDownloadUrl(input.pageUrl, input.html);

  if (downloadUrl) {
    const archiveResponse = await fetchWithTimeout(
      input.fetchImpl,
      downloadUrl,
      input.headers ? { headers: input.headers } : {},
      input.timeoutMs,
    );
    const bundle = await unpackZip(new Uint8Array(await archiveResponse.arrayBuffer()));
    const skill = buildImportedSkill({
      bundle,
      source: {
        kind: 'clawhub',
        locator: input.requestedUrl,
        pageUrl: input.pageUrl,
        downloadUrl,
        fetchedAt: new Date().toISOString(),
      },
      fallbackId: basename(normalizeUrl(input.pageUrl).pathname) || 'clawhub-skill',
    });
    bundleRegistry.set(skill, bundle);
    return skill;
  }

  const readme = extractJsonStringValue(input.html, 'readme');
  if (!readme) {
    throw new Error(
      `Could not find a downloadable skill bundle or embedded SKILL.md in ${input.requestedUrl}`,
    );
  }

  const bundle = [toSkillFile('SKILL.md', readme, 'text/markdown')];
  const skill = buildImportedSkill({
    bundle,
    source: {
      kind: 'clawhub',
      locator: input.requestedUrl,
      pageUrl: input.pageUrl,
      fetchedAt: new Date().toISOString(),
    },
    fallbackId: basename(normalizeUrl(input.pageUrl).pathname) || 'clawhub-skill',
    diagnostics: [
      'ClawHub page did not expose a download link; fell back to embedded SKILL.md only.',
    ],
  });
  bundleRegistry.set(skill, bundle);
  return skill;
};

const extractSkillHubPage = (
  url: string,
  html: string,
): {
  readonly bundle: readonly SkillBundleFile[];
  readonly source: ImportedSkillSource;
  readonly fallbackId: string;
  readonly diagnostics: readonly string[];
} => {
  const rawSkill =
    extractJsonStringValue(html, 'skill_md_raw') ??
    extractJsonStringValue(html, 'skill_md_original') ??
    extractJsonStringValue(html, 'readme_raw');
  if (!rawSkill) {
    throw new Error(`Could not find embedded SKILL.md content in ${url}`);
  }

  const bundle = [toSkillFile('SKILL.md', rawSkill, 'text/markdown')];
  const repoUrl = extractJsonStringValue(html, 'repo_url');
  return {
    bundle,
    source: {
      kind: 'skillhub',
      locator: url,
      pageUrl: url,
      ...(repoUrl ? { repoUrl } : {}),
      fetchedAt: new Date().toISOString(),
    },
    fallbackId: basename(normalizeUrl(url).pathname) || 'skillhub-skill',
    diagnostics: ['Imported SkillHub skill from embedded SKILL.md content.'],
  };
};

const toSkillFile = (
  relativePath: string,
  text: string,
  mediaType?: string,
): SkillBundleFile => ({
  relativePath,
  data: new TextEncoder().encode(text),
  ...(mediaType ? { mediaType } : {}),
});

const sanitizeRelativePath = (value: string): string => {
  const normalizedPath = normalize(value).replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid skill file path "${value}"`);
  }
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Refusing to load unsafe skill path "${value}"`);
  }
  return segments.join('/');
};

const assertWithinRoot = (root: string, candidate: string): void => {
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || rel.includes(':')) {
    throw new Error(`Refusing to write outside of target skill directory: ${candidate}`);
  }
};

const extractJsonStringValue = (source: string, key: string): string | undefined => {
  const needle = `"${key}":"`;
  let index = source.indexOf(needle);
  while (index !== -1) {
    const start = index + needle.length;
    let cursor = start;
    let raw = '';
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === undefined) break;
      const backslashCount = countTrailingBackslashes(raw);
      if (char === '"' && backslashCount % 2 === 0) {
        try {
          return JSON.parse(`"${raw}"`) as string;
        } catch {
          break;
        }
      }
      raw += char;
      cursor += 1;
    }
    index = source.indexOf(needle, start);
  }
  return undefined;
};

const countTrailingBackslashes = (value: string): number => {
  let count = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === '\\'; index -= 1) {
    count += 1;
  }
  return count;
};

const fetchWithTimeout = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const isZipResponse = (
  url: string,
  contentType: string,
  contentDisposition: string | null,
): boolean => {
  return url.toLowerCase().endsWith('.zip') ||
    contentType.includes('application/zip') ||
    contentType.includes('application/octet-stream') ||
    (contentDisposition?.toLowerCase().includes('.zip') ?? false);
};

const normalizeUrl = (value: string): URL => new URL(value);

const firstNonEmptyString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const toRecord = (value: unknown): Record<string, unknown> => {
  return isPlainObject(value) ? value : {};
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
