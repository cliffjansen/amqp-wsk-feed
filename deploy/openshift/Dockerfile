FROM centos:7

RUN localedef -c -i en_US -f UTF-8 en_US.UTF-8
ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

RUN yum update -y \
  && yum install -y epel-release \
  && yum repolist \
  && yum install -y curl git npm zip \
  && yum clean all

# Clone the AMQP provider
RUN git clone https://github.com/cliffjansen/amqp-wsk-feed /openwhisk-package-amqp \
  && cd /openwhisk-package-amqp \
  && git checkout master \
  && cd /

# Install wsk binary
RUN mkdir -p /openwhisk/bin
RUN curl -L https://github.com/projectodd/openwhisk-openshift/releases/download/latest/OpenWhisk_CLI-latest-linux-amd64.tgz | tar xz && mv wsk /openwhisk/bin/wsk

# Ensure we can write to needed directories on OpenShift
RUN chgrp -R 0 /openwhisk-package-amqp \
  && chmod -R g+rwX /openwhisk-package-amqp \
  && mkdir -p /.npm \
  && chgrp -R 0 /.npm \
  && chmod -R g+rwX /.npm

ENV OPENWHISK_HOME /openwhisk
COPY amqp-init.sh /init.sh

ENTRYPOINT ["/bin/bash", "/init.sh"]
