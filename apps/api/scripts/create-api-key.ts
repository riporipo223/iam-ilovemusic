/**
 * Mint a new API key. Prints the plaintext key ONCE — only its hash is
 * stored, so if it's lost a new one must be generated.
 *
 * Usage: npm run create-api-key --workspace @ilovemusic/api -- --label "some client"
 */
import { pool } from '../src/db/pool';
import { generateApiKey } from '../src/apiKeys';

async function main() {
  const labelFlagIndex = process.argv.indexOf('--label');
  const label = labelFlagIndex !== -1 ? process.argv[labelFlagIndex + 1] : null;

  const { plaintext, hash } = generateApiKey();

  const result = await pool.query<{ id: string }>(
    'INSERT INTO api_keys (key_hash, label) VALUES ($1, $2) RETURNING id',
    [hash, label]
  );

  console.log('API key created.');
  console.log('  id:    ', result.rows[0].id);
  console.log('  label: ', label ?? '(none)');
  console.log('  key:   ', plaintext);
  console.log('\nStore this key now — it will not be shown again.');

  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create API key:', err);
  process.exit(1);
});
