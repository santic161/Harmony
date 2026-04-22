import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadSkillFromClawHub,
  loadSkillFromDirectory,
  loadSkillFromUrl,
  loadSkillFromZip,
  writeImportedSkill,
} from '../src/skills/SkillImporter.js';

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('SkillImporter', () => {
  it('loads a minimal skill from a local directory and inventories its resources', async () => {
    const skillDir = await createTempSkillDir({
      'SKILL.md': `---
name: Release Review
description: Review a release before approving it.
---
Ask one question at a time and summarize deployment risk.`,
      'references/checklist.md': '# Checklist',
      'assets/logo.svg': '<svg />',
    });

    const skill = await loadSkillFromDirectory(skillDir);

    expect(skill.id).toBe('release-review');
    expect(skill.description).toBe('Review a release before approving it.');
    expect(skill.instructions).toContain('Ask one question at a time');
    expect(skill.source.kind).toBe('directory');
    expect(skill.resources).toEqual([
      expect.objectContaining({ kind: 'asset', path: 'assets/logo.svg' }),
      expect.objectContaining({ kind: 'reference', path: 'references/checklist.md' }),
      expect.objectContaining({ kind: 'skill', path: 'SKILL.md' }),
    ]);
  });

  it('parses optional frontmatter fields and recovers common malformed YAML', async () => {
    const skillDir = await createTempSkillDir({
      'SKILL.md': `---
name: Incident Review
description: Review release: production rollout
license: MIT
compatibility: node >=20
metadata:
  provider: skillhub
allowed-tools:
  - read
  - grep
---
Investigate the release evidence before making a recommendation.`,
    });

    const skill = await loadSkillFromDirectory(skillDir);

    expect(skill.id).toBe('incident-review');
    expect(skill.license).toBe('MIT');
    expect(skill.compatibility).toBe('node >=20');
    expect(skill.metadata).toEqual({ provider: 'skillhub' });
    expect(skill.allowedTools).toEqual(['read', 'grep']);
    expect(skill.diagnostics).toEqual(
      expect.arrayContaining([expect.stringContaining('Recovered malformed YAML frontmatter')]),
    );
  });

  it('rejects a skill when no usable description can be recovered', async () => {
    const skillDir = await createTempSkillDir({
      'SKILL.md': `---
name: Empty Skill
---
# Heading only
## Still no description`,
    });

    await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
      'missing a usable description',
    );
  });

  it('rejects irrecoverable frontmatter', async () => {
    const skillDir = await createTempSkillDir({
      'SKILL.md': `---
[broken
---
Body content that should not be reached.`,
    });

    await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
      'Could not parse SKILL.md frontmatter',
    );
  });

  it('loads a skill bundle from a local zip archive', async () => {
    const zipPath = await createZipBundle({
      'SKILL.md': `---
name: Zip Audit
description: Imported from a zip bundle.
---
Use the bundle resources without executing scripts.`,
      'scripts/report.js': 'console.log("noop");',
    });

    const skill = await loadSkillFromZip(zipPath);

    expect(skill.id).toBe('zip-audit');
    expect(skill.source.kind).toBe('zip');
    expect(skill.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'script', path: 'scripts/report.js' })]),
    );
  });

  it('loads a generic remote skill from a direct SKILL.md URL', async () => {
    const skill = await loadSkillFromUrl('https://example.com/skills/release.md', {
      fetch: async () =>
        new Response(
          `---
name: Remote Skill
description: Imported from a direct URL.
---
Stay concise and ask for missing deployment context only when needed.`,
          {
            status: 200,
            headers: { 'content-type': 'text/markdown' },
          },
        ),
    });

    expect(skill.id).toBe('remote-skill');
    expect(skill.description).toBe('Imported from a direct URL.');
    expect(skill.source.kind).toBe('url');
  });

  it('imports a SkillHub page by extracting embedded SKILL.md content', async () => {
    const skill = await loadSkillFromUrl('https://www.skillhub.club/skills/release-guardian', {
      fetch: async () =>
        new Response(
          `<html><script>window.__NEXT_DATA__={"skill_md_raw":"---\\nname: SkillHub Guard\\ndescription: Imported from SkillHub.\\ncompatibility: codex\\n---\\nAudit releases carefully.","repo_url":"https://github.com/example/release-guardian"}</script></html>`,
          {
            status: 200,
            headers: { 'content-type': 'text/html' },
          },
        ),
    });

    expect(skill.id).toBe('skillhub-guard');
    expect(skill.source).toEqual(
      expect.objectContaining({
        kind: 'skillhub',
        locator: 'https://www.skillhub.club/skills/release-guardian',
        repoUrl: 'https://github.com/example/release-guardian',
      }),
    );
    expect(skill.compatibility).toBe('codex');
  });

  it('resolves a ClawHub page download link and imports the zip bundle', async () => {
    const bundle = await makeZipBytes({
      'SKILL.md': `---
name: ClawHub Skill
description: Imported from ClawHub.
---
Use only trusted runtime actions.`,
      'references/playbook.md': 'Reference content',
    });

    const fetchLog: string[] = [];
    const skill = await loadSkillFromClawHub('https://clawhub.ai/skills/release-helper', {
      fetch: async (input) => {
        const url = String(input);
        fetchLog.push(url);
        if (url === 'https://clawhub.ai/skills/release-helper') {
          return new Response(
            '<html><body><a href="/api/download/release-helper.zip">Download zip</a></body></html>',
            {
              status: 200,
              headers: { 'content-type': 'text/html' },
            },
          );
        }
        return new Response(bundle, {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        });
      },
    });

    expect(fetchLog).toEqual([
      'https://clawhub.ai/skills/release-helper',
      'https://clawhub.ai/api/download/release-helper.zip',
    ]);
    expect(skill.id).toBe('clawhub-skill');
    expect(skill.source).toEqual(
      expect.objectContaining({
        kind: 'clawhub',
        downloadUrl: 'https://clawhub.ai/api/download/release-helper.zip',
      }),
    );
  });

  it('rejects unsafe zip paths with traversal attempts', async () => {
    const zipPath = await createZipBundle({
      'SKILL.md': `---
name: Safe Skill
description: Should never load.
---
Hidden.`,
      '../escape.txt': 'nope',
    });

    await expect(loadSkillFromZip(zipPath)).rejects.toThrow('unsafe skill path');
  });

  it('writes an imported skill only when an explicit target directory is provided', async () => {
    const zipPath = await createZipBundle({
      'SKILL.md': `---
name: Persisted Skill
description: Persist me explicitly.
---
Write the bundle only when the host asks for it.`,
      'assets/icon.txt': 'asset',
    });
    const skill = await loadSkillFromZip(zipPath);
    const outputDir = await makeTempDir('persisted-skill-output-');

    const writtenRoot = await writeImportedSkill(skill, outputDir);

    expect(writtenRoot).toBe(outputDir);
    await expect(readFile(join(outputDir, 'SKILL.md'), 'utf8')).resolves.toContain(
      'Persisted Skill',
    );
    await expect(readFile(join(outputDir, 'assets/icon.txt'), 'utf8')).resolves.toBe('asset');
  });
});

async function createTempSkillDir(files: Record<string, string>): Promise<string> {
  const root = await makeTempDir('skill-importer-dir-');
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const outputPath = join(root, relativePath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents, 'utf8');
    }),
  );
  return root;
}

async function createZipBundle(files: Record<string, string>): Promise<string> {
  const root = await makeTempDir('skill-importer-zip-');
  const zipPath = join(root, 'bundle.zip');
  const zip = new JSZip();
  for (const [relativePath, contents] of Object.entries(files)) {
    zip.file(relativePath, contents);
  }
  await writeFile(zipPath, await zip.generateAsync({ type: 'uint8array' }));
  return zipPath;
}

async function makeZipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [relativePath, contents] of Object.entries(files)) {
    zip.file(relativePath, contents);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

async function makeTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  createdPaths.push(path);
  return path;
}
