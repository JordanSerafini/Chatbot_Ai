FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install
RUN npm install -g ts-node typescript

COPY . .

RUN npm run build

EXPOSE 3002

CMD ["npm", "run", "start:dev"] 