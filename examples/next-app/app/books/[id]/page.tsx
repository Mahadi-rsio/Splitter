const books: Record<string, { title: string; author: string }> = {
  "1": { title: "Dune", author: "Frank Herbert" },
  "2": { title: "Neuromancer", author: "William Gibson" },
  "3": { title: "Foundation", author: "Isaac Asimov" },
};

export function generateStaticParams() {
  return Object.keys(books).map((id) => ({ id }));
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = books[id];
  if (!book) return <p>Not found</p>;
  return (
    <main>
      <h1>{book.title}</h1>
      <p>by {book.author}</p>
    </main>
  );
}
