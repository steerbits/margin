export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      r.status === 404 && data.error === "Unknown API route."
        ? "Restart Margin to finish updating. Save any unsaved notes, stop the server in Terminal, and run the same launch command again. Then refresh this page."
        : (data.error ?? `Request failed (${r.status})`),
    );
  return data;
}
