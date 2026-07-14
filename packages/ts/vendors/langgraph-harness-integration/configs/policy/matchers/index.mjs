/**
 * Barrel for the tri-state policy matchers (Epic 04; record 0019/D3).
 * `MATCHERS` is the shared ordered list `matchesPolicyRule` combines with the
 * implicit-AND / null-skip semantics.
 */
export { matchEcosystem } from "./ecosystem.mjs";
export { matchConfidence } from "./confidence.mjs";
export { matchDepType } from "./dep-type.mjs";
export { matchRepoUrl } from "./repo.mjs";

import { matchEcosystem } from "./ecosystem.mjs";
import { matchConfidence } from "./confidence.mjs";
import { matchDepType } from "./dep-type.mjs";
import { matchRepoUrl } from "./repo.mjs";

export const MATCHERS = [matchEcosystem, matchConfidence, matchDepType, matchRepoUrl];
