/**
 * The current song's accent colour, read by the server (the art hosts
 * refuse browsers' CORS reads with 429). Undefined for grey artwork or any
 * failure, so callers fall back to the app's red.
 */
export async function loadAccent(src: string): Promise<string | undefined> {
  try {
    const res = await fetch(`/api/art-accent?src=${encodeURIComponent(src)}`);
    if (res.status !== 200) return undefined;
    const { color } = (await res.json()) as { color?: string };
    return color;
  } catch {
    return undefined;
  }
}
