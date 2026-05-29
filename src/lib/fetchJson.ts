/**
 * Fetch JSON with an explicit HTTP status check.
 *
 * Plain `fetch(url).then(r => r.json())` does NOT reject on 4xx/5xx — it
 * happily tries to parse the error response, so a 404 that serves an HTML
 * page surfaces as an opaque "Unexpected token '<'" SyntaxError. Checking
 * `res.ok` first turns that into a clear, actionable error and gives every
 * call site one consistent failure mode to `.catch`.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
