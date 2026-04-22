export type SkillResourceKind = 'skill' | 'script' | 'reference' | 'asset' | 'file';

export interface SkillResource {
  readonly kind: SkillResourceKind;
  readonly path: string;
  readonly sizeBytes: number;
  readonly mediaType?: string;
}

export interface ImportedSkillSource {
  readonly kind: 'directory' | 'zip' | 'url' | 'clawhub' | 'skillhub';
  readonly locator: string;
  readonly pageUrl?: string;
  readonly downloadUrl?: string;
  readonly repoUrl?: string;
  readonly fetchedAt: string;
}

export interface ImportedSkill {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
  readonly preferredActionIds?: readonly string[];
  readonly examples?: readonly string[];
  readonly source: ImportedSkillSource;
  readonly resources: readonly SkillResource[];
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly allowedTools?: readonly string[];
  readonly diagnostics?: readonly string[];
}

export interface DirectorySkillSource {
  readonly kind: 'directory';
  readonly path: string;
}

export interface ZipSkillSource {
  readonly kind: 'zip';
  readonly path: string;
}

export interface UrlSkillSource {
  readonly kind: 'url';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ClawHubSkillSource {
  readonly kind: 'clawhub';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export type SkillSource =
  | DirectorySkillSource
  | ZipSkillSource
  | UrlSkillSource
  | ClawHubSkillSource;

export interface RemoteSkillLoadOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export interface SkillHubRegistryClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface SkillHubSearchOptions {
  readonly query: string;
  readonly limit?: number;
  readonly category?: string;
  readonly method?: 'hybrid' | 'embedding' | 'fulltext';
}

export interface SkillHubBrowseOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: 'score' | 'stars' | 'recent' | 'composite';
  readonly category?: string;
}

export interface SkillHubRegistryEntry {
  readonly id?: string;
  readonly slug?: string;
  readonly name: string;
  readonly description: string;
  readonly category?: string;
  readonly author?: string;
  readonly sourceUrl?: string;
  readonly pageUrl?: string;
  readonly raw: unknown;
}
