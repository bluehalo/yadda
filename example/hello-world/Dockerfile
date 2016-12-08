FROM node:6

WORKDIR /srv/app

COPY package.json .
RUN npm install --production -s
COPY . .

EXPOSE 3000

CMD node index.js
