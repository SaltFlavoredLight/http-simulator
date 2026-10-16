function normalizePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("Route paths must start with '/'");
  }

  // Treat /what and /what/ as equivalent.
  if (path !== "/") {
    path = path.replace(/\/+$/, "");
  }

  return path || "/";
}

function getSegments(path) {
  const normalized = normalizePath(path);

  return normalized === "/"
    ? []
    : normalized.slice(1).split("/");
}

// *  = exactly one non-empty segment
// ** = zero or more segments
function matchesSegments(pattern, actual, pi = 0, ai = 0) {
  if (pi === pattern.length) {
    return ai === actual.length;
  }

  const segment = pattern[pi];

  if (segment === "**") {
    // ** at the end matches any remaining number of segments.
    if (pi === pattern.length - 1) {
      return true;
    }

    // Try matching zero, one, or more segments.
    for (let i = ai; i <= actual.length; i++) {
      if (matchesSegments(pattern, actual, pi + 1, i)) {
        return true;
      }
    }

    return false;
  }

  if (ai >= actual.length) {
    return false;
  }

  if (segment === "*") {
    if (actual[ai] === "") {
      return false;
    }
  } else if (segment !== actual[ai]) {
    return false;
  }

  return matchesSegments(pattern, actual, pi + 1, ai + 1);
}

class SimServer {
  constructor() {
    this.routes = [];
    this.registrationOrder = 0;
  }

  // Generic registration method.
  route(method, priority, path, handler) {
    method = String(method).toUpperCase();

    if (!Number.isFinite(priority)) {
      throw new TypeError("Route priority must be a finite number");
    }

    if (typeof handler !== "function") {
      throw new TypeError("Route handler must be a function");
    }

    const normalizedPath = normalizePath(path);

    this.routes.push({
      method,
      priority,
      path: normalizedPath,
      segments: getSegments(normalizedPath),
      handler,
      order: this.registrationOrder++
    });

    return this;
  }

  get(priority, path, handler) {
    return this.route("GET", priority, path, handler);
  }

  post(priority, path, handler) {
    return this.route("POST", priority, path, handler);
  }

  put(priority, path, handler) {
    return this.route("PUT", priority, path, handler);
  }

  delete(priority, path, handler) {
    return this.route("DELETE", priority, path, handler);
  }

  // Find the highest-priority route matching the request.
  findRoute(method, actualSegments) {
    let best = null;

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      if (!matchesSegments(route.segments, actualSegments)) {
        continue;
      }

      // Equal priorities preserve registration order.
      if (best === null || route.priority > best.priority) {
        best = route;
      }
    }

    return best;
  }

  // Find the registered 404.html handler.
  findNotFoundRoute() {
    let best = null;

    for (const route of this.routes) {
      if (route.method !== "GET" || route.path !== "/404.html") {
        continue;
      }

      if (best === null || route.priority > best.priority) {
        best = route;
      }
    }

    return best;
  }

  async runHandler(route, req) {
    const response = await route.handler(req);

    if (!(response instanceof Response)) {
      throw new TypeError(
        `Handler for ${route.method} ${route.path} must return a Response`
      );
    }

    return response;
  }

  // Ensure HEAD responses never contain a body.
  finishResponse(response, req, statusOverride = null) {
    const status = statusOverride ?? response.status;

    if (req.method !== "HEAD" && statusOverride === null) {
      return response;
    }

    return new Response(
      req.method === "HEAD" ? null : response.body,
      {
        status,
        statusText:
          status === 404 ? "Not Found" : response.statusText,
        headers: response.headers
      }
    );
  }

  // Main entry point: pass a Request, receive a Response.
  async fetch(req) {
    if (!(req instanceof Request)) {
      throw new TypeError("server.fetch() requires a Request object");
    }

    try {
      const url = new URL(req.url);
      const actualSegments = getSegments(url.pathname);

      // 1. Find the highest-priority matching route.
      const route = this.findRoute(req.method, actualSegments);

      if (route) {
        const response = await this.runHandler(route, req);
        return this.finishResponse(response, req);
      }

      // 2. No match: execute the special 404.html handler.
      const notFoundRoute = this.findNotFoundRoute();

      if (notFoundRoute) {
        const response = await this.runHandler(notFoundRoute, req);

        return this.finishResponse(response, req, 404);
      }

      // 3. No route and no custom 404 page.
      return new Response(
        req.method === "HEAD" ? null : "Not Found",
        {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    } catch (error) {
      // Handler errors or invalid handler results become HTTP 500.
      return new Response(
        JSON.stringify({
          error: "Simulator handler failed",
          detail: String(error)
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }
  }
}



const server = new SimServer();

server.get(10, "/assets/main.css", (req) => {
  return css(`
    /* Original CSS content */
  `);
});

server.post(10, "/commit", async (req) => {
  const body = await readRequestBody(req);

  broadcast({
    type: "BUILDER_ACTION",
    payload: body
  });

  return json({ ok: true });
});

server.get(10, "/api/page", (req) => {
  return json({
    ok: true
  });
});

server.get(10, "/api/failure-demo", (req) => {
  return json({
    ok: false,
    error: "Simulated failure"
  }, 500);
});

server.get(10, "/simulator/health", (req) => {
  return json({
    ok: true,
    status: "healthy"
  });
});

server.get(0, "/404.html", (req) => {
  return html(`
    <!doctype html>
    <html>
      <head><title>404 Not Found</title></head>
      <body><h1>404 Not Found</h1></body>
    </html>
  `, 404);
});



self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(server.fetch(request));
});