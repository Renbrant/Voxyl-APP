const healthResponse = {
  ok: true,
  service: "voxyl-api",
  version: "migration-shell",
};

const notFoundResponse = {
  ok: false,
  error: "Not found",
};

const unauthorizedResponse = {
  ok: false,
  error: "Unauthorized",
};

interface Env {
  DB: D1Database;
  VOXYL_CACHE: KVNamespace;
  VOXYL_MEDIA: R2Bucket;
  DIAGNOSTICS_TOKEN: string;
  CLERK_SECRET_KEY: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function getDiagnosticsToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-diagnostics-token");
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function isDiagnosticsAuthorized(request: Request, env: Env): boolean {
  const providedToken = getDiagnosticsToken(request);

  if (!providedToken || !env.DIAGNOSTICS_TOKEN) {
    return false;
  }

  return constantTimeEqual(providedToken, env.DIAGNOSTICS_TOKEN);
}

async function checkDb(env: Env): Promise<true | string> {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return result?.ok === 1 ? true : "D1 check failed";
  } catch {
    return "D1 check failed";
  }
}

async function checkKv(env: Env): Promise<true | string> {
  const key = `diagnostics/${crypto.randomUUID()}`;
  const value = "ok";

  try {
    await env.VOXYL_CACHE.put(key, value, { expirationTtl: 60 });
    const cachedValue = await env.VOXYL_CACHE.get(key);
    await env.VOXYL_CACHE.delete(key);

    return cachedValue === value ? true : "KV check failed";
  } catch {
    return "KV check failed";
  }
}

async function checkR2(env: Env): Promise<true | string> {
  const key = `diagnostics/${crypto.randomUUID()}.txt`;

  try {
    await env.VOXYL_MEDIA.put(key, "ok");
    const object = await env.VOXYL_MEDIA.head(key);
    await env.VOXYL_MEDIA.delete(key);

    return object ? true : "R2 check failed";
  } catch {
    return "R2 check failed";
  }
}

async function diagnosticsResponse(env: Env): Promise<Response> {
  const checks = {
    db: await checkDb(env),
    kv: await checkKv(env),
    r2: await checkR2(env),
  };
  const ok = checks.db === true && checks.kv === true && checks.r2 === true;

  return jsonResponse({
    ok,
    service: healthResponse.service,
    version: healthResponse.version,
    checks,
  });
}

async function checkClerk(env: Env): Promise<true | string> {
  try {
    const response = await fetch("https://api.clerk.com/v1/users?limit=1", {
      headers: {
        authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
        accept: "application/json",
      },
    });

    return response.ok ? true : "Clerk check failed";
  } catch {
    return "Clerk check failed";
  }
}

async function clerkDiagnosticsResponse(env: Env): Promise<Response> {
  const clerk = await checkClerk(env);
  const ok = clerk === true;

  return jsonResponse(
    {
      ok,
      service: healthResponse.service,
      version: healthResponse.version,
      checks: {
        clerk,
      },
    },
    ok ? 200 : 502,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      return jsonResponse(healthResponse);
    }

    if (request.method === "GET" && (pathname === "/diagnostics" || pathname === "/api/diagnostics")) {
      if (!isDiagnosticsAuthorized(request, env)) {
        return jsonResponse(unauthorizedResponse, 401);
      }

      return diagnosticsResponse(env);
    }

    if (request.method === "GET" && (pathname === "/clerk/diagnostics" || pathname === "/api/clerk/diagnostics")) {
      if (!isDiagnosticsAuthorized(request, env)) {
        return jsonResponse(unauthorizedResponse, 401);
      }

      return clerkDiagnosticsResponse(env);
    }

    return jsonResponse(notFoundResponse, 404);
  },
};
