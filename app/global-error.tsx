"use client";

export default function GlobalError({ unstable_retry }: Readonly<{ unstable_retry: () => void }>) {
  return (
    <html lang="en">
      <body>
        <main>
          <h1>FundFlow could not load</h1>
          <p>Try loading the app again.</p>
          <button type="button" onClick={unstable_retry}>Try again</button>
        </main>
      </body>
    </html>
  );
}
