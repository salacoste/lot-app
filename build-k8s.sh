#!/bin/bash

set -e  # Скрипт упадет при любой ошибке

DEPLOYMENT_NAME="frontend-deployment"

# Принимаем аргумент: prod или dev
ENV_TYPE=$1

if [ "$ENV_TYPE" == "prod" ]; then
  ENV_FILE=".env.production"
  TAG_SUFFIX="" # Для прода чистая версия, например 1.1.10
elif [ "$ENV_TYPE" == "dev" ]; then
  ENV_FILE=".env.local" # Или .env.dev
  TAG_SUFFIX="-dev" # Версия будет 1.1.10-dev
else
  echo "Usage: ./build-k8s.sh [prod|dev]"
  exit 1
fi

echo "🏗️ Building for $ENV_TYPE using $ENV_FILE..."

# Достаем версию из файла
RAW_VERSION=$(grep NEXT_PUBLIC_APP_VERSION "$ENV_FILE" | cut -d '=' -f2)
# Убираем возможные кавычки
VERSION="${RAW_VERSION%\"}"
VERSION="${VERSION#\"}"
FULL_TAG="${VERSION}${TAG_SUFFIX}"
IMAGE_NAME="dmitryst/lot-app"

# Хэш коммита, из которого собирается образ
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
if [ "$GIT_COMMIT" != "unknown" ] && ! git diff-index --quiet HEAD -- 2>/dev/null; then
  GIT_COMMIT="${GIT_COMMIT}-dirty"
fi

echo "🎯 Target Version: $FULL_TAG"
echo "🔖 Git Commit: $GIT_COMMIT"

# Билд образа
# Важно: NEXT_PUBLIC_* передаются здесь и "запекаются" в статику Next.js
docker build \
  --no-cache \
  --build-arg NEXT_PUBLIC_CSHARP_BACKEND_URL=$(grep NEXT_PUBLIC_CSHARP_BACKEND_URL "$ENV_FILE" | cut -d '=' -f2) \
  --build-arg NEXT_PUBLIC_FEATURE_PUBLISH_BUTTON_ENABLED=$(grep NEXT_PUBLIC_FEATURE_PUBLISH_BUTTON_ENABLED "$ENV_FILE" | cut -d '=' -f2) \
  --build-arg NEXT_PUBLIC_YANDEX_MAPS_API_KEY=$(grep NEXT_PUBLIC_YANDEX_MAPS_API_KEY "$ENV_FILE" | cut -d '=' -f2) \
  --build-arg NEXT_PUBLIC_DADATA_API_KEY=$(grep NEXT_PUBLIC_DADATA_API_KEY "$ENV_FILE" | cut -d '=' -f2) \
  --build-arg NEXT_PUBLIC_APP_VERSION="$FULL_TAG" \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  -t $IMAGE_NAME:"$FULL_TAG" .

# Создаем тег latest, который ссылается на ТОТ ЖЕ самый образ
echo "🏷️ Tagging as latest..."
docker tag $IMAGE_NAME:"$FULL_TAG" $IMAGE_NAME:latest

# Пушим оба образа
echo "🚀 Pushing image $IMAGE_NAME:$FULL_TAG..."
docker push $IMAGE_NAME:"$FULL_TAG"

echo "🚀 Pushing image $IMAGE_NAME:latest..."
docker push $IMAGE_NAME:latest

# Переходим в директорию с манифестами и перезапускаем
# echo "📂 Changing directory to Kubernetes manifests..."

# В Git Bash путь B:\Projects\k8s\frontend обычно выглядит так:
# cd /b/Projects/k8s/frontend || { echo "❌ Directory not found!"; exit 1; }

# echo "🔄 Applying updated configuration..."
# kubectl apply -f deployment.yaml

# echo "✅ Done! Deployment restarted."

# Deploy
# echo "🔄 Rolling out restart for $DEPLOYMENT_NAME..."
# kubectl rollout restart deployment/$DEPLOYMENT_NAME   - k8s не скачивает latest

# Хамский способ заставить кубер перекачать latest:
# Сначала ставим несуществующий или старый тег (опционально, но надежно), 
# либо просто явно устанавливаем latest еще раз, чтобы триггернуть обновление метаданных.

# Самый надежный способ для "latest" стратегии — scale down/up или patch с датой.
# Но лучше всего работает добавление аннотации с текущим временем.
# Это гарантирует изменение PodSpec, что вызывает пересоздание подов.

# echo "🔄 Triggering rollout with timestamp annotation..."
# kubectl patch deployment $DEPLOYMENT_NAME -p \
#   "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kubectl.kubernetes.io/restartedAt\":\"$(date +%Y-%m-%dT%H:%M:%S%z)\"}}}}}"

echo "✅ Done! v$FULL_TAG ($GIT_COMMIT) deployed."

# Опционально: вернуться назад
# cd /b/Projects/lot-app
