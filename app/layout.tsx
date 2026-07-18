// app/layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import YandexMapsProvider from "@/components/YandexMapsProvider";
import { AuthProvider } from "@/context/AuthContext";
import { FavoritesProvider } from '@/context/FavoritesContext';
import { ChatProvider } from '@/context/ChatContext';
import { Header } from '@/components/Header';
import Footer from '@/components/Footer';
import YandexMetrika from "@/components/YandexMetrika";
import { Suspense } from 'react';
import AnnouncementBar from "@/components/AnnouncementBar/AnnouncementBar";
import RouterRecovery from "@/components/RouterRecovery";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "auction.thepeace.ru - поиск и анализ лотов с торгов по банкротству",
  description: "сайт-агрегатор торгов по банкротству, аукционы России, публичные предложения, выгодные лоты",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={inter.className}>
        <RouterRecovery />
        <AuthProvider>
          <ChatProvider>
            <FavoritesProvider>
              <AnnouncementBar />

              <Suspense fallback={<div style={{ height: '60px' }} />}>
                <Header />
              </Suspense>

              <YandexMapsProvider>{children}</YandexMapsProvider>

              <Footer />
            </FavoritesProvider>
          </ChatProvider>
        </AuthProvider>

        <Suspense fallback={<></>}>
          <YandexMetrika />
        </Suspense>
      </body>
    </html>
  );
}
