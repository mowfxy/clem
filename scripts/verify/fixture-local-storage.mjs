/** Waits until the App has written its latest changes: it coalesces workspace saves (SAVE_MS in src/App.tsx). */
export const saved = (page) => page.waitForTimeout(700);

export async function mockLocalStorage(page) {
  let state = null;
  const files = new Map();
  await page.route("**/api/local/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    if (path.endsWith("/state")) {
      if (method === "PUT") state = route.request().postDataJSON();
      return route.fulfill({ json: state });
    }
    const id = path.split("/").at(-1);
    if (method === "PUT") {
      files.set(id, route.request().postDataBuffer());
      return route.fulfill({ json: { ok: true } });
    }
    if (method === "DELETE") {
      files.delete(id);
      return route.fulfill({ json: { ok: true } });
    }
    return files.has(id)
      ? route.fulfill({ body: files.get(id) })
      : route.fulfill({ status: 404 });
  });
}
