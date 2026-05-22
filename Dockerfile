FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy project manifest
COPY package.json ./

# Copy backend source
COPY backend ./backend

# Copy frontend (served as static files by the backend)
COPY frontend ./frontend

# Production environment
ENV NODE_ENV=production
ENV PORT=4173

# Expose the app port
EXPOSE 4173

# Health check — Railway and other platforms use this
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4173/api/health || exit 1

# Run the server
CMD ["node", "backend/server.js"]
