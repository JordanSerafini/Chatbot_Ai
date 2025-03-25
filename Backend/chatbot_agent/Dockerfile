FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

EXPOSE 3001

# Start the server using the production build
CMD ["npm", "run", "start:dev"] 