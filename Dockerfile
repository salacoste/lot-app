# === Этап 1: Сборка приложения ===
# Используем современный bookworm-slim. Это автоматически решит проблему с зависимостями libvips и glibc
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Копируем файлы для установки ВСЕХ зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем ВСЕ зависимости (включая dev), необходимые для сборки.
# Это гарантирует, что нативные модули компилируются для правильной Linux-среды.
RUN npm ci --legacy-peer-deps

# Копируем остальной код
COPY . .

# Объявляем и передаем переменные окружения для сборки
ARG NEXT_PUBLIC_CSHARP_BACKEND_URL
ARG NEXT_PUBLIC_FEATURE_PUBLISH_BUTTON_ENABLED
ARG NEXT_PUBLIC_YANDEX_MAPS_API_KEY
ARG NEXT_PUBLIC_DADATA_API_KEY
ARG NEXT_PUBLIC_APP_VERSION

ENV NEXT_PUBLIC_CSHARP_BACKEND_URL=$NEXT_PUBLIC_CSHARP_BACKEND_URL
ENV NEXT_PUBLIC_FEATURE_PUBLISH_BUTTON_ENABLED=$NEXT_PUBLIC_FEATURE_PUBLISH_BUTTON_ENABLED
ENV NEXT_PUBLIC_YANDEX_MAPS_API_KEY=$NEXT_PUBLIC_YANDEX_MAPS_API_KEY
ENV NEXT_PUBLIC_DADATA_API_KEY=$NEXT_PUBLIC_DADATA_API_KEY
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION

RUN echo "URL в Dockerfile: $NEXT_PUBLIC_CSHARP_BACKEND_URL"

# Сборка Next.js приложения
RUN npm run build

# === Этап 2: Финальный образ для Production ===
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision=$GIT_COMMIT

# Создаем пользователя с ограниченными правами
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Копируем файлы для установки ТОЛЬКО production-зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем ТОЛЬКО production-зависимости, чтобы образ был меньше
RUN npm ci --omit=dev --legacy-peer-deps

# Копируем собранное приложение со стадии сборки
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
RUN echo "$GIT_COMMIT" > /app/BUILD_INFO && chown nextjs:nodejs /app/BUILD_INFO

# Устанавливаем пользователя
USER nextjs

# Открываем порт
EXPOSE 3000

# Команда для запуска
CMD ["npm", "start"]
