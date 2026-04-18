FROM node:20-slim

# Install python3 + build tools needed by node-pty + runtime languages
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    bash \
    default-jdk \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# The user workspace lives here — mounted as a volume for persistence
RUN mkdir -p /workspace

EXPOSE 9000

CMD ["node", "index.js"]
