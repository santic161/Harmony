export interface SanitizeOptions {
  readonly maxLength: number;
  readonly stripControlChars: boolean;
  readonly stripZeroWidth: boolean;
  readonly collapseWhitespace: boolean;
}

export const DEFAULT_SANITIZE: SanitizeOptions = {
  maxLength: 4096,
  stripControlChars: true,
  stripZeroWidth: true,
  collapseWhitespace: true,
};

// Zero-width + BOM + bidi overrides that attackers use to hide content.
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
// Control chars except \n \r \t.
const CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export class InputSanitizer {
  private readonly opts: SanitizeOptions;

  constructor(opts: Partial<SanitizeOptions> = {}) {
    this.opts = { ...DEFAULT_SANITIZE, ...opts };
  }

  sanitize(input: string): string {
    if (typeof input !== 'string') {
      throw new TypeError('InputSanitizer: input must be a string');
    }
    let out = input;
    if (this.opts.stripZeroWidth) out = out.replace(ZERO_WIDTH_RE, '');
    if (this.opts.stripControlChars) out = out.replace(CTRL_RE, '');
    if (this.opts.collapseWhitespace) out = out.replace(/[ \t]{3,}/g, '  ');
    if (out.length > this.opts.maxLength) {
      out = out.slice(0, this.opts.maxLength);
    }
    return out.trim();
  }
}
