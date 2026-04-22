export class ToolAllowlistError extends Error {
  constructor(tool: string) {
    super(`Tool "${tool}" is not in allowlist`);
    this.name = 'ToolAllowlistError';
  }
}

export class ToolAllowlist {
  private readonly allowed: ReadonlySet<string>;

  constructor(tools: readonly string[]) {
    this.allowed = new Set(tools);
  }

  assert(tool: string): void {
    if (!this.allowed.has(tool)) throw new ToolAllowlistError(tool);
  }

  has(tool: string): boolean {
    return this.allowed.has(tool);
  }
}
