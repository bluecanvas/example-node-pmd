FROM timbru31/java-node:11-jre

ARG PMD_VERSION=6.26.0

RUN apt-get update \
    && apt-get -y install unzip

WORKDIR /opt
RUN curl -LO https://github.com/pmd/pmd/releases/download/pmd_releases/$PMD_VERSION/pmd-bin-$PMD_VERSION.zip \
    && unzip pmd-bin-$PMD_VERSION.zip

COPY . /opt/app
WORKDIR /opt/app
RUN npm install

ENV PMD_HOME=/opt/pmd-bin-$PMD_VERSION

CMD ["npm", "start"]
