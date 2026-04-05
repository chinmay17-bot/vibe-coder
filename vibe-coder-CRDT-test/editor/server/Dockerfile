FROM node:20-slim

# Install python3 + build tools needed by node-pty
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# The user workspace lives here — mounted as a volume for persistence
RUN mkdir -p /workspace

EXPOSE 9000

CMD ["node", "index.js"]
