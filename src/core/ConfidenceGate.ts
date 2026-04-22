export interface ConfidenceGateOptions {
  readonly autoFinalizeThreshold: number;
  readonly minConfirmThreshold: number;
}

export const DEFAULT_GATE: ConfidenceGateOptions = {
  autoFinalizeThreshold: 0.98,
  minConfirmThreshold: 0.6,
};

export type GateDecision = 'finalize' | 'confirm' | 'ask_again';

export class ConfidenceGate {
  private readonly opts: ConfidenceGateOptions;

  constructor(opts: Partial<ConfidenceGateOptions> = {}) {
    this.opts = { ...DEFAULT_GATE, ...opts };
  }

  evaluate(confidence: number): GateDecision {
    if (confidence >= this.opts.autoFinalizeThreshold) return 'finalize';
    if (confidence >= this.opts.minConfirmThreshold) return 'confirm';
    return 'ask_again';
  }
}
