import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const apiSrcPath = fileURLToPath(new URL('apps/api/src', import.meta.url));
const backgroundSrcPath = fileURLToPath(new URL('apps/background/src', import.meta.url));
const backendDataSrcPath = fileURLToPath(new URL('packages/backend-data/src', import.meta.url));
const backendErrorsSrcPath = fileURLToPath(new URL('packages/backend-errors/src', import.meta.url));
const backendRuntimeSrcPath = fileURLToPath(new URL('packages/backend-runtime/src', import.meta.url));
const sharedSrcPath = fileURLToPath(new URL('packages/shared/src', import.meta.url));
const backendServicesSrcPath = fileURLToPath(new URL('packages/backend-services/src', import.meta.url));
const cloudflareSocketsMockPath = fileURLToPath(new URL('test/mocks/cloudflare-sockets.ts', import.meta.url));
const cloudflareWorkersMockPath = fileURLToPath(new URL('test/mocks/cloudflare-workers.ts', import.meta.url));
const cloudflareWorkflowsMockPath = fileURLToPath(new URL('test/mocks/cloudflare-workflows.ts', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'test/_archive/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['apps/api/src/**/*.ts', 'apps/background/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts', '**/types.d.ts', '**/model/**'],
      thresholds: {
        // Scaffold baseline (2026-09-19): router core covered; raise stepwise
        // toward 70/55/70/70 as proxy/cron/UI tests land.
        statements: 20,
        branches: 15,
        functions: 12,
        lines: 22,
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@agent-router\/background$/, replacement: `${backgroundSrcPath}/index.ts` },
      { find: /^@agent-router\/backend-data$/, replacement: `${backendDataSrcPath}/index.ts` },
      { find: /^@agent-router\/backend-errors$/, replacement: `${backendErrorsSrcPath}/index.ts` },
      { find: /^@agent-router\/backend-runtime$/, replacement: `${backendRuntimeSrcPath}/index.ts` },
      { find: /^@agent-router\/backend-services$/, replacement: `${backendServicesSrcPath}/index.ts` },
      { find: /^@agent-router\/shared$/, replacement: `${sharedSrcPath}/index.ts` },
      { find: '@agent-router/background', replacement: backgroundSrcPath },
      { find: '@agent-router/backend-data', replacement: backendDataSrcPath },
      { find: '@agent-router/backend-errors', replacement: backendErrorsSrcPath },
      { find: '@agent-router/backend-runtime', replacement: backendRuntimeSrcPath },
      { find: '@agent-router/backend-services', replacement: backendServicesSrcPath },
      { find: '@agent-router/shared', replacement: sharedSrcPath },
      { find: 'cloudflare:sockets', replacement: cloudflareSocketsMockPath },
      { find: 'cloudflare:workers', replacement: cloudflareWorkersMockPath },
      { find: 'cloudflare:workflows', replacement: cloudflareWorkflowsMockPath },
      { find: /^@\//, replacement: `${apiSrcPath}/` },
    ],
  },
});
