import type {
  SkillHubBrowseOptions,
  SkillHubRegistryClientOptions,
  SkillHubRegistryEntry,
  SkillHubSearchOptions,
} from './SkillTypes.js';

const DEFAULT_BASE_URL = 'https://www.skillhub.club/api/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

export class SkillHubRegistryClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: SkillHubRegistryClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(options: SkillHubSearchOptions): Promise<readonly SkillHubRegistryEntry[]> {
    const response = await this.requestJson(`${this.baseUrl}/skills/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: options.query,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.category ? { category: options.category } : {}),
        ...(options.method ? { method: options.method } : {}),
      }),
    });
    return toSkillHubEntries(response);
  }

  async browseCatalog(
    options: SkillHubBrowseOptions = {},
  ): Promise<readonly SkillHubRegistryEntry[]> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.sort) query.set('sort', options.sort);
    if (options.category) query.set('category', options.category);

    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const response = await this.requestJson(`${this.baseUrl}/skills/catalog${suffix}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
    });
    return toSkillHubEntries(response);
  }

  async browse(options: SkillHubBrowseOptions = {}): Promise<readonly SkillHubRegistryEntry[]> {
    return this.browseCatalog(options);
  }

  private async requestJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`SkillHub request failed (${response.status}): ${text.slice(0, 400)}`);
      }
      return text.length > 0 ? (JSON.parse(text) as unknown) : [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

const toSkillHubEntries = (payload: unknown): readonly SkillHubRegistryEntry[] => {
  const records = extractRecords(payload);
  return records.map((record) => {
    const name =
      firstString(record['name'], record['display_name'], record['title'], record['slug']) ??
      'unknown-skill';
    const slug = firstString(record['slug'], record['name']);
    const id = firstString(record['id'], record['skill_id']);
    const category = firstString(record['category']);
    const author = firstString(record['author'], record['owner'], record['creator']);
    const sourceUrl = firstString(record['source_url'], record['repo_url'], record['repoUrl']);
    const pageUrl = firstString(record['url'], record['page_url'], record['pageUrl']) ??
      (slug ? `https://www.skillhub.club/skills/${slug}` : undefined);

    return {
      ...(id ? { id } : {}),
      ...(slug ? { slug } : {}),
      name,
      description:
        firstString(record['description'], record['summary'], record['excerpt']) ??
        'No description provided.',
      ...(category ? { category } : {}),
      ...(author ? { author } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(pageUrl ? { pageUrl } : {}),
      raw: record,
    };
  });
};

const extractRecords = (payload: unknown): readonly Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) return [];

  const candidates = [payload['skills'], payload['data'], payload['results'], payload['items']];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }
  return [];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};
