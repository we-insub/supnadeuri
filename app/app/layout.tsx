import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '숲 빈방 | 전국 자연휴양림 빈방 찾기',
  description:
    '날짜·지역·인원을 한 번 입력하고 숲나들e의 예약 가능한 숙박 객실을 확인하세요.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
