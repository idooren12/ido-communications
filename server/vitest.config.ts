import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      JWT_SECRET: 'test-secret-for-vitest-only',
      NODE_ENV: 'test',
      FRONTEND_URL: 'https://ido-communications.vercel.app',
    },
  },
});
