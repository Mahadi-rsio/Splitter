// Node-only route: uses node:fs, forcing Lambda classification.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "1";

  // Demonstrate Node-only API usage that prevents Worker deployment
  const templatePath = join(process.cwd(), "templates", "invoice.html");
  let template = "<html><body>Invoice #{id}</body></html>";
  try {
    template = readFileSync(templatePath, "utf8");
  } catch {
    // Template file optional in dev
  }

  const html = template.replace("{id}", id);

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}
