/* Every public page is rendered by app/[[...path]]/route.ts from the original theme files.
   This layout only exists because Next.js requires one. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
