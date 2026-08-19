// Edge-compatible route: uses only Web/fetch APIs, no Node built-ins.
// The split engine should detect this as Worker-compatible automatically.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const results = [
    { id: 1, title: "Dune" },
    { id: 2, title: "Neuromancer" },
    { id: 3, title: "Foundation" },
  ].filter((book) => book.title.toLowerCase().includes(query.toLowerCase()));

  return Response.json({ results });
}
