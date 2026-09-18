import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

function personaTokenPlugin(): any {
  return {
    name: 'persona-token-middleware',
    configureServer(server: any) {
      // Auto-check and seed if database is empty
      (async () => {
        try {
          const { seedDatabase } = await import('./scripts/seedFirestore');
          // seedDatabase sets with merge: true
          await seedDatabase();
        } catch (e: any) {
          console.warn('Auto-seed check failed or skipped:', e?.message || e);
        }
      })();

      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';

        if (url === '/api/seed') {
          try {
            const { seedDatabase } = await import('./scripts/seedFirestore');
            await seedDatabase();
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ success: true, message: 'Database seeded successfully' }));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: e?.message || 'Failed to seed database' }));
          }
        }

        if (url.includes('getPersonaToken')) {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: { message: 'Method Not Allowed' } }));
          }

          let rawBody = '';
          req.on('data', (chunk: any) => {
            rawBody += chunk;
          });
          req.on('end', async () => {
            try {
              const body = JSON.parse(rawBody || '{}');
              const personaId = body?.data?.personaId || body?.data?.uid || body?.personaId || body?.uid;
              const ALLOWED_PERSONAS = ['user_arjun', 'user_priya', 'user_rohan', 'user_ananya'];

              if (!personaId || !ALLOWED_PERSONAS.includes(personaId)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({
                  error: {
                    status: 'INVALID_ARGUMENT',
                    message: `Unauthorized persona requested: '${personaId}'. Only predefined demo personas are permitted.`
                  }
                }));
              }

              const { initializeApp, getApps, cert } = await import('firebase-admin/app');
              const { getAuth } = await import('firebase-admin/auth');

              const saJson = process.env.SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
              if (!saJson) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({
                  error: {
                    status: 'INTERNAL',
                    message: 'Server missing SERVICE_ACCOUNT_JSON.'
                  }
                }));
              }

              const sa = JSON.parse(saJson);
              const apps = getApps();
              const adminApp = apps.length > 0 ? apps[0] : initializeApp({
                credential: cert(sa),
                projectId: sa.project_id || 'swapx-app-314e1'
              });

              const adminAuth = getAuth(adminApp);
              const customToken = await adminAuth.createCustomToken(personaId);

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({
                result: {
                  token: customToken,
                  uid: personaId
                }
              }));
            } catch (err: any) {
              console.error('Error generating persona custom token:', err?.message || err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({
                error: {
                  status: 'INTERNAL',
                  message: 'Internal server error generating persona token.'
                }
              }));
            }
          });
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), personaTokenPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
