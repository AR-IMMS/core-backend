#!/bin/sh
set -eu
umask 077
[ ! -e /certs/ca.key ] || { echo 'Existing CA found; refusing implicit rotation'; exit 1; }
openssl req -x509 -newkey rsa:3072 -noenc -keyout /certs/ca.key -out /certs/ca.crt -days 365 -subj /CN=ARIMMS-P0-Maintenance-CA -addext basicConstraints=critical,CA:TRUE 2>/dev/null
openssl req -newkey rsa:3072 -noenc -keyout /certs/server.key -out /certs/server.csr -subj /CN=localhost 2>/dev/null
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nextendedKeyUsage=serverAuth\n' > /certs/server.ext
openssl x509 -req -in /certs/server.csr -CA /certs/ca.crt -CAkey /certs/ca.key -CAcreateserial -out /certs/server.crt -days 90 -extfile /certs/server.ext 2>/dev/null
openssl req -newkey rsa:3072 -noenc -keyout /certs/admin.key -out /certs/admin.csr -subj /CN=arimms-maintenance 2>/dev/null
printf 'extendedKeyUsage=clientAuth\n' > /certs/admin.ext
openssl x509 -req -in /certs/admin.csr -CA /certs/ca.crt -CAkey /certs/ca.key -CAcreateserial -out /certs/admin.crt -days 30 -extfile /certs/admin.ext 2>/dev/null
printf 'Maintenance certificates generated; private keys were not printed.\n'
