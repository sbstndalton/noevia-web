// Browser/core protocol major. A breaking change introduces a new major; additive
// fields keep the current one. This marker is separate from the release/build SHA.
export const API_MAJOR = '1';

export type ApiCompatibility = 'compatible' | 'mismatch' | 'unavailable';

function isDifferentMajor(servedMajor: string | null): boolean {
  // The pre-contract core already serves v1 routes. Accept a missing marker
  // during rollout and rollback; only an explicit different major is unsafe.
  return servedMajor !== null && servedMajor !== API_MAJOR;
}

export async function checkApiCompatibility(fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<ApiCompatibility> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/api/ready', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return 'unavailable';
    return isDifferentMajor(response.headers.get('X-Noevia-API')) ? 'mismatch' : 'compatible';
  } catch {
    // An offline or starting server is handled by the existing connection error path.
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

export function hasApiMajorMismatch(response: Response): boolean {
  // A gateway error without the core's header is a reachability failure, not
  // evidence that a different API major is serving the request.
  return hasApiMajorMismatchHeader(response.headers?.get?.('X-Noevia-API') ?? null, response.status);
}

export function hasApiMajorMismatchHeader(major: string | null, status: number): boolean {
  return status < 500 && isDifferentMajor(major);
}

// Version-pinned Skill invocation (#272), additive to POST /api/chat as `skill`.
// `version` is the manifest's SHA-256 version, or its human label together with
// `contentHash`. Only the reviewed, enabled content of the chat's project resolves.
export type SkillPin = `skill_${string}@${string}` | { id: string; version?: string; contentHash?: string };

// Echoed on the chat stream's `meta` event (and the durable turn) when a pin resolved.
export interface PinnedSkillRecord {
  id: string;
  file: string;
  name: string;
  versionLabel: string;
  version: string;
  contentHash: string;
  origin: 'published' | 'project-file' | 'attached-folder';
}

// `code` on a refused pin's JSON error body; the request never reached a model.
export type SkillPinErrorCode =
  | 'skill_pin_invalid'            // 400 malformed pin, or a pin on compaction
  | 'skill_pin_requires_project'   // 400 no project chat
  | 'skill_pin_unsupported_mode'   // 400 Cowork-mode request
  | 'skill_not_found'              // 404 not a Skill of this project (or tenant)
  | 'skill_version_unknown'        // 404 no such version in this project
  | 'skill_version_changed'        // 409 the reviewed version was replaced on disk
  | 'skill_version_unreviewed'     // 409 this exact version awaits review
  | 'skill_disabled'               // 409
  | 'skill_hash_mismatch'          // 409 version, label and content hash disagree
  | 'skill_invalid'                // 422
  | 'skill_unsupported_requirements' // 422 a required toolbox this server does not offer
  | 'skill_requirements_unmet'     // 422 a required toolbox this request does not carry (JSON body also lists `missing`)
  | 'skill_scripts_unsupported';   // 422 the skill bundles executable scripts, which chat never runs

// `code` on a chat stream `error` event that ends a reply for Skill reasons (#272).
//   skill_requirements_unmet  the provider cannot use a toolbox the pinned skill requires; no model request was made
//   skill_revoked             a skill this reply loaded was disabled or changed; nothing after that point ran
export type SkillStreamErrorCode = 'skill_requirements_unmet' | 'skill_revoked';

// One entry of GET /api/projects/{id}/instruction-skills/manifests (schemaVersion 1). Descriptive
// only: requirements never enable a tool or skip an approval.
export interface SkillManifest {
  schemaVersion: 1;
  id: string;
  file: string;
  name: string;
  description: string;
  versionLabel: string;
  version: string;
  status: 'review' | 'updated' | 'enabled' | 'disabled' | 'invalid';
  valid: boolean;
  error: string;
  origin: { kind: 'published' | 'project-file' | 'attached-folder'; publisher?: string; repository?: string; sourceRef?: string; sourcePath?: string; digest?: string; retrievedAt?: string };
  compatibility: string;
  license: string;
  requirements: { toolboxes: string[]; allowedTools: string[]; unsupportedToolboxes: string[]; unselectedToolboxes: string[]; scripts: string[] };
  assets: { file: string; version: string; executable: boolean }[];
  resolvable: boolean;
}
