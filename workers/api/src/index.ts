const healthResponse = {
  ok: true,
  service: "voxyl-api",
  version: "migration-shell",
};

const notFoundResponse = {
  ok: false,
  error: "Not found",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      return jsonResponse(healthResponse);
    }

    return jsonResponse(notFoundResponse, 404);
  },
};
