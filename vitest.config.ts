import { defineConfig } from 'vitest/config';
import path from 'path';

const alias = {
  '@': path.resolve(__dirname, '.'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['tests/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/setup-dom.ts'],
        },
      },
    ],
  },
});
