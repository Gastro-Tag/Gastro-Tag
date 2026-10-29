import { config } from 'dotenv';
import { configDefaults, defineConfig } from 'vitest/config';

// Carrega o banco descartável e os segredos de teste, se existirem. Não sobrescreve variáveis já definidas (CI).
config({ path: '.env.test' });

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...(process.env.DATABASE_URL ? [] : ['tests/api.test.ts'])],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
