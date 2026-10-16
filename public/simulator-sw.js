/*
 * Same-origin response simulator.
 * To change behavior, edit ROUTES and handleAction below.
 * Unmatched same-origin requests are forwarded to the real server by default.
 */
const SIMULATOR_SOURCE = 'raysite-simulator';
const FALLBACK_MODE = 'network'; // 'network' or '404'

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function css(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function readRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const text = await request.clone().text();
  if (!text) return null;
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  return { raw: text };
}

async function broadcast(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin) {
      client.postMessage({ source: SIMULATOR_SOURCE, ...message });
    }
  }
}

async function commitHandler(request, url) {
  const body = await readRequestBody(request);
  await broadcast({ type: 'BUILDER_ACTION', action: body?.action || 'publish', requestBody: body });
  return json({
    ok: true,
    simulated: true,
    endpoint: url.pathname,
    receivedMethod: request.method,
    receivedBody: body,
    message: 'Commit simulated successfully.'
  }, 200);
}

// Ordered route definitions. Add routes here to simulate more of your app's HTTP API.
const ROUTES = [
  {
    method: 'GET',
    path: '/assets/main.css',
    handler: async () => css(`
      :root { font: 16px/1.5 system-ui, sans-serif; color: #172033; }
      body { margin: 0; padding: 22px; background: linear-gradient(135deg, #eef6ff, #f7f0ff); }
      .preview-card { max-width: 760px; margin: 0 auto; padding: 22px; background: white; border: 1px solid #d8e1ef; border-radius: 16px; box-shadow: 0 8px 28px #20305018; }
      h1 { margin-top: 0; color: #3d46a5; }
      .buttons { display: flex; flex-wrap: wrap; gap: 8px; }
      button { border: 0; border-radius: 8px; padding: 10px 12px; background: #424fc7; color: white; cursor: pointer; }
      button:hover { background: #303b9f; }
      pre { overflow: auto; padding: 12px; background: #f0f3f8; border-radius: 8px; white-space: pre-wrap; }
      code { background: #f0f3f8; padding: 2px 5px; border-radius: 4px; }
    `)
  },
  {
    method: 'POST',
    path: '/commit',
    handler: commitHandler
  },
  {
    method: 'GET',
    path: '/api/page',
    handler: async () => json({
      id: 'home',
      title: 'Demo home page',
      components: [{ type: 'heading', text: 'Hello from the simulated server' }],
      simulated: true
    })
  },
  {
    method: 'GET',
    path: '/api/failure-demo',
    handler: async () => json({ error: 'Simulated server error' }, 500)
  },
  {
    method: 'GET',
    path: '/simulator/health',
    handler: async () => json({ ok: true, simulator: 'running' })
  }
];

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Only this origin is simulated. External origins remain untouched.
  if (url.origin !== self.location.origin) return;

  // Ignore browser-only schemes and requests not handled as HTTP(S).
  if (!['http:', 'https:'].includes(url.protocol)) return;

  event.respondWith((async () => {
    const route = ROUTES.find(candidate =>
      candidate.method === request.method && candidate.path === url.pathname
    );

    if (!route) {
      await broadcast({
        type: 'REQUEST_PASSTHROUGH',
        method: request.method,
        pathname: url.pathname
      });

      if (FALLBACK_MODE === '404') {
        const response = new Response(JSON.stringify({
          error: 'Not Found',
          simulated: true,
          method: request.method,
          path: url.pathname
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
        return response;
      }

      // The service worker sees the request, but this mode forwards it to the origin server.
      return fetch(request);
    }

    let response;
    try {
      response = await route.handler(request, url);
    } catch (error) {
      response = json({ error: 'Simulator handler failed', detail: String(error) }, 500);
    }

    await broadcast({
      type: 'REQUEST_SIMULATED',
      method: request.method,
      pathname: url.pathname,
      status: response.status
    });

    // HEAD must not return a body. Preserve status and headers from the selected route.
    if (request.method === 'HEAD') {
      return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  })());
});
