FROM node:18-alpine

WORKDIR /app

# 依存関係のコピーとインストール
COPY package*.json ./
RUN npm install

# アプリケーションのコピー
COPY . .

# React アプリの起動
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]