export interface AppConfig {
  region: string;
  clientId: string;
  cognitoDomain: string;
  selfSignUp?: boolean;
  /** Local dev server only: no login. */
  dev?: boolean;
}

let config: AppConfig | undefined;

export async function loadConfig(): Promise<AppConfig> {
  if (!config) {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`config.json: ${res.status}`);
    config = (await res.json()) as AppConfig;
  }
  return config;
}

export const getConfig = (): AppConfig => {
  if (!config) throw new Error('config not loaded');
  return config;
};
