import type { Metadata } from "next"
import { IBM_Plex_Sans_Arabic } from "next/font/google"
import "./globals.css"
import { QueryProvider } from "@/lib/query-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LanguageProvider } from "@/lib/language-context"
import { ThemeProvider } from "next-themes"

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-sans",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "نظام إدارة الإجازات والتأخير",
  description: "Leave & Tardiness Management System",
  manifest: '/manifest.json',
  themeColor: '#1976D2',
  icons: {
    icon: '/favicon.svg',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'EmpLeave',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${ibmPlexArabic.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full font-sans antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <LanguageProvider>
            <QueryProvider>
              <TooltipProvider>
                {children}
              </TooltipProvider>
            </QueryProvider>
            <Toaster position="top-center" />
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
