import { describe, expect, it } from 'vitest';
import {
  SkillHubRegistryClient,
} from '../src/skills/SkillHubRegistryClient.js';

describe('SkillHubRegistryClient', () => {
  it('searches the registry with explicit auth and maps partial records', async () => {
    let seenAuthorization = '';
    let seenMethod = '';

    const client = new SkillHubRegistryClient({
      apiKey: 'secret-key',
      fetch: async (_input, init) => {
        seenAuthorization = String((init?.headers as Record<string, string>)?.Authorization ?? '');
        seenMethod = String(init?.method ?? '');
        return new Response(
          JSON.stringify({
            skills: [
              {
                skill_id: 'skill-1',
                name: 'Release Guardian',
                description: 'Guards release decisions.',
                owner: 'SkillHub',
                source_url: 'https://github.com/example/release-guardian',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const results = await client.search({ query: 'release', limit: 5 });

    expect(seenAuthorization).toBe('Bearer secret-key');
    expect(seenMethod).toBe('POST');
    expect(results).toEqual([
      expect.objectContaining({
        id: 'skill-1',
        name: 'Release Guardian',
        description: 'Guards release decisions.',
        author: 'SkillHub',
        sourceUrl: 'https://github.com/example/release-guardian',
      }),
    ]);
  });

  it('browses the catalog and fills a page URL from the slug when needed', async () => {
    const client = new SkillHubRegistryClient({
      apiKey: 'secret-key',
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                slug: 'ops-helper',
                title: 'Ops Helper',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const results = await client.browseCatalog({ limit: 10, sort: 'recent' });

    expect(results).toEqual([
      expect.objectContaining({
        slug: 'ops-helper',
        name: 'Ops Helper',
        description: 'No description provided.',
        pageUrl: 'https://www.skillhub.club/skills/ops-helper',
      }),
    ]);
  });

  it.each([
    [401, 'Unauthorized'],
    [429, 'Too Many Requests'],
  ])('surfaces HTTP failures clearly (%s)', async (status, statusText) => {
    const client = new SkillHubRegistryClient({
      apiKey: 'secret-key',
      fetch: async () => new Response('rate limited', { status, statusText }),
    });

    await expect(client.search({ query: 'release' })).rejects.toThrow(
      `SkillHub request failed (${status})`,
    );
  });

  it('honors request timeouts', async () => {
    const client = new SkillHubRegistryClient({
      apiKey: 'secret-key',
      timeoutMs: 10,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    await expect(client.search({ query: 'slow request' })).rejects.toThrow('aborted');
  });
});
