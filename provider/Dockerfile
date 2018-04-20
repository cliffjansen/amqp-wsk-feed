FROM node:8

WORKDIR /usr/src/

EXPOSE 8080

COPY package.json /usr/src/
COPY . /usr/src/
RUN npm -s install

# Run it
CMD ["/bin/bash", "-c", "npm start" ]