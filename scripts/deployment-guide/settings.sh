DOMAIN_NAME=midad.example.com
OPS_EMAIL=ops@example.com
cd /opt/midad
cp .env.docker.example .env.production
chmod 600 .env.production
setv() { sed -i "s|^$1=.*|$1=$2|" .env.production; }
setv NODE_ENV production
setv APP_URL "https://$DOMAIN_NAME"
setv DOMAIN "$DOMAIN_NAME"
setv ACME_EMAIL "$OPS_EMAIL"
setv ALERT_EMAILS "$OPS_EMAIL"
setv BILLING_PROVIDER disabled
for k in POSTGRES_SUPERUSER_PASSWORD DB_OWNER_PASSWORD DB_APP_PASSWORD DB_SYSTEM_PASSWORD DB_BACKUP_PASSWORD; do setv "$k" "$(openssl rand -hex 24)"; done
setv SESSION_SECRET "$(openssl rand -base64 48)"
setv DATA_ENCRYPTION_KEY "$(openssl rand -base64 32)"
grep -c change-me .env.production
