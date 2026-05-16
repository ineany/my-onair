#!/bin/sh

DYNU_API_KEY="6fe2345U34234d6UfZ34Wf33ac3VZVU3"
DYNU_DOMAIN_ID="14386384"
DYNU_HOSTNAME="myonair.freeddns.org"

# ── 1. DNS 업데이트 ──
PUBLIC_IP=$(wget -qO- https://checkip.amazonaws.com 2>/dev/null || wget -qO- https://ifconfig.me 2>/dev/null)

if [ -n "${PUBLIC_IP}" ]; then
  echo "[DNS] ${DYNU_HOSTNAME} -> ${PUBLIC_IP}"
  wget -qO- \
    --header="API-Key: ${DYNU_API_KEY}" \
    --header="Content-Type: application/json" \
    --post-data="{\"name\":\"${DYNU_HOSTNAME}\",\"ipv4Address\":\"${PUBLIC_IP}\",\"ttl\":120,\"ipv4\":true}" \
    "https://api.dynu.com/v2/dns/${DYNU_DOMAIN_ID}" 2>/dev/null
  echo ""
fi

# ── 2. Next.js 시작 (0.0.0.0 에 바인딩 강제) ──
echo "[APP] Next.js 시작..."
HOSTNAME=0.0.0.0 PORT=3000 node server.js &

# 포트 3000 준비 대기
for i in $(seq 1 30); do
  if wget -q --spider http://127.0.0.1:3000 2>/dev/null; then
    echo "[APP] Next.js 준비 완료 (${i}초)"
    break
  fi
  sleep 1
done

# ── 3. Caddy 시작 ──
echo "[CADDY] Caddy 시작..."
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
