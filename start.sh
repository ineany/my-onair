#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  my-onair 재시작 스크립트
#  ECS 서비스 desired-count=1 → 태스크 재가동
#  → 인프라/이미지가 없다면 ./deploy.sh 안내
# ─────────────────────────────────────────────

AWS_REGION="ap-northeast-2"
APP_NAME="my-onair"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "========================================="
echo "  재시작: ${APP_NAME}"
echo "========================================="
echo ""

# 사전 체크
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "❌ AWS CLI 인증 실패. 'aws configure'를 먼저 실행하세요."
  exit 1
}
echo "✓ AWS 계정: ${ACCOUNT_ID}"

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${APP_NAME}"

# ── 1. 인프라 존재 확인 ──
echo ""
echo "▶ [1/4] 인프라 상태 확인..."

CLUSTER_STATUS=$(aws ecs describe-clusters \
  --clusters "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "NONE")

SERVICE_STATUS=$(aws ecs describe-services \
  --cluster "${APP_NAME}" --services "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "services[0].status" --output text 2>/dev/null || echo "NONE")

IMAGE_EXISTS=$(aws ecr describe-images \
  --repository-name "${APP_NAME}" \
  --image-ids imageTag=latest \
  --region "${AWS_REGION}" \
  --query "imageDetails[0].imageDigest" --output text 2>/dev/null || echo "NONE")

if [ "${CLUSTER_STATUS}" != "ACTIVE" ] || [ "${SERVICE_STATUS}" != "ACTIVE" ] || [ "${IMAGE_EXISTS}" = "NONE" ]; then
  echo "  ⚠ 인프라 또는 이미지가 없습니다."
  echo "    - 클러스터: ${CLUSTER_STATUS}"
  echo "    - 서비스:   ${SERVICE_STATUS}"
  echo "    - 이미지:   ${IMAGE_EXISTS}"
  echo ""
  echo "  → './deploy.sh' 를 실행하세요 (인프라 자동 구축 + 빌드/배포)."
  exit 1
fi
echo "  ✓ 인프라/이미지 정상"

# ── 2. 현재 desired-count 확인 ──
CURRENT_DESIRED=$(aws ecs describe-services \
  --cluster "${APP_NAME}" --services "${APP_NAME}" \
  --region "${AWS_REGION}" \
  --query "services[0].desiredCount" --output text 2>/dev/null || echo "0")

echo ""
echo "▶ [2/4] 현재 desired-count: ${CURRENT_DESIRED}"

if [ "${CURRENT_DESIRED}" -ge 1 ]; then
  echo "  - 이미 실행 중. desired-count는 그대로 둡니다."
else
  echo "▶ desired-count → 1 변경 중..."
  aws ecs update-service \
    --cluster "${APP_NAME}" --service "${APP_NAME}" \
    --desired-count 1 \
    --region "${AWS_REGION}" > /dev/null || {
    echo "❌ desired-count 변경 실패"
    exit 1
  }
  echo "  ✓ 적용 완료"
fi

# ── 3. 안정화 대기 ──
echo ""
echo "▶ [3/4] 서비스 안정화 대기 중... (최대 5분)"
aws ecs wait services-stable \
  --cluster "${APP_NAME}" --services "${APP_NAME}" \
  --region "${AWS_REGION}" 2>/dev/null || true

# ── 4. 최신 태스크 IP 조회 ──
echo ""
echo "▶ [4/4] 최신 태스크 IP 조회..."
PUBLIC_IP=""
for i in $(seq 1 20); do
  TASK_ARN=$(aws ecs list-tasks --cluster "${APP_NAME}" --service-name "${APP_NAME}" \
    --desired-status RUNNING --region "${AWS_REGION}" \
    --query "taskArns[-1]" --output text 2>/dev/null || echo "None")

  if [ -n "${TASK_ARN}" ] && [ "${TASK_ARN}" != "None" ]; then
    TASK_STATUS=$(aws ecs describe-tasks --cluster "${APP_NAME}" --tasks "${TASK_ARN}" \
      --region "${AWS_REGION}" \
      --query "tasks[0].lastStatus" --output text 2>/dev/null || echo "None")

    if [ "${TASK_STATUS}" = "RUNNING" ]; then
      ENI_ID=$(aws ecs describe-tasks --cluster "${APP_NAME}" --tasks "${TASK_ARN}" \
        --region "${AWS_REGION}" \
        --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
        --output text 2>/dev/null || echo "None")

      if [ -n "${ENI_ID}" ] && [ "${ENI_ID}" != "None" ]; then
        PUBLIC_IP=$(aws ec2 describe-network-interfaces --network-interface-ids "${ENI_ID}" \
          --region "${AWS_REGION}" \
          --query "NetworkInterfaces[0].Association.PublicIp" --output text 2>/dev/null || echo "None")

        if [ -n "${PUBLIC_IP}" ] && [ "${PUBLIC_IP}" != "None" ]; then
          break
        fi
      fi
    fi
  fi
  echo "  대기 중... (${i}/20)"
  sleep 5
done

if [ -z "${PUBLIC_IP}" ] || [ "${PUBLIC_IP}" = "None" ]; then
  echo ""
  echo "⚠ 태스크 IP를 아직 확인하지 못했습니다. 잠시 후 ./update-dns.sh 를 실행하세요."
  exit 1
fi

echo "  ✓ Public IP: ${PUBLIC_IP}"

# ── 5. DNS 자동 업데이트 ──
echo ""
echo "▶ DNS 자동 업데이트 시도..."
if [ -x "${SCRIPT_DIR}/update-dns.sh" ]; then
  "${SCRIPT_DIR}/update-dns.sh" || echo "  ⚠ DNS 업데이트 실패. 수동 실행: ./update-dns.sh"
else
  echo "  - update-dns.sh 가 실행 가능 상태가 아님. 수동으로 실행하세요."
fi

echo ""
echo "========================================="
echo "  ✓ 재시작 완료!"
echo ""
echo "  IP:    http://${PUBLIC_IP}"
echo "  HTTPS: https://myonair.freeddns.org"
echo "  (DNS 반영 + SSL 발급까지 약 1~3분 소요)"
echo "========================================="
