import { fetch591Listing } from "../../src/listing-parser.mjs";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequest({ request }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("url") || "";

  try {
    return json(await fetch591Listing(target));
  } catch (error) {
    return json({ error: error.message || "無法讀取 591 頁面。" }, error.status || 502);
  }
}
