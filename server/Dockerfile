FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy server files
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 5002

# Start server
CMD ["node", "server.js"]