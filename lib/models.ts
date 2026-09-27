/**
 * Picks the cross-region inference profile that keeps data closest to the deploy region.
 * Override with `-c draftModelId=...` / `-c finalModelId=...` when a region needs something else.
 */
export function defaultModelId(region: string, baseModelId: string): string {
  if (region === 'ap-northeast-1' || region === 'ap-northeast-3') return `jp.${baseModelId}`;
  if (region.startsWith('us-')) return `us.${baseModelId}`;
  if (region.startsWith('eu-')) return `eu.${baseModelId}`;
  return `global.${baseModelId}`;
}

const PROFILE_PREFIXES = new Set(['us', 'eu', 'apac', 'jp', 'au', 'ca', 'us-gov', 'global']);

/** IAM resources needed to invoke a model ID (plain on-demand model or inference profile). */
export function modelResourceArns(region: string, account: string, modelId: string): string[] {
  const [prefix, ...rest] = modelId.split('.');
  if (!PROFILE_PREFIXES.has(prefix)) {
    return [`arn:aws:bedrock:${region}::foundation-model/${modelId}`];
  }
  const base = rest.join('.');
  return [
    `arn:aws:bedrock:${region}:${account}:inference-profile/${modelId}`,
    // A profile routes to the model in any of its destination regions.
    `arn:aws:bedrock:*::foundation-model/${base}`,
    // Global profiles are authorized against the region-less model ARN.
    `arn:aws:bedrock:::foundation-model/${base}`,
  ];
}
