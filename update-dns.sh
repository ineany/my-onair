#!/bin/bash
set -e

AWS_REGION="ap-northeast-2"
APP_NAME="my-onair"
DYNU_API_KEY="6fe2345U34234d6UfZ34Wf33ac3VZVU3"
DYNU_DOMAIN_ID="14386384"
DYNU_HOSTNAME="myonair.freeddns.org"

echo "▶ 최신 태스크 IP 조회 중..."

TASK_ARN=$(aws ecs list-tasks --cluster "${APP_NAME}" --service-name "${APP_NAME}" \
  --desired-status RUNNING --region "${AWS_REGION}" \
  --query "taskArns[-1]" --output text)

if [ -z "${TASK_ARN}" ] || [ "${TASK_ARN}" = "None" ]; then
  echo "❌ 실행 중인 태스크가 없습니다."; exit 1
fi

ENI_ID=$(aws ecs describe-tasks --cluster "${APP_NAME}" --tasks "${TASK_ARN}" \
  --region "${AWS_REGION}" \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
  --output text)

IP=$(aws ec2 describe-network-interfaces --network-interface-ids "${ENI_ID}" \
  --region "${AWS_REGION}" \
  --query "NetworkInterfaces[0].Association.PublicIp" --output text)

if [ -z "${IP}" ] || [ "${IP}" = "None" ]; then
  echo "❌ Public IP를 찾을 수 없습니다."; exit 1
fi

echo "▶ DNS 업데이트: ${DYNU_HOSTNAME} → ${IP}"

curl -s -X POST "https://api.dynu.com/v2/dns/${DYNU_DOMAIN_ID}" \
  -H "API-Key: ${DYNU_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${DYNU_HOSTNAME}\",\"ipv4Address\":\"${IP}\",\"ttl\":120,\"ipv4\":true}" > /dev/null

echo ""
echo "========================================="
echo "  ✓ DNS 업데이트 완료!"
echo "  ${DYNU_HOSTNAME} → ${IP}"
echo "  (반영까지 약 1~2분 소요)"
echo "========================================="
