FROM node:22-alpine

WORKDIR /app

# Install dependencies needed by tools
# which: for external binary detection
# curl, wget, git: for web-fetch, recon, install tools
# ca-certificates: for HTTPS
RUN apk add --no-cache which curl wget git ca-certificates

# Copy manifest + install TS deps (devDep for type-checking)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev

# Copy source
COPY . .

# Build TypeScript stubs
RUN npm run build

# Default entry: REPL mode
ENTRYPOINT ["node", "phantom.mjs"]
CMD []
