import "./globals.css";


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <link rel="preconnect" href="https://fonts.googleapis.com" precedence="default"></link>
      <link rel="preconnect" href="https://fonts.gstatic.com" precedence="default"></link>
      <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Oswald:wght@200..700&display=swap" rel="stylesheet" precedence="default"></link>
      <body>

        {children}

      </body>

    </html>
  );
}
