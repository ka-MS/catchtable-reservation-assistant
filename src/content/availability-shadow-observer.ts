export interface ShadowClaimProposal {
  source: "body" | "dom";
  minutes: number;
  observedMonoMs: number;
  sequence: number | null;
}

export interface ShadowClaimResult {
  accepted: boolean;
  claim: ShadowClaimProposal;
}

export class ShadowClaimCoordinator {
  claim: ShadowClaimProposal | null = null;

  propose(proposal: ShadowClaimProposal): ShadowClaimResult {
    if (this.claim === null) {
      this.claim = { ...proposal };
      return { accepted: true, claim: this.claim };
    }
    return { accepted: false, claim: this.claim };
  }
}
