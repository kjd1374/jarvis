import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Jarvis · 나만의 워크스페이스", template: "%s · Jarvis" },
  description:
    "작업, 프로젝트, 떠오른 아이디어를 한곳에 담는 나만의 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
