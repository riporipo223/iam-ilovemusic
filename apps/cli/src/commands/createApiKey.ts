import * as p from '@clack/prompts';
import { createApiKey, ApiError } from '../api.js';
import { readConfig, writeConfig, getConfigPath } from '../config.js';

export async function runCreateApiKey(): Promise<void> {
  p.intro('ILoveMusic — create an API key');

  const existing = await readConfig();
  if (existing) {
    const overwrite = await p.confirm({
      message: `A key is already saved at ${getConfigPath()}. Replace it with a new one?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Kept the existing key. No changes made.');
      return;
    }
  }

  const label = await p.text({
    message: 'Label for this key (optional, helps you recognize it later)',
    placeholder: 'e.g. my laptop',
  });
  if (p.isCancel(label)) {
    p.cancel('Cancelled.');
    return;
  }

  const s = p.spinner();
  s.start('Requesting a new API key');
  try {
    const result = await createApiKey(label.trim() || undefined);
    await writeConfig({ apiKey: result.key, apiKeyId: result.id, createdAt: result.created_at });
    s.stop('API key created and saved.');
    p.outro(`Saved to ${getConfigPath()}\nYou're ready to run: ilovemusic download`);
  } catch (err) {
    s.stop('Failed to create API key.');
    if (err instanceof ApiError && err.status === 429) {
      p.log.error(
        'Rate limit hit: only a few keys can be created per network per day. ' +
          'If you already have a key saved elsewhere, reuse it instead of requesting a new one.'
      );
    } else {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  }
}
