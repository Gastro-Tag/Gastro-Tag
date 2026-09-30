import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...(process.env.DATABASE_URL ? [] : ['tests/api.test.ts'])],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
