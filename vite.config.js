import { defineConfig, loadEnv } from 'vite';
import { isPublishableKey } from './src/services/public-key.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (key && !isPublishableKey(key)) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must contain a Supabase publishable or anon key.');
  }
  return {
    base: './',
    envPrefix: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
    server: { strictPort: true },
  };
});
