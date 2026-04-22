export interface GuardResult {
  readonly safeText: string;
  readonly flags: readonly string[];
  readonly severity: 'none' | 'low' | 'high';
}

// Heuristic, not a silver bullet. Defense-in-depth: also isolate user content
// in a delimited block and instruct the model via system prompt to treat it as data.
const HIGH_RISK_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'ignore_previous', re: /ignore (all |the )?(previous|prior|above)\s+(instructions|prompts|rules)/i },
  { name: 'system_spoof', re: /^\s*(system|assistant)\s*:/im },
  { name: 'delimiter_break', re: /<\/?(user_input|system|instructions)>/i },
  { name: 'reveal_prompt', re: /(reveal|print|show|output)\s+(the\s+)?(system|hidden|initial)\s+prompt/i },
  { name: 'role_override', re: /you are now\s+(a|an)\s+[a-z]+/i },
];

const LOW_RISK_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'jailbreak_persona', re: /\b(DAN|jailbreak|developer\s+mode)\b/i },
  { name: 'exfil_request', re: /(api[\s_-]?key|secret|token|password|credential)s?/i },
];

export class PromptGuard {
  inspect(userText: string): GuardResult {
    const flags: string[] = [];
    let severity: GuardResult['severity'] = 'none';

    for (const p of HIGH_RISK_PATTERNS) {
      if (p.re.test(userText)) {
        flags.push(p.name);
        severity = 'high';
      }
    }
    for (const p of LOW_RISK_PATTERNS) {
      if (p.re.test(userText)) {
        flags.push(p.name);
        if (severity === 'none') severity = 'low';
      }
    }

    const safeText = userText.replace(/<\/?(user_input|system|instructions)>/gi, '');
    return { safeText, flags, severity };
  }

  wrap(userText: string): string {
    return `<user_input>\n${userText}\n</user_input>`;
  }
}
