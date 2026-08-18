export default async function BlogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <main>
      <h1>{slug}</h1>
      <p>This dynamic page is a Lambda candidate.</p>
    </main>
  );
}