import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Jarvis · 통합 업무실", template: "%s · Jarvis" },
  description: "대화와 업무 맥락, 자료와 결과물을 연결하는 나만의 통합 업무실",
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
