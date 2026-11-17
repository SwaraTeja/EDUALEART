FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 4000
# Apply pending migrations (idempotent, never resets data), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
