import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'PJ-029 統合スケジュール・予約管理',
  description: '予定・会議室・社用車を一体管理する社内スケジュールアプリ',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
