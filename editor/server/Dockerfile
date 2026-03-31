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

# Create a non-root user for the sandbox
RUN useradd -m -s /bin/bash sandboxuser && \
    mkdir -p /workspace && \
    chown sandboxuser:sandboxuser /workspace

# Drop to non-root
USER sandboxuser

# The user workspace lives here — mounted as a volume for persistence
EXPOSE 9000

CMD ["node", "/app/index.js"]
