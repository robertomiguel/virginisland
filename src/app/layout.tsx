import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Isla',
  description: 'Juego de exploración de una isla',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
